import type { GreenApiConfig } from '../types/green-api.ts'

const storageKey = 'messenger.session'

export function readSession(): GreenApiConfig | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null

  try {
    const value: unknown = JSON.parse(raw)
    if (!isSession(value)) return null
    return value
  } catch {
    return null
  }
}

export function writeSession(session: GreenApiConfig): void {
  localStorage.setItem(storageKey, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(storageKey)
}

function isSession(value: unknown): value is GreenApiConfig {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<GreenApiConfig>
  return Boolean(session.apiUrl && session.idInstance && session.apiTokenInstance)
}
