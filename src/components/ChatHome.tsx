import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createGreenApi, GreenApiError, normalizePhone } from '../api/client.ts'
import type { GreenApiConfig } from '../types/green-api.ts'

type Chat = {
  chatId: string
  phone: string
  title: string
}

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

  const activeChat = chats.find((chat) => chat.chatId === activeChatId) ?? null

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
            <header className="conversation-bar">
              <strong>{activeChat.title}</strong>
              <span>{activeChat.phone}</span>
            </header>
          ) : (
            <p className="conversation-empty">Создайте чат по номеру телефона.</p>
          )}
        </section>
      </div>
    </div>
  )
}
