import type {
  CheckAccountResult,
  ContactInfo,
  DeleteNotificationResult,
  HistoryEntry,
  ListedChat,
  GreenApiConfig,
  Notification,
  NotificationBody,
  SendMessageResult,
  StateInstanceResult,
} from '../types/green-api.ts'

const messageLimit = 4096

const accountCache = new Map<string, CheckAccountResult>()
const contactCache = new Map<string, ContactInfo>()

export class GreenApiError extends Error {
  readonly status: number
  readonly reason?: string

  constructor(message: string, status: number, reason?: string) {
    super(message)
    this.name = 'GreenApiError'
    this.status = status
    this.reason = reason
  }
}

export type GreenApiClient = {
  getStateInstance: () => Promise<StateInstanceResult>
  checkAccount: (phone: string) => Promise<CheckAccountResult>
  getContactInfo: (chatId: string) => Promise<ContactInfo>
  getChats: () => Promise<ListedChat[]>
  getChatHistory: (chatId: string, count?: number) => Promise<HistoryEntry[]>
  sendMessage: (chatId: string, message: string, quotedMessageId?: string) => Promise<SendMessageResult>
  deleteMessage: (chatId: string, idMessage: string) => Promise<void>
  receiveNotification: (receiveTimeout?: number) => Promise<Notification | null>
  deleteNotification: (receiptId: number) => Promise<DeleteNotificationResult>
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function hydrateAccounts(idInstance: string, accounts: Record<string, CheckAccountResult>) {
  for (const [phone, result] of Object.entries(accounts)) {
    if (!result || typeof result.chatId !== 'string') continue
    accountCache.set(`${idInstance}:${phone}`, result)
  }
}

export function exportAccounts(idInstance: string): Record<string, CheckAccountResult> {
  const prefix = `${idInstance}:`
  const accounts: Record<string, CheckAccountResult> = {}
  for (const [key, result] of accountCache) {
    if (key.startsWith(prefix)) accounts[key.slice(prefix.length)] = result
  }
  return accounts
}

export function createGreenApi(config: GreenApiConfig): GreenApiClient {
  const apiUrl = config.apiUrl.trim().replace(/\/+$/, '')
  const idInstance = config.idInstance.trim()
  const apiTokenInstance = config.apiTokenInstance.trim()

  if (!apiUrl || !idInstance || !apiTokenInstance) {
    throw new GreenApiError('Не заполнены apiUrl, idInstance или apiTokenInstance.', 400)
  }

  const endpoint = (method: string, extra = '') =>
    `${apiUrl}/waInstance${idInstance}/${method}/${apiTokenInstance}${extra}`

  return {
    async getStateInstance() {
      const body = await request(endpoint('getStateInstance'))
      return parseState(body)
    },

    async checkAccount(phone) {
      const digits = normalizePhone(phone)
      if (!digits) {
        throw new GreenApiError('Номер должен содержать только цифры.', 400, 'invalid_phone')
      }

      const key = `${idInstance}:${digits}`
      const saved = accountCache.get(key)
      if (saved) return saved

      const body = await request(endpoint('checkAccount'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: Number(digits) }),
      })
      const result = parseCheckAccount(body)
      accountCache.set(key, result)
      return result
    },

    async getContactInfo(chatId) {
      const id = chatId.trim()
      if (!id) throw new GreenApiError('Не указан chatId.', 400, 'empty_chat')

      const key = `${idInstance}:${id}`
      const saved = contactCache.get(key)
      if (saved) return saved

      const body = await request(endpoint('getContactInfo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: id }),
      })
      const result = parseContactInfo(body)
      contactCache.set(key, result)
      return result
    },

    async getChats() {
      const body = await request(endpoint('getChats'))
      return parseChats(body)
    },

    async getChatHistory(chatId, count = 50) {
      const id = chatId.trim()
      if (!id) return []
      const body = await request(endpoint('getChatHistory'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: id, count }),
      })
      return parseHistory(body, id)
    },

    async sendMessage(chatId, message, quotedMessageId) {
      const text = message
      if (text.trim().length === 0) {
        throw new GreenApiError('Пустое сообщение не отправляется.', 400, 'empty_message')
      }
      if ([...text].length > messageLimit) {
        throw new GreenApiError('Текст сообщения длиннее 4096 символов.', 400, 'message_too_long')
      }
      if (chatId.trim().length === 0) {
        throw new GreenApiError('Не указан chatId.', 400, 'empty_chat')
      }

      const payload: { chatId: string; message: string; quotedMessageId?: string } = { chatId, message: text }
      if (quotedMessageId) payload.quotedMessageId = quotedMessageId

      const body = await request(endpoint('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return parseSendMessage(body)
    },

    async deleteMessage(chatId, idMessage) {
      if (!chatId.trim() || !idMessage.trim()) {
        throw new GreenApiError('Не указано сообщение для удаления.', 400, 'empty_delete')
      }
      await request(endpoint('deleteMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, idMessage, onlySenderDelete: false }),
      })
    },

    async receiveNotification(receiveTimeout = 20) {
      const body = await request(endpoint('receiveNotification', `?receiveTimeout=${receiveTimeout}`))
      if (body === null) return null
      return parseNotification(body)
    },

    async deleteNotification(receiptId) {
      const body = await request(endpoint('deleteNotification', `/${receiptId}`), {
        method: 'DELETE',
      })
      return parseDelete(body)
    },
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new GreenApiError('Нет связи с GREEN-API.', 0, 'network')
  }

  const body = await readBody(response)
  if (!response.ok || isFailedBody(body)) {
    throw toError(response.status, body)
  }
  return body
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function isFailedBody(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && 'status' in body && body.status === false)
}

