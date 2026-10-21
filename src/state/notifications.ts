import type { Notification, NotificationBody } from '../types/green-api.ts'

export type ChatItem = {
  chatId: string
  phone: string
  title: string
  username?: string
}

export type ChatMessage = {
  localId: string
  idMessage: string | null
  chatId: string
  text: string
  direction: 'in' | 'out'
  status: 'sending' | 'sent' | 'failed' | 'received'
  sentAt: number
}

export type InboxState = {
  chats: ChatItem[]
  messages: ChatMessage[]
  instanceState: string
}

const otherTypeText = 'сообщение другого типа'

export function applyNotification(state: InboxState, note: Notification): InboxState {
  const body = note.body

  if (body.typeWebhook === 'stateInstanceChanged') {
    return { ...state, instanceState: body.stateInstance || state.instanceState }
  }

  const chatId = body.senderData?.chatId
  if (!chatId) return state

  if (body.typeWebhook === 'outgoingAPIMessageReceived') {
    return mergeOutgoing(state, note, chatId)
  }

  if (body.typeWebhook === 'incomingMessageReceived') {
    return addIncoming(state, note, chatId)
  }

  return state
}

function mergeOutgoing(state: InboxState, note: Notification, chatId: string): InboxState {
  const idMessage = note.body.idMessage
  const chats = ensureChat(state.chats, note.body, chatId)
  if (idMessage && state.messages.some((message) => message.idMessage === idMessage)) {
    return { ...state, chats }
  }

  const content = messageContent(note.body)
  const pending = content.other
    ? undefined
    : state.messages.find(
        (message) =>
          message.direction === 'out' &&
          message.chatId === chatId &&
          message.idMessage === null &&
          message.text === content.text,
      )

  if (pending) {
    return {
      ...state,
      chats,
      messages: state.messages.map((message) =>
        message.localId === pending.localId
          ? { ...message, idMessage: idMessage ?? message.idMessage, status: 'sent' }
          : message,
      ),
    }
  }

  const localId = idMessage ?? `receipt-${note.receiptId}`
  if (state.messages.some((message) => message.localId === localId)) return { ...state, chats }

  return {
    ...state,
    chats,
    messages: [
      ...state.messages,
      {
        localId,
        idMessage: idMessage ?? null,
        chatId,
        text: content.text,
        direction: 'out',
        status: 'sent',
        sentAt: sentAtFrom(note.body),
      },
    ],
  }
}

function addIncoming(state: InboxState, note: Notification, chatId: string): InboxState {
  const idMessage = note.body.idMessage
  const chats = ensureChat(state.chats, note.body, chatId)
  if (idMessage && state.messages.some((message) => message.idMessage === idMessage)) {
    return { ...state, chats }
  }

  const localId = idMessage ?? `receipt-${note.receiptId}`
  if (state.messages.some((message) => message.localId === localId)) return { ...state, chats }

  const content = messageContent(note.body)
  return {
    ...state,
    chats,
    messages: [
      ...state.messages,
      {
        localId,
        idMessage: idMessage ?? null,
        chatId,
        text: content.text,
        direction: 'in',
        status: 'received',
        sentAt: sentAtFrom(note.body),
      },
    ],
  }
}

function ensureChat(chats: ChatItem[], body: NotificationBody, chatId: string): ChatItem[] {
  const phone = body.senderData?.senderPhoneNumber ? String(body.senderData.senderPhoneNumber) : ''
  const realName = profileName(body)
  const existing = chats.find((chat) => chat.chatId === chatId)
  if (existing) {
    if (!realName || !isPlaceholderTitle(existing.title)) return chats
    return chats.map((chat) => (chat.chatId === chatId ? { ...chat, title: realName, phone: chat.phone || phone } : chat))
  }
  return [{ chatId, phone, title: realName || phone || chatId }, ...chats]
}

function profileName(body: NotificationBody): string {
  const data = body.senderData
  const candidates = [data?.senderContactName, data?.chatName, data?.senderName]
  for (const candidate of candidates) {
    const value = candidate?.trim() ?? ''
    if (value && !value.startsWith('@')) return value
  }
  return ''
}

export function isPlaceholderTitle(title: string): boolean {
  return title.startsWith('@') || /^\d+$/.test(title)
}

function sentAtFrom(body: NotificationBody): number {
  const timestamp = body.timestamp
  if (!timestamp) return Date.now()
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

function messageContent(body: NotificationBody): { text: string; other: boolean } {
  if (body.messageData?.typeMessage === 'textMessage') {
    return { text: body.messageData.textMessageData?.textMessage ?? '', other: false }
  }
  return { text: otherTypeText, other: true }
}
