import { useState, useCallback, useEffect } from 'react'
import type { ConversationSummary, ChatMessage, SkillDefinition, TerminalSession } from './types'
import { createConversation, deleteConversation } from './services/api'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import './App.css'

const conversationMessages = new Map<string, ChatMessage[]>()

function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [enableSearch, setEnableSearch] = useState(true)
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [terminalSession, setTerminalSession] = useState<TerminalSession | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const conv = await createConversation()
        setConversations([conv])
        setActiveId(conv.id)
        conversationMessages.set(conv.id, [])
        setMessages([])
      } catch (err) {
        console.error('初始化对话失败:', err)
      }
    }
    init()
  }, [])

  const handleNew = useCallback(async () => {
    try {
      const conv = await createConversation()
      setConversations(prev => [conv, ...prev])
      setActiveId(conv.id)
      conversationMessages.set(conv.id, [])
      setMessages([])
    } catch (err) {
      console.error('创建对话失败:', err)
    }
  }, [])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
    setMessages(conversationMessages.get(id) || [])
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
    } catch (err) {
      console.error('删除对话失败:', err)
    }
    conversationMessages.delete(id)
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== id)
      if (activeId === id) {
        if (remaining.length > 0) {
          const next = remaining[0]
          setActiveId(next.id)
          setMessages(conversationMessages.get(next.id) || [])
        } else {
          setActiveId(null)
          setMessages([])
        }
      }
      return remaining
    })
  }, [activeId])

  const handleMessagesUpdate = useCallback((
    convId: string,
    newMessagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => {
    const prev = conversationMessages.get(convId) || []
    const updated =
      typeof newMessagesOrUpdater === 'function'
        ? newMessagesOrUpdater(prev)
        : newMessagesOrUpdater
    conversationMessages.set(convId, updated)
    if (convId === activeId) {
      setMessages(updated)
    }
  }, [activeId])

  const handleFirstMessage = useCallback((conversationId: string, content: string) => {
    const title = content.length > 20 ? content.slice(0, 20) + '...' : content
    setConversations(prev =>
      prev.map(c => (c.id === conversationId ? { ...c, title } : c))
    )
  }, [])

  const handleAddSkill = useCallback((skill: SkillDefinition) => {
    setSkills(prev => [...prev, skill])
  }, [])

  const handleRemoveSkill = useCallback((name: string) => {
    setSkills(prev => prev.filter(s => s.name !== name))
  }, [])

  const skillNames = skills.map(s => s.name)

  return (
    <div className="app-layout">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        skills={skills}
        terminalSession={terminalSession}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onAddSkill={handleAddSkill}
        onRemoveSkill={handleRemoveSkill}
      />
      <ChatView
        conversationId={activeId}
        messages={messages}
        enableSearch={enableSearch}
        skills={skillNames}
        onToggleSearch={() => setEnableSearch(prev => !prev)}
        onMessagesUpdate={handleMessagesUpdate}
        onFirstMessage={handleFirstMessage}
        onTerminalSessionChange={setTerminalSession}
      />
    </div>
  )
}

export default App
