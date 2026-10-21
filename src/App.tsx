import { useEffect, useState } from 'react'
import { createGreenApi, errorText, GreenApiError, withApiUrl } from './api/client.ts'
import { ChatHome } from './components/ChatHome.tsx'
import { LoginScreen } from './components/LoginScreen.tsx'
import { clearSession, readSession, writeSession } from './storage/session.ts'
import type { GreenApiConfig } from './types/green-api.ts'

export default function App() {
  const [session, setSession] = useState<GreenApiConfig | null>(null)
  const [draft, setDraft] = useState<GreenApiConfig | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void restore().then((result) => {
      if (cancelled) return
      setDraft(result.draft)
      setError(result.error)
      setSession(result.session)
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(values: Pick<GreenApiConfig, 'idInstance' | 'apiTokenInstance'>) {
    const config = withApiUrl({ ...values, apiUrl: '' })
    setPending(true)
    setError('')
    setDraft(config)
    const result = await openSession(config)
    if (result === 'authorized') {
      await writeSession(config)
      setSession(config)
      setError('')
    } else {
      setError(result)
    }
    setPending(false)
  }

  function handleLogout() {
    if (session) void clearSession(session.idInstance)
    setSession(null)
    setDraft(null)
    setError('')
  }

  if (!ready) {
    return <main className="login" />
  }

  if (!session) {
    return (
      <LoginScreen
        key={draft?.idInstance || 'empty'}
        initial={draft}
        error={error}
        pending={pending}
        onSubmit={(config) => {
          void handleSubmit(config)
        }}
      />
    )
  }

  return (
    <ChatHome
      session={session}
      onLogout={handleLogout}
      onSessionEnd={(message) => {
        setDraft(session)
        void clearSession(session.idInstance)
        setSession(null)
        setError(message)
      }}
    />
  )
}

async function restore(): Promise<{ session: GreenApiConfig | null; draft: GreenApiConfig | null; error: string }> {
  const stored = await readSession()
  if (!stored) return { session: null, draft: null, error: '' }
  const config = withApiUrl(stored)
  const result = await openSession(config)
  if (result === 'authorized') return { session: config, draft: config, error: '' }
  await clearSession(config.idInstance)
  return { session: null, draft: config, error: result }
}

async function openSession(config: GreenApiConfig): Promise<'authorized' | string> {
  try {
    const { stateInstance } = await createGreenApi(config).getStateInstance()
    if (stateInstance === 'authorized') return 'authorized'
    if (stateInstance === 'notAuthorized' || stateInstance === 'starting') return errorText.unauthorized
    return errorText.instanceUnavailable
  } catch (error) {
    if (error instanceof GreenApiError) return error.message
    return errorText.generic
  }
}
