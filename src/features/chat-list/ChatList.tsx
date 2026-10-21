import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { ChatItem, ChatMessage } from '../../state/notifications.ts'
import { Avatar } from '../chat/Avatar.tsx'
import { formatListTime, previewText } from '../chat/format.ts'
import { latestMessage, orderChats } from '../chat/model.ts'
import { NewChatForm } from './NewChatForm.tsx'

type ChatListProps = {
  idInstance: string
  chats: ChatItem[]
  messages: ChatMessage[]
  activeChatId: string | null
  loading: boolean
  onLogout: () => void
  onSelect: (chatId: string) => void
  onCreate: (phone: string) => Promise<string>
}

export function ChatList({
  idInstance,
  chats,
  messages,
  activeChatId,
  loading,
  onLogout,
  onSelect,
  onCreate,
}: ChatListProps) {
  const [creating, setCreating] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const orderedChats = useMemo(() => orderChats(chats, messages), [chats, messages])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    const message = await onCreate(phone)
    setPending(false)
    if (message) {
      setError(message)
      return
    }
    setPhone('')
    setCreating(false)
  }

  return (
    <aside className="chat-list">
      <header className="list-bar">
        <div>
          <strong>Чаты</strong>
          <span className="workspace-id">{idInstance}</span>
        </div>
        <button type="button" onClick={onLogout}>
          Выйти
        </button>
      </header>
      <button type="button" className="new-chat" onClick={() => setCreating(true)}>
        Новый чат
      </button>
      {creating ? (
        <NewChatForm
          phone={phone}
          error={error}
          pending={pending}
          onPhoneChange={setPhone}
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          onCancel={() => {
            setCreating(false)
            setError('')
            setPhone('')
          }}
        />
      ) : null}
      {loading ? <ChatListSkeleton /> : (
        <ul>
          {orderedChats.map((chat) => {
            const latest = latestMessage(messages, chat.chatId)
            return (
              <li key={chat.chatId}>
                <button
                  type="button"
                  className={chat.chatId === activeChatId ? 'chat-row is-active' : 'chat-row'}
                  data-chat-id={chat.chatId}
                  onClick={() => onSelect(chat.chatId)}
                >
                  <Avatar chatId={chat.chatId} title={chat.title} />
                  <span className="chat-row-main">
                    <span className="chat-row-top">
                      <span className="chat-title">{chat.title}</span>
                      {latest ? <time className="chat-time">{formatListTime(latest.sentAt)}</time> : null}
                    </span>
                    <span className="chat-preview">
                      {latest ? previewText(latest) : chat.phone || chat.username || ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

function ChatListSkeleton() {
  return (
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
  )
}
