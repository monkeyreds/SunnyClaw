import { useState, useEffect } from 'react'
import type { ConversationSummary, SkillDefinition, TerminalSession } from '../types'
import { fetchHealth } from '../services/api'

interface SidebarProps {
  conversations: ConversationSummary[]
  activeId: string | null
  skills: SkillDefinition[]
  terminalSession?: TerminalSession | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onAddSkill: (skill: SkillDefinition) => void
  onRemoveSkill: (name: string) => void
}

export default function Sidebar({
  conversations,
  activeId,
  skills,
  terminalSession,
  onSelect,
  onNew,
  onDelete,
  onAddSkill,
  onRemoveSkill
}: SidebarProps) {
  const [showSkillForm, setShowSkillForm] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [skillDesc, setSkillDesc] = useState('')
  const [modelLabel, setModelLabel] = useState('\u2026')

  useEffect(() => {
    fetchHealth()
      .then(h => setModelLabel(h.ollamaModel))
      .catch(() => setModelLabel('\u672a\u8fde\u63a5'))
  }, [])

  const handleAddSkill = () => {
    if (!skillName.trim() || !skillDesc.trim()) return
    onAddSkill({
      name: skillName.trim(),
      description: skillDesc.trim(),
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: skillDesc.trim() }
        },
        required: ['input']
      }
    })
    setSkillName('')
    setSkillDesc('')
    setShowSkillForm(false)
  }

  const statusLabel =
    terminalSession?.status === 'running'
      ? '\u6267\u884c\u4e2d'
      : terminalSession?.status === 'done'
        ? '\u5df2\u5b8c\u6210'
        : '\u5df2\u62d2\u7edd'

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">{'\u2600\ufe0f'} SunnyClaw</h1>
        <button type="button" className="new-chat-btn" onClick={onNew}>
          {'\uff0b'} {'\u65b0\u5efa\u5bf9\u8bdd'}
        </button>
      </div>
      <div className="sidebar-list">
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`sidebar-item ${conv.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <span className="sidebar-item-title">{'\ud83d\udcac'} {conv.title}</span>
            <button
              type="button"
              className="sidebar-item-delete"
              onClick={e => {
                e.stopPropagation()
                onDelete(conv.id)
              }}
              title={'\u5220\u9664\u5bf9\u8bdd'}
            >
              {'\u2715'}
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="skills-section">
          <div className="skills-section-header">
            <span className="skills-section-title">{'\ud83d\udee0'} Skills</span>
            <button type="button" className="skills-add-btn" onClick={() => setShowSkillForm(!showSkillForm)}>
              {showSkillForm ? '\u6536\u8d77' : '\uff0b'}
            </button>
          </div>
          {skills.length > 0 && (
            <div className="skills-list">
              {skills.map(skill => (
                <span key={skill.name} className="skill-tag">
                  {skill.name}
                  <button type="button" className="skill-tag-delete" onClick={() => onRemoveSkill(skill.name)}>
                    {'\u2715'}
                  </button>
                </span>
              ))}
            </div>
          )}
          {showSkillForm && (
            <div className="skill-form">
              <input placeholder={'\u6280\u80fd\u540d\u79f0'} value={skillName} onChange={e => setSkillName(e.target.value)} />
              <input placeholder={'\u6280\u80fd\u63cf\u8ff0'} value={skillDesc} onChange={e => setSkillDesc(e.target.value)} />
              <button type="button" onClick={handleAddSkill} disabled={!skillName.trim() || !skillDesc.trim()}>
                {'\u6dfb\u52a0'}
              </button>
            </div>
          )}
        </div>
        {terminalSession && (
          <div className={`sidebar-terminal-status ${terminalSession.status}`}>
            <div className="sidebar-terminal-title">{'\u2328\ufe0f'} {'\u7ec8\u7aef'}</div>
            <div className="sidebar-terminal-cmd" title={terminalSession.command}>
              {statusLabel}
              {'\uff1a'}
              {terminalSession.command.length > 28
                ? `${terminalSession.command.slice(0, 28)}\u2026`
                : terminalSession.command}
            </div>
          </div>
        )}
        <span className="model-label" title={'\u5f53\u524d Ollama \u6a21\u578b'}>
          {modelLabel}
        </span>
      </div>
    </aside>
  )
}