function reasonFrom(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return undefined

  if ('reason' in body && typeof body.reason === 'string') return body.reason
  if ('message' in body && typeof body.message === 'string') return body.message

  if ('data' in body && body.data && typeof body.data === 'object' && 'reason' in body.data) {
    const reason = body.data.reason
    if (typeof reason === 'string') return reason
  }

  return undefined
}

function toError(status: number, body: unknown): GreenApiError {
  const reason = reasonFrom(body)

  if (status === 401 || status === 403) {
    return new GreenApiError('Пара idInstance и apiTokenInstance не подошла.', status, reason)
  }
  if (
    status === 469 ||
    reason === 'rate_limit_exceeded' ||
    reason === 'Rate limited by messenger'
  ) {
    return new GreenApiError(
      'Слишком много проверок номеров. Подождите и повторите запрос позже.',
      status || 469,
      reason,
    )
  }
  if (reason === 'instance is starting or not authorized') {
    return new GreenApiError('Инстанс не авторизован или ещё запускается.', status, reason)
  }
  if (reason?.toLowerCase().includes('webhook')) {
    return new GreenApiError(
      'В кабинете заполнен webhook. Очистите webhookUrl, чтобы принимать сообщения.',
      status,
      reason,
    )
  }
  if (reason?.includes('4096')) {
    return new GreenApiError('Текст сообщения длиннее 4096 символов.', status, reason)
  }
  if (reason?.toLowerCase().includes('phonenumber')) {
    return new GreenApiError('Номер должен содержать только цифры.', status, reason)
  }
  if (reason === 'Message by id not found') {
    return new GreenApiError('Сообщение уже удалено или не найдено.', status, reason)
  }
  if (reason === 'Deleting this message type is not supported') {
    return new GreenApiError('Это сообщение нельзя удалить.', status, reason)
  }

  return new GreenApiError('Запрос к GREEN-API не выполнился.', status, reason)
}

function parseState(body: unknown): StateInstanceResult {
  if (!isRecord(body) || typeof body.stateInstance !== 'string') {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_state')
  }
  return { stateInstance: body.stateInstance }
}

function parseCheckAccount(body: unknown): CheckAccountResult {
  if (!isRecord(body) || typeof body.exist !== 'boolean' || typeof body.chatId !== 'string') {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_account')
  }

  return {
    exist: body.exist,
    chatId: body.chatId,
    username: typeof body.username === 'string' ? body.username : undefined,
    phoneNumber: typeof body.phoneNumber === 'number' ? body.phoneNumber : undefined,
    fromCache: typeof body.fromCache === 'boolean' ? body.fromCache : undefined,
  }
}

function parseChats(body: unknown): ListedChat[] {
  if (!Array.isArray(body)) {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_chats')
  }
  const chats: ListedChat[] = []
  for (const item of body) {
    if (!isRecord(item) || (typeof item.chatId !== 'string' && typeof item.chatId !== 'number')) continue
    const chatId = String(item.chatId)
    if (!chatId) continue
    chats.push({
      chatId,
      name: typeof item.name === 'string' ? item.name.trim() : '',
      phone: typeof item.phoneNumber === 'number' && item.phoneNumber > 0 ? String(item.phoneNumber) : '',
      username: typeof item.username === 'string' ? item.username.trim() : '',
    })
  }
  return chats
}

function parseHistory(body: unknown, chatId: string): HistoryEntry[] {
  if (!Array.isArray(body)) return []
  const entries: HistoryEntry[] = []
  for (const item of body) {
    if (!isRecord(item)) continue
    const idMessage = typeof item.idMessage === 'string' ? item.idMessage : ''
    if (!idMessage) continue
    const timestamp = typeof item.timestamp === 'number' ? item.timestamp : 0
    if (item.isDeleted === true || item.typeMessage === 'deletedMessage') continue
    const text =
      item.typeMessage === 'textMessage' && typeof item.textMessage === 'string'
        ? item.textMessage
        : 'сообщение другого типа'
    const quoted = isRecord(item.quotedMessage) ? item.quotedMessage.stanzaId : ''
    entries.push({
      idMessage,
      chatId,
      text,
      direction: item.type === 'outgoing' ? 'out' : 'in',
      sentAt: timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp || Date.now(),
      quotedMessageId: typeof quoted === 'string' && quoted ? quoted : null,
    })
  }
  return entries
}

function parseContactInfo(body: unknown): ContactInfo {
  if (!isRecord(body)) {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_contact')
  }
  return {
    name: typeof body.name === 'string' ? body.name : '',
    contactName: typeof body.contactName === 'string' ? body.contactName : '',
    username: typeof body.username === 'string' ? body.username : '',
  }
}

function parseSendMessage(body: unknown): SendMessageResult {
  if (!isRecord(body) || typeof body.idMessage !== 'string') {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_send')
  }
  return { idMessage: body.idMessage }
}

function parseNotification(body: unknown): Notification {
  if (!isRecord(body) || typeof body.receiptId !== 'number' || !isRecord(body.body)) {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_notification')
  }
  if (typeof body.body.typeWebhook !== 'string') {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_notification')
  }

  return {
    receiptId: body.receiptId,
    body: body.body as NotificationBody,
  }
}

function parseDelete(body: unknown): DeleteNotificationResult {
  if (!isRecord(body) || typeof body.result !== 'boolean') {
    throw new GreenApiError('GREEN-API вернул неожиданный ответ.', 200, 'invalid_delete')
  }
  return { result: body.result }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
