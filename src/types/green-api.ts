export type GreenApiConfig = {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type StateInstanceResult = {
  stateInstance: string
}

export type CheckAccountResult = {
  exist: boolean
  chatId: string
  username?: string
  phoneNumber?: number
  fromCache?: boolean
}

export type ContactInfo = {
  name: string
  contactName: string
  username: string
}

export type ListedChat = {
  chatId: string
  name: string
  phone: string
  username: string
}

export type HistoryEntry = {
  idMessage: string
  chatId: string
  text: string
  direction: 'in' | 'out'
  sentAt: number
  quotedMessageId: string | null
}

export type SendMessageResult = {
  idMessage: string
}

export type SenderData = {
  chatId: string
  chatName?: string
  sender?: string
  senderName?: string
  senderContactName?: string
  senderPhoneNumber?: number
  chatType?: string
}

export type MessageData = {
  typeMessage: string
  textMessageData?: {
    textMessage: string
  }
  quotedMessage?: {
    stanzaId?: string
    participant?: string
  }
  deletedMessageData?: {
    stanzaId?: string
  }
}

export type NotificationBody = {
  typeWebhook: string
  instanceData?: {
    idInstance: number
    wid: string
    typeInstance: string
  }
  timestamp?: number
  idMessage?: string
  status?: string
  stateInstance?: string
  senderData?: SenderData
  messageData?: MessageData
}

export type Notification = {
  receiptId: number
  body: NotificationBody
}

export type DeleteNotificationResult = {
  result: boolean
}
