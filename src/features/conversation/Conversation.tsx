import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { errorText } from '../../api/client.ts'
import type { ChatItem, ChatMessage } from '../../state/notifications.ts'
import { Avatar } from '../chat/Avatar.tsx'
import { chatSubtitle } from '../chat/format.ts'
import { Composer, type ReplyTarget } from './Composer.tsx'
import { MessageLog } from './MessageLog.tsx'

const messageLimit = 4096

type ConversationProps = {
  chat: ChatItem | null
  messages: ChatMessage[]
  historyReady: boolean
  canSend: boolean
  onBack: () => void
  onSend: (chatId: string, text: string, localId: string, quotedMessageId: string | null) => void
  onDelete: (message: ChatMessage) => Promise<string>
}

export function Conversation({ chat, messages, historyReady, canSend, onBack, onSend, onDelete }: ConversationProps) {
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState('')
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const visibleMessages = chat ? messages.filter((message) => message.chatId === chat.chatId) : []

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, chat?.chatId])

  function submitDraft() {
    if (!chat || !canSend) return
    const text = draft
    if (text.trim().length === 0) return
    if ([...text].length > messageLimit) {
      setComposerError(errorText.tooLong)
      return
    }

    const quotedMessageId = replyTo?.chatId === chat.chatId ? replyTo.idMessage : null
    setComposerError('')
    setDraft('')
    setReplyTo(null)
    onSend(chat.chatId, text, `local-${crypto.randomUUID()}`, quotedMessageId)
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitDraft()
    }
  }

  function startReply(message: ChatMessage) {
    if (!message.idMessage || !chat) return
    setReplyTo({
      chatId: message.chatId,
      idMessage: message.idMessage,
      author: message.direction === 'out' ? 'Вы' : chat.title,
      text: message.text,
    })
    setComposerError('')
    draftRef.current?.focus()
  }

  async function removeMessage(message: ChatMessage) {
    if (!message.idMessage || deletingId) return
    setDeletingId(message.localId)
    setComposerError('')
    const messageError = await onDelete(message)
    setDeletingId(null)
    if (messageError) {
      setComposerError(messageError)
      return
    }
    setReplyTo((current) => (current?.idMessage === message.idMessage ? null : current))
  }

  if (!chat) return <p className="conversation-empty">Введите номер и начните переписку.</p>

  return (
    <>
      <header className="conversation-bar">
        <button type="button" className="back-button" onClick={onBack}>
          Назад
        </button>
        <Avatar chatId={chat.chatId} title={chat.title} small />
        <span className="conversation-heading">
          <strong>{chat.title}</strong>
          <span>{chatSubtitle(chat)}</span>
        </span>
      </header>
      <MessageLog
        title={chat.title}
        messages={visibleMessages}
        historyReady={historyReady}
        deletingId={deletingId}
        logRef={logRef}
        onReply={startReply}
        onDelete={(message) => {
          void removeMessage(message)
        }}
        onRetry={(message) => {
          onSend(message.chatId, message.text, message.localId, message.quotedMessageId ?? null)
        }}
      />
      <Composer
        draft={draft}
        canSend={canSend}
        error={composerError}
        reply={replyTo?.chatId === chat.chatId ? replyTo : null}
        draftRef={draftRef}
        onDraftChange={setDraft}
        onSubmit={submitDraft}
        onKeyDown={handleDraftKeyDown}
        onCancelReply={() => setReplyTo(null)}
      />
    </>
  )
}
