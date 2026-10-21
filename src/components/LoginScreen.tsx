import { useState } from 'react'
import type { FormEvent } from 'react'
import type { GreenApiConfig } from '../types/green-api.ts'

type LoginScreenProps = {
  initial: GreenApiConfig | null
  error: string
  pending: boolean
  onSubmit: (config: GreenApiConfig) => void
}

const emptyConfig: GreenApiConfig = {
  apiUrl: '',
  idInstance: '',
  apiTokenInstance: '',
}

export function LoginScreen({ initial, error, pending, onSubmit }: LoginScreenProps) {
  const [config, setConfig] = useState<GreenApiConfig>(initial ?? emptyConfig)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({
      apiUrl: config.apiUrl.trim(),
      idInstance: config.idInstance.trim(),
      apiTokenInstance: config.apiTokenInstance.trim(),
    })
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-body">
          <h1>
            Введите данные
            <br />
            инстанса
          </h1>

          <label>
            apiUrl
            <input
              name="apiUrl"
              value={config.apiUrl}
              autoComplete="url"
              placeholder="https://4100.api.green-api.com"
              required
              onChange={(event) => setConfig({ ...config, apiUrl: event.target.value })}
            />
          </label>

          <label>
            idInstance
            <input
              name="idInstance"
              value={config.idInstance}
              inputMode="numeric"
              autoComplete="username"
              required
              onChange={(event) => setConfig({ ...config, idInstance: event.target.value })}
            />
          </label>

          <label>
            apiTokenInstance
            <input
              name="apiTokenInstance"
              type="password"
              value={config.apiTokenInstance}
              autoComplete="current-password"
              required
              onChange={(event) => setConfig({ ...config, apiTokenInstance: event.target.value })}
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <p>Данные из личного кабинета GREEN-API.</p>

          <button type="submit" disabled={pending}>
            {pending ? 'Проверяем…' : 'Войти'}
          </button>
        </div>
      </form>
    </main>
  )
}
