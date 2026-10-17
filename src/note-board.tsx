import React, { useMemo, useState } from 'react'

import { getEnv } from './env'
import type { NoteStatus } from './notify'
import { dueDate, type DueInfo } from './parse'
import type { TaskItem } from './scheduler'
import { STATUSES, StatusIcon, statusOf, type ItemContext } from './tasks-view'

/** Closed lanes pile up; show the most recently updated notes and page through the rest. */
const PAGE = 30
const DRAG_TYPE = 'application/x-inkdrop-reminder-note'

interface NoteCard {
  noteId: string
  title: string
  status: NoteStatus
  bookId: string
  tags: string[]
  updatedAt: number
  done: number
  total: number
  /** Unchecked tasks, the note's own due date included */
  open: number
  doing: number
  /** Highest ⭐ among open tasks */
  priority: number
  /** The soonest due date among the note's own and its open tasks' */
  next: { due: DueInfo; at: number } | null
  /** Any of the note's items, to open the note with */
  item: TaskItem
}

function cardsOf(notes: Set<string>, all: TaskItem[], defaultTime: string): NoteCard[] {
  const cards = new Map<string, NoteCard>()
  for (const t of all) {
    if (!notes.has(t.noteId)) continue
    let card = cards.get(t.noteId)
    if (!card) {
      card = {
        noteId: t.noteId,
        title: t.noteTitle,
        status: statusOf(t),
        bookId: t.bookId,
        tags: t.noteTags,
        updatedAt: t.noteUpdatedAt,
        done: 0,
        total: 0,
        open: 0,
        doing: 0,
        priority: 0,
        next: null,
        item: t
      }
      cards.set(t.noteId, card)
    }
    if (t.kind === 'task') {
      card.total++
      if (t.task.checked) card.done++
    }
    if (t.task.checked) continue
    card.open++
    if (t.task.doing) card.doing++
    card.priority = Math.max(card.priority, t.task.priority)
    if (t.task.due) {
      const at = dueDate(t.task.due, defaultTime).getTime()
      if (!card.next || at < card.next.at) card.next = { due: t.task.due, at }
    }
  }
  return [...cards.values()]
}

/** `10/20(火)`, `10/20〜10/23`: the date part of a due date */
function formatDay(due: DueInfo): string {
  const md = (date: string) => {
    const [y, m, d] = date.split('-').map(Number)
    const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()]
    return `${y === new Date().getFullYear() ? '' : `${y}/`}${m}/${d}(${wd})`
  }
  return due.start ? `${md(due.start.date)}〜${md(due.date)}` : `${md(due.date)}${due.time ? ` ${due.time}` : ''}`
}

/**
 * One card per note (with tasks or a due date), in lanes by note status.
 * Drag a card to another lane to change the note's status; click to open it.
 */
export const NoteBoard: React.FC<{
  /** The tasks passing the filters: which notes to show */
  items: TaskItem[]
  /** Every task, for each note's full progress */
  all: TaskItem[]
  statuses: NoteStatus[]
  ctx: ItemContext
  changeStatus: (noteId: string, status: NoteStatus) => Promise<void>
}> = ({ items, all, statuses, ctx, changeStatus }) => {
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [dragOver, setDragOver] = useState<NoteStatus | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const lanes = useMemo(() => {
    const cards = cardsOf(new Set(items.map(t => t.noteId)), all, ctx.defaultTime)
    const by = new Map<NoteStatus, NoteCard[]>(STATUSES.map(s => [s.value, []]))
    for (const c of cards) {
      // Open lanes hold the notes with something left to do; finished ones only clutter them.
      const closed = c.status === 'completed' || c.status === 'dropped'
      if (closed || c.open > 0) by.get(c.status)?.push(c)
    }
    for (const [status, list] of by) {
      // Open lanes: soonest due first; closed ones: most recently updated first.
      if (status === 'completed' || status === 'dropped') list.sort((a, b) => b.updatedAt - a.updatedAt)
      else
        list.sort(
          (a, b) =>
            (a.next?.at ?? Infinity) - (b.next?.at ?? Infinity) || b.priority - a.priority || b.updatedAt - a.updatedAt
        )
    }
    return by
  }, [items, all, ctx.defaultTime])

  const tagHash: Record<string, { name: string; color: string }> = getEnv().store.getState().tags?.hash ?? {}
  const now = ctx.now.getTime()

  const onDrop = (status: NoteStatus) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    setDragging(null)
    const noteId = e.dataTransfer.getData(DRAG_TYPE)
    const card = [...lanes.values()].flat().find(c => c.noteId === noteId)
    if (card && card.status !== status) changeStatus(noteId, status)
  }

  return (
    <div className="reminder-kanban reminder-note-board">
      {STATUSES.filter(s => statuses.includes(s.value)).map(lane => {
        const cards = lanes.get(lane.value) ?? []
        const limit = limits[lane.value] ?? PAGE
        const shown = cards.slice(0, limit)
        return (
          <section
            key={lane.value}
            className={`reminder-kanban-lane status-${lane.value}${dragOver === lane.value ? ' drag-over' : ''}`}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOver !== lane.value) setDragOver(lane.value)
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
            }}
            onDrop={onDrop(lane.value)}
          >
            <h2>
              <StatusIcon status={lane.value} />
              {lane.label} <span className="count">{cards.length}</span>
            </h2>
            <div className="reminder-kanban-cards">
              {shown.map(card => {
                const overdue = card.next && card.next.at < now
                const pct = card.total ? Math.round((card.done / card.total) * 100) : 0
                return (
                  <div
                    key={card.noteId}
                    className={`reminder-kanban-card note-card${dragging === card.noteId ? ' dragging' : ''}`}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData(DRAG_TYPE, card.noteId)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragging(card.noteId)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setDragOver(null)
                    }}
                    onClick={() => ctx.open(card.item, { noteOnly: true })}
                    title="クリックでノートを開く・ドラッグでステータスを変更"
                  >
                    <div className="text">{card.title || '無題のノート'}</div>
                    {card.tags.length > 0 && (
                      <div className="tags">
                        {card.tags.map(id =>
                          tagHash[id] ? (
                            <span key={id} className={`ui tag label ${tagHash[id].color} small`}>
                              {tagHash[id].name}
                            </span>
                          ) : null
                        )}
                      </div>
                    )}
                    <div className="meta">
                      {card.total > 0 && (
                        <span className={`subtask-progress${card.done === card.total ? ' complete' : ''}`}>
                          ☑ {card.done}/{card.total}
                        </span>
                      )}
                      {card.priority > 0 && <span className="stars-static">{'★'.repeat(card.priority)}</span>}
                      {card.doing > 0 && <span className="doing">🏃 {card.doing}</span>}
                      {card.next && (
                        <span className={`due${overdue ? ' overdue' : ''}`}>⏰ {formatDay(card.next.due)}</span>
                      )}
                    </div>
                    {card.total > 0 && (
                      <div className="progress-bar">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {ctx.books[card.bookId] && <div className="note">📁 {ctx.books[card.bookId].name}</div>}
                    <div className="actions" onClick={e => e.stopPropagation()}>
                      {STATUSES.filter(s => s.value !== card.status).map(s => (
                        <button key={s.value} type="button" onClick={() => changeStatus(card.noteId, s.value)}>
                          → {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {shown.length < cards.length && (
                <button
                  type="button"
                  className="more"
                  onClick={() => setLimits({ ...limits, [lane.value]: limit + PAGE * 2 })}
                >
                  さらに表示（残り {cards.length - shown.length} 件）
                </button>
              )}
              {cards.length === 0 && <div className="empty">ここにドラッグ</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
