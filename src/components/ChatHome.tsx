import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createGreenApi, GreenApiError, normalizePhone } from '../api/client.ts'
import { applyNotification } from '../state/notifications.ts'
import type { ChatMessage, InboxState } from '../state/notifications.ts'
import type { GreenApiConfig } from '../types/green-api.ts'

const messageLimit = 4096
const missingAccountMessage =
  'Telegram на этом номере не найден или скрыт настройками приватности.'

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
  const [offline, setOffline] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const sessionEndRef = useRef(onSessionEnd)

  useEffect(() => {
    sessionEndRef.current = onSessionEnd
  }, [onSessionEnd])

  const activeChat = inbox.chats.find((chat) => chat.chatId === activeChatId) ?? null
  const visibleMessages = inbox.messages.filter((message) => message.chatId === activeChatId)
  const canSend = inbox.instanceState === 'authorized'

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [inbox.messages, activeChatId])

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

      const chat = {
        chatId: account.chatId,
        phone: digits,
        title: account.username?.trim() || digits,
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

    setComposerError('')
    setDraft('')
    void deliver(activeChat.chatId, text)
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitDraft()
    }
  }

  async function deliver(chatId: string, text: string, localId = `local-${crypto.randomUUID()}`) {
    setInbox((current) => ({
      ...current,
      messages: upsertOutgoing(current.messages, { localId, chatId, text }),
    }))

    try {
      const result = await api.sendMessage(chatId, text)
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
    <div className="workspace">
      <header className="workspace-bar">
        <strong>Чат</strong>
        <span className="workspace-id">{session.idInstance}</span>
        <button type="button" onClick={onLogout}>
          Выйти
        </button>
      </header>
      {offline ? <p className="offline-banner">Нет связи</p> : null}
      {!canSend ? <p className="instance-banner">{instanceMessage(inbox.instanceState)}</p> : null}
      <div className="workspace-body">
        <aside className="chat-list">
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
          <ul>
            {inbox.chats.map((chat) => (
              <li key={chat.chatId}>
                <button
                  type="button"
                  className={chat.chatId === activeChatId ? 'chat-row is-active' : 'chat-row'}
                  onClick={() => setActiveChatId(chat.chatId)}
                >
                  <span className="chat-title">{chat.title}</span>
                  <span className="chat-phone">{chat.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="conversation">
          {activeChat ? (
            <>
              <header className="conversation-bar">
                <strong>{activeChat.title}</strong>
                <span>{activeChat.phone}</span>
              </header>
              <div className="conversation-log" ref={logRef}>
                {visibleMessages.map((message) => (
                  <article key={message.localId} className={`message message-${message.direction}`}>
                    <p>{message.text}</p>
                    {message.direction === 'out' ? (
                      <div className={message.status === 'failed' ? 'message-status is-failed' : 'message-status'}>
                        <span>{outgoingStatus(message)}</span>
                        {message.status === 'failed' ? (
                          <button
                            type="button"
                            onClick={() => {
                              void deliver(message.chatId, message.text, message.localId)
                            }}
                          >
                            Повторить
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitDraft()
                }}
              >
                {composerError ? (
                  <p className="form-error" role="alert">
                    {composerError}
                  </p>
                ) : null}
                <div className="composer-row">
                  <textarea
                    name="message"
                    rows={1}
                    value={draft}
                    placeholder="Сообщение"
                    disabled={!canSend}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                  />
                  <button type="submit" disabled={!canSend}>
                    Отправить
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="conversation-empty">Создайте чат по номеру телефона.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function upsertOutgoing(messages: ChatMessage[], next: { localId: string; chatId: string; text: string }) {
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
      },
    ]
  }
  return messages.map((message) =>
    message.localId === next.localId ? { ...message, status: 'sending' as const } : message,
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
