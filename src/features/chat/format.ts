import type { ChatItem, ChatMessage } from '../../state/notifications.ts'

const avatarColors = ['#3390ec', '#4fae4e', '#e36a5d', '#7b68ee', '#e39b2b', '#3d9a9a']

export const messageSkeleton = [
  { side: 'in', lines: 2 },
  { side: 'out', lines: 1 },
  { side: 'in', lines: 1 },
  { side: 'out', lines: 2 },
  { side: 'in', lines: 3 },
  { side: 'out', lines: 1 },
]

export function previewText(message: ChatMessage): string {
  if (message.direction === 'out') return `Вы: ${message.text}`
  return message.text
}

export function chatSubtitle(chat: ChatItem): string {
  if (chat.username && chat.username !== chat.title) return chat.username
  return chat.phone
}

export function outgoingStatus(message: ChatMessage): string {
  if (message.status === 'sending') return 'отправляется'
  if (message.status === 'failed') return 'не отправилось'
  return 'отправлено'
}

export function initials(title: string): string {
  const trimmed = title.trim().replace(/^@+/, '') || title.trim()
  if (/^\d+$/.test(trimmed)) return trimmed.slice(-2)
  const words = trimmed.split(/\s+/).filter(Boolean)
  const first = (value: string) => Array.from(value)[0] ?? ''
  if (words.length >= 2) return (first(words[0]) + first(words[1])).toLocaleUpperCase('ru')
  return Array.from(trimmed).slice(0, 2).join('').toLocaleUpperCase('ru')
}

export function avatarColor(chatId: string): string {
  let hash = 0
  for (const char of chatId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return avatarColors[hash % avatarColors.length]
}

export function groupMessages(messages: ChatMessage[]) {
  const items: Array<{ kind: 'day'; key: string; label: string } | { kind: 'message'; message: ChatMessage }> = []
  let lastDay = ''
  for (const message of messages) {
    const key = dayKey(message.sentAt)
    if (key !== lastDay) {
      items.push({ kind: 'day', key: `day-${key}`, label: formatDay(message.sentAt) })
      lastDay = key
    }
    items.push({ kind: 'message', message })
  }
  return items
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

export function formatListTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return formatTime(timestamp)
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(date)
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDay(timestamp: number): string {
  const date = new Date(timestamp)
  const today = startOfDay(new Date())
  const diff = Math.round((today - startOfDay(date)) / 86_400_000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
