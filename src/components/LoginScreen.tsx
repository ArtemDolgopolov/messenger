import { useState } from 'react'
import type { FormEvent } from 'react'
import type { GreenApiConfig } from '../types/green-api.ts'

type LoginValues = Pick<GreenApiConfig, 'idInstance' | 'apiTokenInstance'>

type LoginScreenProps = {
  initial: LoginValues | null
  error: string
  pending: boolean
  onSubmit: (values: LoginValues) => void
}

const emptyValues: LoginValues = {
  idInstance: '',
  apiTokenInstance: '',
}

export function LoginScreen({ initial, error, pending, onSubmit }: LoginScreenProps) {
  const [values, setValues] = useState<LoginValues>(initial ?? emptyValues)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({
      idInstance: values.idInstance.trim(),
      apiTokenInstance: values.apiTokenInstance.trim(),
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
            idInstance
            <input
              name="idInstance"
              value={values.idInstance}
              inputMode="numeric"
              autoComplete="username"
              required
              onChange={(event) => setValues({ ...values, idInstance: event.target.value })}
            />
          </label>

          <label>
            apiTokenInstance
            <input
              name="apiTokenInstance"
              type="password"
              value={values.apiTokenInstance}
              autoComplete="current-password"
              required
              onChange={(event) => setValues({ ...values, apiTokenInstance: event.target.value })}
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
