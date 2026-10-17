import React, { useEffect, useState } from 'react'

import { getConfig, getEnv, peekEnv } from './env'
import { dueDate, formatDueLabel, parseNoteDue, type DueInfo } from './parse'

interface EditingNote {
  _id: string
  body?: string
  status?: string
}

function readNoteDue(): { due: DueInfo; closed: boolean } | null {
  // The store can still notify us while the plugin is being deactivated.
  const note: EditingNote | null | undefined = peekEnv()?.store.getState().editingNote
  const nd = note?.body ? parseNoteDue(note.body) : null
  if (!nd) return null
  return { due: nd.due, closed: note?.status === 'completed' || note?.status === 'dropped' }
}

/**
 * Editor header button showing the note's own due date, TickTick-style:
 * a calendar icon when unset, `⏰ 10/20 15:00 · 🔔15分前` (red when overdue) when set.
 * Clicking opens the picker for the note.
 */
export const NoteDueButton: React.FC = () => {
  const env = getEnv()
  const [state, setState] = useState(readNoteDue)
  // Re-render each minute so the overdue color flips without an edit.
  const [, setTick] = useState(0)

  useEffect(() => {
    let last = JSON.stringify(state)
    const unsubscribe = env.store.subscribe(() => {
      const next = readNoteDue()
      const key = JSON.stringify(next)
      if (key !== last) {
        last = key
        setState(next)
      }
    })
    const timer = setInterval(() => setTick(t => t + 1), 60 * 1000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  const { AppHeaderButton } = env.components.classes
  if (!AppHeaderButton) return null

  const handleClick = () => env.commands.dispatch(document.body, 'reminder:set-note-due' as any)

  if (!state) {
    return (
      <AppHeaderButton className="icon reminder-note-due-button" title="ノートの期限を設定" onClick={handleClick}>
        <svg viewBox="0 0 24 24" width="1em" height="1em" className="svg-icon">
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
            <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
            <path d="M3 9.75h18M7.5 2.25v4.5M16.5 2.25v4.5" />
          </g>
        </svg>
      </AppHeaderButton>
    )
  }

  const { due, closed } = state
  const { defaultTime, defaultRemindMinutes } = getConfig()
  const at = dueDate(due, defaultTime)
  const overdue = !closed && at.getTime() < Date.now()
  const label = formatDueLabel(due, defaultTime, defaultRemindMinutes)
  const cls = ['reminder-note-due-button', 'has-due', overdue && 'overdue', closed && 'done']
    .filter(Boolean)
    .join(' ')
  return (
    <AppHeaderButton className={cls} title="ノートの期限を変更" onClick={handleClick}>
      <span className="reminder-note-due-label">
        ⏰ {label}
      </span>
    </AppHeaderButton>
  )
}

NoteDueButton.displayName = 'ReminderNoteDueButton'
