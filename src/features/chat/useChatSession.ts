import { useEffect, useMemo, useRef, useState } from 'react'
import { createGreenApi, errorText, exportAccounts, GreenApiError, hydrateAccounts, normalizePhone } from '../../api/client.ts'
import { applyNotification, isPlaceholderTitle } from '../../state/notifications.ts'
import type { ChatMessage, InboxState } from '../../state/notifications.ts'
import { readCabinet, writeCabinet } from '../../storage/session.ts'
import type { GreenApiConfig } from '../../types/green-api.ts'
import { chatLabel, mergeChatList, mergeHistory, upsertOutgoing } from './model.ts'

export function useChatSession(session: GreenApiConfig, onSessionEnd: (message: string) => void) {
  const api = useMemo(() => createGreenApi(session), [session])
  const [inbox, setInbox] = useState<InboxState>({
    chats: [],
    messages: [],
    instanceState: 'authorized',
  })
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [receiveNotice, setReceiveNotice] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [chatsLoading, setChatsLoading] = useState(true)
  const [historySettled, setHistorySettled] = useState<Record<string, true>>({})
  const sessionEndRef = useRef(onSessionEnd)
  const receiveLoopRef = useRef(0)
  const historyLoopRef = useRef(0)

  useEffect(() => {
    sessionEndRef.current = onSessionEnd
  }, [onSessionEnd])

  const activeChat = inbox.chats.find((chat) => chat.chatId === activeChatId) ?? null
  const canSend = inbox.instanceState === 'authorized'

  useEffect(() => {
    let cancelled = false
    void readCabinet(session.idInstance).then((cabinet) => {
      if (cancelled) return
      if (cabinet) {
        hydrateAccounts(session.idInstance, cabinet.accounts)
        setInbox({
          chats: cabinet.chats,
          messages: cabinet.messages,
          instanceState: 'authorized',
        })
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [session.idInstance])

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    void api
      .getChats()
      .then((remote) => {
        if (cancelled) return
        setInbox((current) => ({ ...current, chats: mergeChatList(current.chats, remote) }))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, hydrated])

  useEffect(() => {
    if (!hydrated || !activeChatId) return
    const chatId = activeChatId
    const loopId = historyLoopRef.current + 1
    historyLoopRef.current = loopId
    let cancelled = false
    api.stopReceive()

    async function pause(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function poll() {
      while (!cancelled && historyLoopRef.current === loopId) {
        if (document.visibilityState === 'hidden') {
          await pause(1000)
          continue
        }
        let delay = 400
        try {
          const entries = await api.getChatHistory(chatId)
          if (cancelled || historyLoopRef.current !== loopId) return
          setHistorySettled((current) => (current[chatId] ? current : { ...current, [chatId]: true }))
          setInbox((current) => mergeHistory(current, entries))
        } catch (caught) {
          if (caught instanceof GreenApiError && caught.status === 469) delay = 5000
        }
        await pause(delay)
      }
    }

    void poll()
    return () => {
      cancelled = true
    }
  }, [api, hydrated, activeChatId])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => {
      void writeCabinet(session.idInstance, {
        session,
        chats: inbox.chats,
        messages: inbox.messages,
        accounts: exportAccounts(session.idInstance),
      })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [hydrated, session, inbox])

  const placeholderChatId = activeChat && isPlaceholderTitle(activeChat.title) ? activeChat.chatId : null
  const placeholderPhone = activeChat?.phone ?? ''

  useEffect(() => {
    if (!placeholderChatId) return
    let cancelled = false
    api
      .getContactInfo(placeholderChatId)
      .then((info) => {
        if (cancelled) return
        const named = chatLabel(info, placeholderPhone)
        if (isPlaceholderTitle(named.title)) return
        setInbox((current) => ({
          ...current,
          chats: current.chats.map((item) =>
            item.chatId === placeholderChatId
              ? { ...item, title: named.title, username: named.username || item.username }
              : item,
          ),
        }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, placeholderChatId, placeholderPhone])

  useEffect(() => {
    if (!hydrated || chatsLoading || activeChatId) return
    const loopId = receiveLoopRef.current + 1
    receiveLoopRef.current = loopId
    let cancelled = false
    let failureDelay = 0

    async function pause(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function loop() {
      while (!cancelled && receiveLoopRef.current === loopId) {
        if (failureDelay > 0) await pause(failureDelay)
        if (cancelled || receiveLoopRef.current !== loopId) return

        try {
          const note = await api.receiveNotification(5)
          failureDelay = 0
          if (cancelled || receiveLoopRef.current !== loopId) return
          setReceiveNotice('')
          if (!note) continue
          setInbox((current) => applyNotification(current, note))
          await api.deleteNotification(note.receiptId)
        } catch (caught) {
          if (isAbort(caught)) continue
          if (caught instanceof GreenApiError && (caught.status === 401 || caught.status === 403)) {
            if (!cancelled) sessionEndRef.current(caught.message)
            return
          }
          failureDelay = failureDelay === 0 ? 1000 : Math.min(failureDelay * 2, 15000)
          if (!cancelled && receiveLoopRef.current === loopId) {
            const offline = caught instanceof GreenApiError && caught.reason === 'network'
            setReceiveNotice(offline ? errorText.offline : errorText.receivePaused)
          }
        }
      }
    }

    void loop()
    return () => {
      cancelled = true
    }
  }, [api, hydrated, chatsLoading, activeChatId])

  async function createChat(rawPhone: string): Promise<string> {
    const digits = normalizePhone(rawPhone)
    if (!digits) return 'Введите номер телефона.'

    try {
      const account = await api.checkAccount(digits)
      if (!account.exist || account.chatId.length === 0) return errorText.hiddenAccount

      const profile = await api.getContactInfo(account.chatId).catch(() => null)
      const named = chatLabel(
        {
          name: profile?.name,
          contactName: profile?.contactName,
          username: profile?.username || account.username,
        },
        digits,
      )
      const chat = {
        chatId: account.chatId,
        phone: digits,
        title: named.title,
        username: named.username,
      }
      setInbox((current) => ({
        ...current,
        chats: current.chats.some((item) => item.chatId === chat.chatId)
          ? current.chats
          : [chat, ...current.chats],
      }))
      setActiveChatId(chat.chatId)
      return ''
    } catch (caught) {
      if (caught instanceof GreenApiError) return caught.message
      return errorText.generic
    }
  }

  async function removeMessage(message: ChatMessage): Promise<string> {
    if (!message.idMessage) return ''
    try {
      await api.deleteMessage(message.chatId, message.idMessage)
      setInbox((current) => ({
        ...current,
        messages: current.messages.filter(
          (item) => item.localId !== message.localId && item.idMessage !== message.idMessage,
        ),
      }))
      return ''
    } catch (caught) {
      return caught instanceof GreenApiError ? caught.message : 'Не удалось удалить сообщение.'
    }
  }

  function deliver(
    chatId: string,
    text: string,
    localId = `local-${crypto.randomUUID()}`,
    quotedMessageId: string | null = null,
  ) {
    setInbox((current) => ({
      ...current,
      messages: upsertOutgoing(current.messages, { localId, chatId, text, quotedMessageId }),
    }))

    void api
      .sendMessage(chatId, text, quotedMessageId || undefined)
      .then((result) => {
        setInbox((current) => ({
          ...current,
          messages: current.messages.some(
            (message) => message.idMessage === result.idMessage && message.localId !== localId,
          )
            ? current.messages.filter((message) => message.localId !== localId)
            : current.messages.map((message) =>
                message.localId === localId
                  ? { ...message, idMessage: result.idMessage, status: 'sent' }
                  : message,
              ),
        }))
      })
      .catch(() => {
        setInbox((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.localId === localId ? { ...message, status: 'failed' } : message,
          ),
        }))
      })
  }

  return {
    chats: inbox.chats,
    messages: inbox.messages,
    instanceState: inbox.instanceState,
    activeChat,
    activeChatId,
    canSend,
    receiveNotice,
    chatsLoading,
    historyReady: activeChatId ? Boolean(historySettled[activeChatId]) : false,
    openChat: setActiveChatId,
    closeChat: () => setActiveChatId(null),
    createChat,
    removeMessage,
    deliver,
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
