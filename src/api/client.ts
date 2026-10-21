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

export const errorText = {
  unauthorized:
    'Инстанс не авторизован или ещё запускается. Авторизуйте его в личном кабинете GREEN-API.',
  instanceUnavailable: 'Инстанс сейчас недоступен. Проверьте его в личном кабинете GREEN-API.',
  webhook: 'В кабинете заполнен webhook, приём сообщений по HTTP API недоступен. Очистите webhookUrl.',
  hiddenAccount: 'Telegram на этом номере не найден или скрыт настройками приватности.',
  phoneRateLimit: 'Слишком много проверок номеров. Подождите и повторите запрос позже.',
  rateLimit: 'Слишком много запросов. Подождите и повторите позже.',
  tooLong: 'Текст сообщения длиннее 4096 символов.',
  offline: 'Нет сети, приём сообщений временно остановлен.',
  receivePaused: 'Приём сообщений временно остановлен.',
  badCredentials: 'Пара idInstance и apiTokenInstance не подошла.',
  network: 'Нет связи с GREEN-API.',
  generic: 'Запрос к GREEN-API не выполнился.',
} as const

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
  stopReceive: () => void
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

export function greenApiUrl(): string {
  return (import.meta.env.VITE_GREEN_API_URL ?? '').trim().replace(/\/+$/, '')
}

export function withApiUrl(config: GreenApiConfig): GreenApiConfig {
  return { ...config, apiUrl: greenApiUrl() }
}

export function createGreenApi(config: GreenApiConfig): GreenApiClient {
  const apiUrl = greenApiUrl()
  const idInstance = config.idInstance.trim()
  const apiTokenInstance = config.apiTokenInstance.trim()

  if (!apiUrl) {
    throw new GreenApiError('Не задан адрес API. Укажите VITE_GREEN_API_URL в файле .env.', 400, 'missing_api_url')
  }
  if (!idInstance || !apiTokenInstance) {
    throw new GreenApiError('Не заполнены idInstance или apiTokenInstance.', 400, 'missing_fields')
  }

  const endpoint = (method: string, extra = '') =>
    `${apiUrl}/waInstance${idInstance}/${method}/${apiTokenInstance}${extra}`
  const lane = createLane()

  return {
    async getStateInstance() {
      const body = await lane.call(() => request(endpoint('getStateInstance')))
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

      let body: unknown
      try {
        body = await lane.call(() =>
          request(endpoint('checkAccount'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: Number(digits) }),
          }),
        )
      } catch (error) {
        if (error instanceof GreenApiError && isRateLimit(error)) {
          throw new GreenApiError(errorText.phoneRateLimit, error.status || 469, error.reason)
        }
        throw error
      }
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

      const body = await lane.call(() =>
        request(endpoint('getContactInfo'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: id }),
        }),
      )
      const result = parseContactInfo(body)
      contactCache.set(key, result)
      return result
    },

    async getChats() {
      const body = await lane.call(() => request(endpoint('getChats')))
      return parseChats(body)
    },

    async getChatHistory(chatId, count = 50) {
      const id = chatId.trim()
      if (!id) return []
      const body = await lane.call(() =>
        request(endpoint('getChatHistory'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: id, count }),
        }),
      )
      return parseHistory(body, id)
    },

    async sendMessage(chatId, message, quotedMessageId) {
      const text = message
      if (text.trim().length === 0) {
        throw new GreenApiError('Пустое сообщение не отправляется.', 400, 'empty_message')
      }
      if ([...text].length > messageLimit) {
        throw new GreenApiError(errorText.tooLong, 400, 'message_too_long')
      }
      if (chatId.trim().length === 0) {
        throw new GreenApiError('Не указан chatId.', 400, 'empty_chat')
      }

      const payload: { chatId: string; message: string; quotedMessageId?: string } = { chatId, message: text }
      if (quotedMessageId) payload.quotedMessageId = quotedMessageId

      const body = await lane.call(() =>
        request(endpoint('sendMessage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
      return parseSendMessage(body)
    },

    async deleteMessage(chatId, idMessage) {
      if (!chatId.trim() || !idMessage.trim()) {
        throw new GreenApiError('Не указано сообщение для удаления.', 400, 'empty_delete')
      }
      await lane.call(() =>
        request(endpoint('deleteMessage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, idMessage, onlySenderDelete: false }),
        }),
      )
    },

    async receiveNotification(receiveTimeout = 20) {
      const body = await lane.receive((signal) =>
        request(endpoint('receiveNotification', `?receiveTimeout=${receiveTimeout}`), { signal }),
      )
      if (body === null) return null
      return parseNotification(body)
    },

    async deleteNotification(receiptId) {
      const body = await lane.call(() =>
        request(endpoint('deleteNotification', `/${receiptId}`), {
          method: 'DELETE',
        }),
      )
      return parseDelete(body)
    },

    stopReceive() {
      lane.stopReceive()
    },
  }
}

function createLane() {
  type Task = {
    kind: 'call' | 'receive'
    run: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }

  const tasks: Task[] = []
  let pumping = false
  let receiveAbort: AbortController | null = null

  function stopReceive() {
    receiveAbort?.abort()
  }

  function enqueue<T>(kind: 'call' | 'receive', run: () => Promise<T>, before?: () => void): Promise<T> {
    before?.()
    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        kind,
        run,
        resolve: (value) => resolve(value as T),
        reject,
      }
      const queuedReceive = kind === 'call' ? tasks.findIndex((item) => item.kind === 'receive') : -1
      if (queuedReceive === -1) tasks.push(task)
      else tasks.splice(queuedReceive, 0, task)
      void pump()
    })
  }

  async function pump() {
    if (pumping) return
    pumping = true
    while (tasks.length > 0) {
      const task = tasks.shift()
      if (!task) break
      try {
        task.resolve(await task.run())
      } catch (error) {
        task.reject(error)
      }
    }
    pumping = false
    if (tasks.length > 0) void pump()
  }

  return {
    call<T>(run: () => Promise<T>) {
      return enqueue('call', run)
    },
    receive<T>(run: (signal: AbortSignal) => Promise<T>) {
      return enqueue('receive', async () => {
        const controller = new AbortController()
        receiveAbort = controller
        try {
          return await run(controller.signal)
        } finally {
          if (receiveAbort === controller) receiveAbort = null
        }
      })
    },
    stopReceive,
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new GreenApiError(errorText.network, 0, 'network')
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
    return new GreenApiError(errorText.badCredentials, status, reason)
  }
  if (isRateLimitReason(status, reason)) {
    return new GreenApiError(errorText.rateLimit, status || 469, reason)
  }
  if (reason === 'instance is starting or not authorized') {
    return new GreenApiError(errorText.unauthorized, status, reason)
  }
  if (reason?.toLowerCase().includes('webhook')) {
    return new GreenApiError(errorText.webhook, status, reason)
  }
  if (reason?.includes('4096')) {
    return new GreenApiError(errorText.tooLong, status, reason)
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

  return new GreenApiError(errorText.generic, status, reason)
}

function isRateLimit(error: GreenApiError): boolean {
  return isRateLimitReason(error.status, error.reason)
}

function isRateLimitReason(status: number, reason: string | undefined): boolean {
  return status === 469 || reason === 'rate_limit_exceeded' || reason === 'Rate limited by messenger'
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
