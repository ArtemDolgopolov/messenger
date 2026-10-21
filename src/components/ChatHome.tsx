import { errorText } from '../api/client.ts'
import type { GreenApiConfig } from '../types/green-api.ts'
import { useChatSession } from '../features/chat/useChatSession.ts'
import { ChatList } from '../features/chat-list/ChatList.tsx'
import { Conversation } from '../features/conversation/Conversation.tsx'

type ChatHomeProps = {
  session: GreenApiConfig
  onLogout: () => void
  onSessionEnd: (message: string) => void
}

export function ChatHome({ session, onLogout, onSessionEnd }: ChatHomeProps) {
  const chat = useChatSession(session, onSessionEnd)

  return (
    <div className={chat.activeChat ? 'workspace is-thread' : 'workspace'}>
      {chat.receiveNotice ? <p className="offline-banner">{chat.receiveNotice}</p> : null}
      {!chat.canSend ? <p className="instance-banner">{instanceMessage(chat.instanceState)}</p> : null}
      <div className="workspace-body">
        <ChatList
          idInstance={session.idInstance}
          chats={chat.chats}
          messages={chat.messages}
          activeChatId={chat.activeChatId}
          loading={chat.chatsLoading}
          onLogout={onLogout}
          onSelect={chat.openChat}
          onCreate={chat.createChat}
        />
        <section className="conversation">
          <Conversation
            chat={chat.activeChat}
            messages={chat.messages}
            historyReady={chat.historyReady}
            canSend={chat.canSend}
            onBack={chat.closeChat}
            onSend={chat.deliver}
            onDelete={chat.removeMessage}
          />
        </section>
      </div>
    </div>
  )
}

function instanceMessage(state: string): string {
  if (state === 'notAuthorized' || state === 'starting') return errorText.unauthorized
  return errorText.instanceUnavailable
}
