import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createGreenApi, exportAccounts, GreenApiError, hydrateAccounts, normalizePhone } from '../api/client.ts'
import type { HistoryEntry, ListedChat } from '../types/green-api.ts'
import { applyNotification, isPlaceholderTitle } from '../state/notifications.ts'
import type { ChatItem, ChatMessage, InboxState } from '../state/notifications.ts'
import { readCabinet, writeCabinet } from '../storage/session.ts'
import type { GreenApiConfig } from '../types/green-api.ts'

const messageLimit = 4096
const missingAccountMessage =
  'Telegram на этом номере не найден или скрыт настройками приватности.'
const avatarColors = ['#3390ec', '#4fae4e', '#e36a5d', '#7b68ee', '#e39b2b', '#3d9a9a']
const messageSkeleton = [
  { side: 'in', lines: 2 },
  { side: 'out', lines: 1 },
  { side: 'in', lines: 1 },
  { side: 'out', lines: 2 },
  { side: 'in', lines: 3 },
  { side: 'out', lines: 1 },
]

type ReplyTarget = {
  chatId: string
  idMessage: string
  author: string
  text: string
}

type ChatHomeProps = {
  session: GreenApiConfig
  onLogout: () => void
  onSessionEnd: (message: string) => void
}

export function ChatHome({ session, onLogout, onSessionEnd }: ChatHomeProps) {
  const api = useMemo(() => createGreenApi(session), [session])
  const [inbox, setInbox] = useState<InboxState>({
    chats: [],
    messages: [],
    instanceState: 'authorized',
  })
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState('')
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [chatsLoading, setChatsLoading] = useState(true)
  const [historySettled, setHistorySettled] = useState<Record<string, true>>({})
  const logRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const sessionEndRef = useRef(onSessionEnd)

  useEffect(() => {
    sessionEndRef.current = onSessionEnd
  }, [onSessionEnd])

  const activeChat = inbox.chats.find((chat) => chat.chatId === activeChatId) ?? null
  const visibleMessages = inbox.messages.filter((message) => message.chatId === activeChatId)
  const canSend = inbox.instanceState === 'authorized'
  const orderedChats = useMemo(() => orderChats(inbox.chats, inbox.messages), [inbox.chats, inbox.messages])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [inbox.messages, activeChatId])

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
    if (!hydrated || !activeChatId || historySettled[activeChatId]) return
    const chatId = activeChatId
    let cancelled = false
    void api
      .getChatHistory(chatId)
      .then((entries) => {
        if (cancelled) return
        setHistorySettled((current) => ({ ...current, [chatId]: true }))
        setInbox((current) => mergeHistory(current, entries))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, hydrated, activeChatId, historySettled])

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
    let cancelled = false
    let failureDelay = 0

    async function pause(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function loop() {
      while (!cancelled) {
        if (failureDelay > 0) await pause(failureDelay)
        if (cancelled) return

        try {
          const note = await api.receiveNotification(failureDelay > 0 ? 5 : 20)
          failureDelay = 0
          if (!cancelled) setOffline(false)
          if (!note) continue
          if (!cancelled) setInbox((current) => applyNotification(current, note))
          await api.deleteNotification(note.receiptId)
        } catch (caught) {
          if (caught instanceof GreenApiError && (caught.status === 401 || caught.status === 403)) {
            if (!cancelled) sessionEndRef.current(caught.message)
            return
          }
          failureDelay = failureDelay === 0 ? 1000 : Math.min(failureDelay * 2, 15000)
          if (!cancelled) setOffline(true)
        }
      }
    }

    void loop()
    return () => {
      cancelled = true
    }
  }, [api])

  async function createChat(rawPhone: string) {
    const digits = normalizePhone(rawPhone)
    if (!digits) {
      setError('Введите номер телефона.')
      return
    }

    setPending(true)
    setError('')
    try {
      const account = await api.checkAccount(digits)
      if (!account.exist || account.chatId.length === 0) {
        setError(missingAccountMessage)
        return
      }

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
      setPhone('')
      setCreating(false)
    } catch (caught) {
      if (caught instanceof GreenApiError) setError(caught.message)
      else setError('Запрос к GREEN-API не выполнился.')
    } finally {
      setPending(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void createChat(phone)
  }

  function submitDraft() {
    if (!activeChat || !canSend) return
    const text = draft
    if (text.trim().length === 0) return
    if ([...text].length > messageLimit) {
      setComposerError('Текст сообщения длиннее 4096 символов.')
      return
    }

    const quotedMessageId = replyTo?.chatId === activeChat.chatId ? replyTo.idMessage : null
    setComposerError('')
    setDraft('')
    setReplyTo(null)
    void deliver(activeChat.chatId, text, `local-${crypto.randomUUID()}`, quotedMessageId)
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitDraft()
    }
  }

  function startReply(message: ChatMessage) {
    if (!message.idMessage || !activeChat) return
    setReplyTo({
      chatId: message.chatId,
      idMessage: message.idMessage,
      author: message.direction === 'out' ? 'Вы' : activeChat.title,
      text: message.text,
    })
    setComposerError('')
    draftRef.current?.focus()
  }

  async function removeMessage(message: ChatMessage) {
    if (!message.idMessage || deletingId) return
    setDeletingId(message.localId)
    setComposerError('')
    try {
      await api.deleteMessage(message.chatId, message.idMessage)
      setInbox((current) => ({
        ...current,
        messages: current.messages.filter(
          (item) => item.localId !== message.localId && item.idMessage !== message.idMessage,
        ),
      }))
      setReplyTo((current) => (current?.idMessage === message.idMessage ? null : current))
    } catch (caught) {
      setComposerError(caught instanceof GreenApiError ? caught.message : 'Не удалось удалить сообщение.')
    } finally {
      setDeletingId(null)
    }
  }

  async function deliver(
    chatId: string,
    text: string,
    localId = `local-${crypto.randomUUID()}`,
    quotedMessageId: string | null = null,
  ) {
    setInbox((current) => ({
      ...current,
      messages: upsertOutgoing(current.messages, { localId, chatId, text, quotedMessageId }),
    }))

    try {
      const result = await api.sendMessage(chatId, text, quotedMessageId || undefined)
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
    } catch {
      setInbox((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.localId === localId ? { ...message, status: 'failed' } : message,
        ),
      }))
    }
  }

  return (
    <div className={activeChat ? 'workspace is-thread' : 'workspace'}>
      {offline ? <p className="offline-banner">Нет связи</p> : null}
      {!canSend ? <p className="instance-banner">{instanceMessage(inbox.instanceState)}</p> : null}
      <div className="workspace-body">
        <aside className="chat-list">
          <header className="list-bar">
            <div>
              <strong>Чаты</strong>
              <span className="workspace-id">{session.idInstance}</span>
            </div>
            <button type="button" onClick={onLogout}>
              Выйти
            </button>
          </header>
          <button type="button" className="new-chat" onClick={() => setCreating(true)}>
            Новый чат
          </button>
          {creating ? (
            <form className="new-chat-form" onSubmit={handleSubmit}>
              <label>
                Номер телефона
                <input
                  name="phone"
                  type="tel"
                  value={phone}
                  placeholder="+7 999 000-00-00"
                  autoFocus
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="new-chat-actions">
                <button type="submit" disabled={pending}>
                  {pending ? 'Проверяем…' : 'Создать'}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setCreating(false)
                    setError('')
                    setPhone('')
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : null}
          {chatsLoading ? (
            <ul className="chat-skeleton" aria-busy="true" aria-label="Загружаем чаты">
              {Array.from({ length: 8 }, (_, index) => (
                <li key={index} className="chat-skeleton-row">
                  <span className="skeleton skeleton-avatar" />
                  <span className="chat-row-main">
                    <span className="chat-row-top">
                      <span className="skeleton skeleton-title" />
                      <span className="skeleton skeleton-time" />
                    </span>
                    <span className="skeleton skeleton-preview" />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
          <ul>
            {orderedChats.map((chat) => {
              const latest = latestMessage(inbox.messages, chat.chatId)
              return (
                <li key={chat.chatId}>
                  <button
                    type="button"
                    className={chat.chatId === activeChatId ? 'chat-row is-active' : 'chat-row'}
                    data-chat-id={chat.chatId}
                    onClick={() => setActiveChatId(chat.chatId)}
                  >
                    <span className="avatar" style={{ background: avatarColor(chat.chatId) }}>
                      {initials(chat.title)}
                    </span>
                    <span className="chat-row-main">
                      <span className="chat-row-top">
                        <span className="chat-title">{chat.title}</span>
                        {latest ? <time className="chat-time">{formatListTime(latest.sentAt)}</time> : null}
                      </span>
                      <span className="chat-preview">{latest ? previewText(latest) : chat.phone || chat.username || ''}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          )}
        </aside>
        <section className="conversation">
          {activeChat ? (
            <>
              <header className="conversation-bar">
                <button type="button" className="back-button" onClick={() => setActiveChatId(null)}>
                  Назад
                </button>
                <span className="avatar avatar-sm" style={{ background: avatarColor(activeChat.chatId) }}>
                  {initials(activeChat.title)}
                </span>
                <span className="conversation-heading">
                  <strong>{activeChat.title}</strong>
                  <span>{chatSubtitle(activeChat)}</span>
                </span>
              </header>
              <div className="conversation-log" ref={logRef}>
                {visibleMessages.length === 0 && !historySettled[activeChat.chatId] ? (
                  <div className="message-skeleton" aria-busy="true" aria-label="Загружаем сообщения">
                    {messageSkeleton.map((bubble, index) => (
                      <div key={index} className={`message-skeleton-bubble is-${bubble.side}`}>
                        <span className="skeleton skeleton-author" />
                        {Array.from({ length: bubble.lines }, (_, line) => (
                          <span key={line} className="skeleton skeleton-line" />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
                {groupMessages(visibleMessages).map((item) =>
                  item.kind === 'day' ? (
                    <div key={item.key} className="day-separator">
                      <span>{item.label}</span>
                    </div>
                  ) : (
                    <article key={item.message.localId} className={`message message-${item.message.direction}`}>
                      <p className="message-author">{item.message.direction === 'out' ? 'Вы' : activeChat.title}</p>
                      {item.message.quotedMessageId ? (
                        <blockquote className="message-quote">
                          <QuoteBody messages={inbox.messages} quotedMessageId={item.message.quotedMessageId} chatId={item.message.chatId} title={activeChat.title} />
                        </blockquote>
                      ) : null}
                      <p>{item.message.text}</p>
                      <div className={item.message.status === 'failed' ? 'message-meta is-failed' : 'message-meta'}>
                        {item.message.direction === 'out' ? <span>{outgoingStatus(item.message)}</span> : null}
                        <time>{formatTime(item.message.sentAt)}</time>
                        {item.message.idMessage ? (
                          <button type="button" onClick={() => startReply(item.message)}>
                            Ответить
                          </button>
                        ) : null}
                        {item.message.direction === 'out' && item.message.idMessage && item.message.status === 'sent' ? (
                          <button
                            type="button"
                            disabled={deletingId === item.message.localId}
                            onClick={() => {
                              void removeMessage(item.message)
                            }}
                          >
                            {deletingId === item.message.localId ? 'Удаляем…' : 'Удалить'}
                          </button>
                        ) : null}
                        {item.message.status === 'failed' ? (
                          <button
                            type="button"
                            onClick={() => {
                              void deliver(
                                item.message.chatId,
                                item.message.text,
                                item.message.localId,
                                item.message.quotedMessageId ?? null,
                              )
                            }}
                          >
                            Повторить
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ),
                )}
              </div>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitDraft()
                }}
              >
                {replyTo && replyTo.chatId === activeChat.chatId ? (
                  <div className="reply-bar">
                    <div className="reply-bar-text">
                      <strong>{replyTo.author}</strong>
                      <span>{replyTo.text}</span>
                    </div>
                    <button type="button" aria-label="Отменить ответ" onClick={() => setReplyTo(null)}>
                      ×
                    </button>
                  </div>
                ) : null}
                {composerError ? (
                  <p className="form-error" role="alert">
                    {composerError}
                  </p>
                ) : null}
                <div className="composer-row">
                  <textarea
                    ref={draftRef}
                    name="message"
                    rows={1}
                    value={draft}
                    placeholder="Сообщение"
                    disabled={!canSend}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                  />
                  <button type="submit" aria-label="Отправить" disabled={!canSend}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6l.8 6.8L15 12 4.2 13.6z" />
                    </svg>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="conversation-empty">Введите номер и начните переписку.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function upsertOutgoing(
  messages: ChatMessage[],
  next: { localId: string; chatId: string; text: string; quotedMessageId: string | null },
) {
  const exists = messages.some((message) => message.localId === next.localId)
  if (!exists) {
    return [
      ...messages,
      {
        localId: next.localId,
        idMessage: null,
        chatId: next.chatId,
        text: next.text,
        direction: 'out' as const,
        status: 'sending' as const,
        sentAt: Date.now(),
        quotedMessageId: next.quotedMessageId,
      },
    ]
  }
  return messages.map((message) =>
    message.localId === next.localId
      ? { ...message, status: 'sending' as const, quotedMessageId: next.quotedMessageId ?? message.quotedMessageId }
      : message,
  )
}

function orderChats(chats: InboxState['chats'], messages: ChatMessage[]) {
  const latest = new Map<string, number>()
  for (const message of messages) latest.set(message.chatId, message.sentAt)
  return chats
    .map((chat, index) => ({ chat, index, at: latest.get(chat.chatId) ?? 0 }))
    .sort((left, right) => right.at - left.at || left.index - right.index)
    .map((item) => item.chat)
}

function latestMessage(messages: ChatMessage[], chatId: string): ChatMessage | null {
  let found: ChatMessage | null = null
  for (const message of messages) {
    if (message.chatId === chatId) found = message
  }
  return found
}

function groupMessages(messages: ChatMessage[]) {
  const items: Array<{ kind: 'day'; key: string; label: string } | { kind: 'message'; message: ChatMessage }> = []
  let lastDay = ''
  for (const message of messages) {
    const key = dayKey(message.sentAt)
    if (key !== lastDay) {
      items.push({ kind: 'day', key: `day-${key}`, label: formatDay(message.sentAt) })
      lastDay = key
    }
    items.push({ kind: 'message', message })
  }
  return items
}

function chatLabel(
  info: { name?: string; contactName?: string; username?: string },
  phone: string,
): { title: string; username: string } {
  const username = formatHandle(info.username)
  const title = info.contactName?.trim() || info.name?.trim() || username || phone
  return { title, username }
}

function formatHandle(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function chatSubtitle(chat: ChatItem): string {
  if (chat.username && chat.username !== chat.title) return chat.username
  return chat.phone
}

function mergeChatList(current: ChatItem[], remote: ListedChat[]): ChatItem[] {
  const known = new Map(current.map((chat) => [chat.chatId, chat]))
  const next: ChatItem[] = []
  for (const item of remote) {
    const chat = listedChat(item)
    const existing = known.get(chat.chatId)
    if (!existing) {
      next.push(chat)
      continue
    }
    known.delete(chat.chatId)
    next.push({
      ...existing,
      phone: existing.phone || chat.phone,
      username: existing.username || chat.username,
      title: isPlaceholderTitle(existing.title) ? chat.title : existing.title,
    })
  }
  for (const chat of known.values()) next.push(chat)
  return next
}

function listedChat(chat: ListedChat): ChatItem {
  const username = chat.username ? (chat.username.startsWith('@') ? chat.username : `@${chat.username}`) : ''
  return {
    chatId: chat.chatId,
    phone: chat.phone,
    username,
    title: chat.name || username || chat.phone || chat.chatId,
  }
}

function mergeHistory(state: InboxState, entries: HistoryEntry[]): InboxState {
  const known = new Set(state.messages.map((message) => message.idMessage).filter((id) => id))
  const fresh = entries
    .filter((entry) => !known.has(entry.idMessage))
    .sort((left, right) => left.sentAt - right.sentAt)
    .map((entry) => ({
      localId: entry.idMessage,
      idMessage: entry.idMessage,
      chatId: entry.chatId,
      text: entry.text,
      direction: entry.direction,
      status: entry.direction === 'out' ? ('sent' as const) : ('received' as const),
      sentAt: entry.sentAt,
      quotedMessageId: entry.quotedMessageId,
    }))
  if (fresh.length === 0) return state
  return {
    ...state,
    messages: [...state.messages, ...fresh].sort((left, right) => left.sentAt - right.sentAt),
  }
}

function previewText(message: ChatMessage): string {
  if (message.direction === 'out') return `Вы: ${message.text}`
  return message.text
}

function QuoteBody({
  messages,
  quotedMessageId,
  chatId,
  title,
}: {
  messages: ChatMessage[]
  quotedMessageId: string
  chatId: string
  title: string
}) {
  const quoted = messages.find((message) => message.chatId === chatId && message.idMessage === quotedMessageId)
  if (!quoted) return <span>Сообщение</span>
  return (
    <>
      <strong>{quoted.direction === 'out' ? 'Вы' : title}</strong>
      <span>{quoted.text}</span>
    </>
  )
}

function outgoingStatus(message: ChatMessage): string {
  if (message.status === 'sending') return 'отправляется'
  if (message.status === 'failed') return 'не отправилось'
  return 'отправлено'
}

function instanceMessage(state: string): string {
  if (state === 'notAuthorized' || state === 'starting') {
    return 'Авторизуйте инстанс в личном кабинете GREEN-API.'
  }
  return `Инстанс сейчас недоступен (${state}).`
}

function initials(title: string): string {
  const trimmed = title.trim().replace(/^@+/, '') || title.trim()
  if (/^\d+$/.test(trimmed)) return trimmed.slice(-2)
  const words = trimmed.split(/\s+/).filter(Boolean)
  const first = (value: string) => Array.from(value)[0] ?? ''
  if (words.length >= 2) return (first(words[0]) + first(words[1])).toLocaleUpperCase('ru')
  return Array.from(trimmed).slice(0, 2).join('').toLocaleUpperCase('ru')
}

function avatarColor(chatId: string): string {
  let hash = 0
  for (const char of chatId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return avatarColors[hash % avatarColors.length]
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDay(timestamp: number): string {
  const date = new Date(timestamp)
  const today = startOfDay(new Date())
  const diff = Math.round((today - startOfDay(date)) / 86_400_000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function formatListTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return formatTime(timestamp)
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(date)
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
