import type { CheckAccountResult, GreenApiConfig } from '../types/green-api.ts'
import type { ChatItem, ChatMessage } from '../state/notifications.ts'

const databaseName = 'messenger'
const legacyKey = 'messenger.session'
const messageLimit = 500

export type Cabinet = {
  session: GreenApiConfig | null
  chats: ChatItem[]
  messages: ChatMessage[]
  accounts: Record<string, CheckAccountResult>
}

type ActiveCabinet = {
  idInstance: string
}

let databasePromise: Promise<IDBDatabase> | null = null
let writeEpoch = 0

export async function readSession(): Promise<GreenApiConfig | null> {
  forgetLegacySession()
  try {
    const active = await readRecord<ActiveCabinet>('active')
    if (!active?.idInstance) return null
    const cabinet = await readCabinet(active.idInstance)
    if (!isSession(cabinet?.session)) return null
    return cabinet.session
  } catch {
    return null
  }
}

export async function writeSession(session: GreenApiConfig): Promise<void> {
  forgetLegacySession()
  try {
    const existing = await readCabinet(session.idInstance)
    await writeCabinet(session.idInstance, {
      session,
      chats: existing?.chats ?? [],
      messages: existing?.messages ?? [],
      accounts: existing?.accounts ?? {},
    })
    await writeRecord('active', { idInstance: session.idInstance } satisfies ActiveCabinet)
  } catch {
    return
  }
}

export async function clearSession(idInstance?: string): Promise<void> {
  writeEpoch += 1
  forgetLegacySession()
  try {
    const active = idInstance ?? (await readRecord<ActiveCabinet>('active'))?.idInstance
    if (active) {
      const cabinet = await readCabinet(active)
      if (cabinet) await writeCabinet(active, { ...cabinet, session: null })
    }
    await deleteRecord('active')
  } catch {
    return
  }
}

export async function readCabinet(idInstance: string): Promise<Cabinet | null> {
  try {
    const cabinet = await readRecord<Cabinet>(cabinetKey(idInstance))
    if (!cabinet) return null
    return {
      session: isSession(cabinet.session) ? cabinet.session : null,
      chats: Array.isArray(cabinet.chats) ? cabinet.chats : [],
      messages: Array.isArray(cabinet.messages) ? capMessages(cabinet.messages) : [],
      accounts: cabinet.accounts && typeof cabinet.accounts === 'object' ? cabinet.accounts : {},
    }
  } catch {
    return null
  }
}

export async function writeCabinet(idInstance: string, cabinet: Cabinet): Promise<void> {
  try {
    await writeRecord(cabinetKey(idInstance), { ...cabinet, messages: capMessages(cabinet.messages) })
  } catch {
    return
  }
}

export function capMessages(messages: ChatMessage[]): ChatMessage[] {
  const counts = new Map<string, number>()
  for (const message of messages) counts.set(message.chatId, (counts.get(message.chatId) ?? 0) + 1)

  const seen = new Map<string, number>()
  return messages.filter((message) => {
    const extra = (counts.get(message.chatId) ?? 0) - messageLimit
    const index = seen.get(message.chatId) ?? 0
    seen.set(message.chatId, index + 1)
    return index >= extra
  })
}

function cabinetKey(idInstance: string): string {
  return `cabinet:${idInstance}`
}

function forgetLegacySession() {
  localStorage.removeItem(legacyKey)
}

function isSession(value: GreenApiConfig | null | undefined): value is GreenApiConfig {
  return Boolean(value?.apiUrl && value.idInstance && value.apiTokenInstance)
}

async function readRecord<T>(id: string): Promise<T | null> {
  const encrypted = await idbGet<EncryptedRecord>(await database(), 'records', id)
  if (!encrypted) return null
  try {
    const plain = await decrypt(encrypted)
    return JSON.parse(plain) as T
  } catch {
    return null
  }
}

async function writeRecord(id: string, value: unknown): Promise<void> {
  const epoch = writeEpoch
  const encrypted = await encrypt(JSON.stringify(value))
  if (epoch !== writeEpoch) return
  await idbPut(await database(), 'records', encrypted, id)
}

async function deleteRecord(id: string): Promise<void> {
  await idbDelete(await database(), 'records', id)
}

type EncryptedRecord = {
  iv: ArrayBuffer
  data: ArrayBuffer
}

async function encrypt(plain: string): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(plain),
  )
  return { iv: iv.buffer, data }
}

async function decrypt(record: EncryptedRecord): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, await encryptionKey(), record.data)
  return new TextDecoder().decode(plain)
}

async function encryptionKey(): Promise<CryptoKey> {
  const db = await database()
  const existing = await idbGet<CryptoKey>(db, 'keys', 'aes')
  if (existing) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await idbPut(db, 'keys', key, 'aes')
  return key
}

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error: unknown) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbGet<T>(db: IDBDatabase, store: string, id: string): Promise<T | undefined> {
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(id))
}

function idbPut(db: IDBDatabase, store: string, value: unknown, id: string): Promise<void> {
  return requestToPromise(db.transaction(store, 'readwrite').objectStore(store).put(value, id)).then(() => undefined)
}

function idbDelete(db: IDBDatabase, store: string, id: string): Promise<void> {
  return requestToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(id)).then(() => undefined)
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
