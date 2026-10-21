import type { FormEvent } from 'react'

type NewChatFormProps = {
  phone: string
  error: string
  pending: boolean
  onPhoneChange: (phone: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

export function NewChatForm({ phone, error, pending, onPhoneChange, onSubmit, onCancel }: NewChatFormProps) {
  return (
    <form className="new-chat-form" onSubmit={onSubmit}>
      <label>
        Номер телефона
        <input
          name="phone"
          type="tel"
          value={phone}
          placeholder="+7 999 000-00-00"
          autoFocus
          onChange={(event) => onPhoneChange(event.target.value)}
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="new-chat-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Проверяем…' : 'Создать'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}
