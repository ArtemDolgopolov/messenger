import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createGreenApi, GreenApiError, normalizePhone } from '../api/client.ts'
import type { GreenApiConfig } from '../types/green-api.ts'

type Chat = {
  chatId: string
  phone: string
  title: string
}

type OutgoingMessage = {
  localId: string
  idMessage: string | null
  chatId: string
  text: string
  status: 'sending' | 'sent' | 'failed'
}

const messageLimit = 4096

type ChatHomeProps = {
  session: GreenApiConfig
  onLogout: () => void
}

const missingAccountMessage =
  'Telegram на этом номере не найден или скрыт настройками приватности.'

export function ChatHome({ session, onLogout }: ChatHomeProps) {
  const api = useMemo(() => createGreenApi(session), [session])
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<OutgoingMessage[]>([])
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const activeChat = chats.find((chat) => chat.chatId === activeChatId) ?? null
  const visibleMessages = messages.filter((message) => message.chatId === activeChatId)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, activeChatId])

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

      const chat: Chat = {
        chatId: account.chatId,
        phone: digits,
        title: account.username?.trim() || digits,
      }
      setChats((current) =>
        current.some((item) => item.chatId === chat.chatId) ? current : [chat, ...current],
      )
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
    if (!activeChat) return
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
    setMessages((current) => {
      const exists = current.some((message) => message.localId === localId)
      if (!exists) {
        return [...current, { localId, idMessage: null, chatId, text, status: 'sending' }]
      }
      return current.map((message) =>
        message.localId === localId ? { ...message, status: 'sending' } : message,
      )
    })

    try {
      const result = await api.sendMessage(chatId, text)
      setMessages((current) =>
        current.map((message) =>
          message.localId === localId
            ? { ...message, idMessage: result.idMessage, status: 'sent' }
            : message,
        ),
      )
    } catch {
      setMessages((current) =>
        current.map((message) =>
          message.localId === localId ? { ...message, status: 'failed' } : message,
        ),
      )
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
            {chats.map((chat) => (
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
                  <article key={message.localId} className="message">
                    <p>{message.text}</p>
                    <div className={message.status === 'failed' ? 'message-status is-failed' : 'message-status'}>
                      <span>
                        {message.status === 'sending'
                          ? 'отправляется'
                          : message.status === 'sent'
                            ? 'отправлено'
                            : 'не отправилось'}
                      </span>
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
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                  />
                  <button type="submit">Отправить</button>
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
