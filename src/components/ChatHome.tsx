type ChatHomeProps = {
  idInstance: string
  onLogout: () => void
}

export function ChatHome({ idInstance, onLogout }: ChatHomeProps) {
  return (
    <div className="workspace">
      <header className="workspace-bar">
        <strong>Чат</strong>
        <span className="workspace-id">{idInstance}</span>
        <button type="button" onClick={onLogout}>
          Выйти
        </button>
      </header>
      <main className="workspace-main" />
    </div>
  )
}
