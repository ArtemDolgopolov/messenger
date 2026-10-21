import type { RefObject } from 'react'
import type { ChatMessage } from '../../state/notifications.ts'
import { groupMessages, messageSkeleton, outgoingStatus, formatTime } from '../chat/format.ts'

type MessageLogProps = {
  title: string
  messages: ChatMessage[]
  historyReady: boolean
  deletingId: string | null
  logRef: RefObject<HTMLDivElement | null>
  onReply: (message: ChatMessage) => void
  onDelete: (message: ChatMessage) => void
  onRetry: (message: ChatMessage) => void
}

export function MessageLog({
  title,
  messages,
  historyReady,
  deletingId,
  logRef,
  onReply,
  onDelete,
  onRetry,
}: MessageLogProps) {
  return (
    <div className="conversation-log" ref={logRef}>
      {messages.length === 0 && !historyReady ? (
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
      {groupMessages(messages).map((item) =>
        item.kind === 'day' ? (
          <div key={item.key} className="day-separator">
            <span>{item.label}</span>
          </div>
        ) : (
          <article key={item.message.localId} className={`message message-${item.message.direction}`}>
            <p className="message-author">{item.message.direction === 'out' ? 'Вы' : title}</p>
            {item.message.quotedMessageId ? (
              <blockquote className="message-quote">
                <QuoteBody messages={messages} quotedMessageId={item.message.quotedMessageId} title={title} />
              </blockquote>
            ) : null}
            <p>{item.message.text}</p>
            <div className={item.message.status === 'failed' ? 'message-meta is-failed' : 'message-meta'}>
              {item.message.direction === 'out' ? <span>{outgoingStatus(item.message)}</span> : null}
              <time>{formatTime(item.message.sentAt)}</time>
              {item.message.idMessage ? (
                <button type="button" onClick={() => onReply(item.message)}>
                  Ответить
                </button>
              ) : null}
              {item.message.direction === 'out' && item.message.idMessage && item.message.status === 'sent' ? (
                <button
                  type="button"
                  disabled={deletingId === item.message.localId}
                  onClick={() => onDelete(item.message)}
                >
                  {deletingId === item.message.localId ? 'Удаляем…' : 'Удалить'}
                </button>
              ) : null}
              {item.message.status === 'failed' ? (
                <button type="button" onClick={() => onRetry(item.message)}>
                  Повторить
                </button>
              ) : null}
            </div>
          </article>
        ),
      )}
    </div>
  )
}

function QuoteBody({
  messages,
  quotedMessageId,
  title,
}: {
  messages: ChatMessage[]
  quotedMessageId: string
  title: string
}) {
  const quoted = messages.find((message) => message.idMessage === quotedMessageId)
  if (!quoted) return <span>Сообщение</span>
  return (
    <>
      <strong>{quoted.direction === 'out' ? 'Вы' : title}</strong>
      <span>{quoted.text}</span>
    </>
  )
}
