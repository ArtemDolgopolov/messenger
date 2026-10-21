import { isPlaceholderTitle } from '../../state/notifications.ts'
import type { ChatItem, ChatMessage, InboxState } from '../../state/notifications.ts'
import type { HistoryEntry, ListedChat } from '../../types/green-api.ts'

export function upsertOutgoing(
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

export function orderChats(chats: InboxState['chats'], messages: ChatMessage[]) {
  const latest = new Map<string, number>()
  for (const message of messages) latest.set(message.chatId, message.sentAt)
  return chats
    .map((chat, index) => ({ chat, index, at: latest.get(chat.chatId) ?? 0 }))
    .sort((left, right) => right.at - left.at || left.index - right.index)
    .map((item) => item.chat)
}

export function latestMessage(messages: ChatMessage[], chatId: string): ChatMessage | null {
  let found: ChatMessage | null = null
  for (const message of messages) {
    if (message.chatId === chatId) found = message
  }
  return found
}

export function chatLabel(
  info: { name?: string; contactName?: string; username?: string },
  phone: string,
): { title: string; username: string } {
  const username = formatHandle(info.username)
  const title = info.contactName?.trim() || info.name?.trim() || username || phone
  return { title, username }
}

export function mergeChatList(current: ChatItem[], remote: ListedChat[]): ChatItem[] {
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

export function mergeHistory(state: InboxState, entries: HistoryEntry[]): InboxState {
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

function listedChat(chat: ListedChat): ChatItem {
  const username = chat.username ? (chat.username.startsWith('@') ? chat.username : `@${chat.username}`) : ''
  return {
    chatId: chat.chatId,
    phone: chat.phone,
    username,
    title: chat.name || username || chat.phone || chat.chatId,
  }
}

function formatHandle(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}
