import { avatarColor, initials } from './format.ts'

export function Avatar({ chatId, title, small = false }: { chatId: string; title: string; small?: boolean }) {
  return (
    <span className={small ? 'avatar avatar-sm' : 'avatar'} style={{ background: avatarColor(chatId) }}>
      {initials(title)}
    </span>
  )
}
