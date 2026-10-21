import type { KeyboardEvent, RefObject } from 'react'

export type ReplyTarget = {
  chatId: string
  idMessage: string
  author: string
  text: string
}

type ComposerProps = {
  draft: string
  canSend: boolean
  error: string
  reply: ReplyTarget | null
  draftRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onCancelReply: () => void
}

export function Composer({
  draft,
  canSend,
  error,
  reply,
  draftRef,
  onDraftChange,
  onSubmit,
  onKeyDown,
  onCancelReply,
}: ComposerProps) {
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {reply ? (
        <div className="reply-bar">
          <div className="reply-bar-text">
            <strong>{reply.author}</strong>
            <span>{reply.text}</span>
          </div>
          <button type="button" aria-label="Отменить ответ" onClick={onCancelReply}>
            ×
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
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
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" aria-label="Отправить" disabled={!canSend}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6l.8 6.8L15 12 4.2 13.6z" />
          </svg>
        </button>
      </div>
    </form>
  )
}
