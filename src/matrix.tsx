import React, { useMemo, useState } from 'react'

import { toDateString, type DueInfo, type Priority } from './parse'
import type { TaskItem } from './scheduler'
import { nest } from './subtasks'
import {
  DueBadge,
  itemKey,
  itemTitle,
  NoteLabel,
  ParentLabel,
  Progress,
  Stars,
  SubtaskChecklist,
  type ItemContext
} from './tasks-view'

/**
 * Eisenhower matrix of the open tasks, from the markers they already carry:
 * important = at least `importantPriority` ⭐, urgent = due (a period's end)
 * within `urgentDays` days from today, overdue included.
 */
export interface MatrixRule {
  importantPriority: Priority
  urgentDays: number
}

type Quadrant = 'do' | 'plan' | 'delegate' | 'drop'

const QUADRANTS: Array<{ key: Quadrant; important: boolean; urgent: boolean; label: string; hint: string }> = [
  { key: 'do', important: true, urgent: true, label: '今すぐやる', hint: '重要 × 緊急' },
  { key: 'plan', important: true, urgent: false, label: '計画する', hint: '重要 × 緊急でない' },
  { key: 'delegate', important: false, urgent: true, label: '任せる・手早く済ませる', hint: '重要でない × 緊急' },
  { key: 'drop', important: false, urgent: false, label: 'やめる・後回し', hint: '重要でない × 緊急でない' }
]

const DRAG_TYPE = 'application/x-inkdrop-reminder-matrix'

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return toDateString(new Date(y, m - 1, d + days))
}

function daysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((at(to) - at(from)) / 86_400_000)
}

/** The last day that still counts as urgent */
const urgentUntil = (now: Date, rule: MatrixRule) => shiftDate(toDateString(now), rule.urgentDays)

const isImportant = (t: TaskItem, rule: MatrixRule) => t.task.priority >= rule.importantPriority
const isUrgent = (t: TaskItem, now: Date, rule: MatrixRule) =>
  !!t.task.due && t.task.due.date <= urgentUntil(now, rule)

/** `due` moved so it ends on `date`; a period keeps its length. A new one is all day. */
function dueEndingOn(due: DueInfo | null, date: string): DueInfo {
  if (!due) return { date, time: null, start: null, reminder: { minutes: null, off: false } }
  const delta = daysBetween(due.date, date)
  return {
    ...due,
    date,
    start: due.start ? { ...due.start, date: shiftDate(due.start.date, delta) } : null
  }
}

/**
 * The marker changes that put a task into `to`: its ⭐ raised to the threshold
 * or dropped just below it; its due date moved to today, or to the first day
 * past the urgent window.
 */
function changesFor(
  t: TaskItem,
  to: (typeof QUADRANTS)[number],
  now: Date,
  rule: MatrixRule
): { priority?: Priority; due?: DueInfo } {
  const out: { priority?: Priority; due?: DueInfo } = {}
  if (to.important !== isImportant(t, rule)) {
    out.priority = to.important ? rule.importantPriority : ((rule.importantPriority - 1) as Priority)
  }
  if (to.urgent !== isUrgent(t, now, rule)) {
    const date = to.urgent ? toDateString(now) : shiftDate(urgentUntil(now, rule), 1)
    out.due = dueEndingOn(t.task.due, date)
  }
  return out
}

/**
 * Four quadrants of open tasks (a note's own due date has no ⭐, so it stays
 * out). Drag a card to another quadrant to rewrite its ⭐ / due date.
 */
export const Matrix: React.FC<{
  items: TaskItem[]
  ctx: ItemContext
  rule: MatrixRule
  update: (item: TaskItem, changes: { priority?: Priority; due?: DueInfo }) => Promise<void>
}> = ({ items, ctx, rule, update }) => {
  const [dragOver, setDragOver] = useState<Quadrant | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const cells = useMemo(() => {
    const by: Record<Quadrant, TaskItem[]> = { do: [], plan: [], delegate: [], drop: [] }
    const open = items.filter(t => t.kind === 'task' && !t.task.checked)
    // Subtasks are a checklist on their parent's card, as on the Kanban.
    for (const { item: t } of nest(open)) {
      const q = QUADRANTS.find(q => q.important === isImportant(t, rule) && q.urgent === isUrgent(t, ctx.now, rule))!
      by[q.key].push(t)
    }
    return by
  }, [items, rule, ctx.now])

  const onDrop = (q: (typeof QUADRANTS)[number]) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    setDragging(null)
    const key = e.dataTransfer.getData(DRAG_TYPE)
    const item = items.find(t => itemKey(t) === key)
    if (!item) return
    const changes = changesFor(item, q, ctx.now, rule)
    if (changes.priority !== undefined || changes.due) update(item, changes)
  }

  const stars = '★'.repeat(rule.importantPriority)
  const span = rule.urgentDays === 0 ? '今日まで' : `${rule.urgentDays}日以内`

  return (
    <div className="reminder-matrix">
      <div className="axis corner" />
      <div className="axis col">
        緊急 <span className="rule">期限切れ・{span}</span>
      </div>
      <div className="axis col">
        緊急でない <span className="rule">期限なし・それより先</span>
      </div>
      {QUADRANTS.map((q, i) => (
        <React.Fragment key={q.key}>
          {i % 2 === 0 && (
            <div className="axis row">
              {q.important ? '重要' : '重要でない'}
              <span className="rule">{q.important ? `${stars}以上` : `${stars}未満`}</span>
            </div>
          )}
          <section
            className={`reminder-matrix-cell q-${q.key}${dragOver === q.key ? ' drag-over' : ''}`}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOver !== q.key) setDragOver(q.key)
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
            }}
            onDrop={onDrop(q)}
          >
            <h2>
              {q.label} <span className="hint">{q.hint}</span> <span className="count">{cells[q.key].length}</span>
            </h2>
            <div className="reminder-kanban-cards">
              {cells[q.key].map(item => (
                <div
                  key={itemKey(item)}
                  className={`reminder-kanban-card${dragging === itemKey(item) ? ' dragging' : ''}${
                    item.noteStatus === 'onHold' ? ' on-hold' : ''
                  }`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData(DRAG_TYPE, itemKey(item))
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(itemKey(item))
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setDragOver(null)
                  }}
                  onClick={() => ctx.open(item)}
                  title="クリックでタスクを開く・ドラッグで ⭐ と期限を変更"
                >
                  <div className="text">{itemTitle(item)}</div>
                  <ParentLabel item={item} ctx={ctx} />
                  <div className="meta">
                    <Progress item={item} ctx={ctx} />
                    <Stars item={item} ctx={ctx} />
                    {item.task.doing && <span className="doing">🏃</span>}
                    <DueBadge item={item} ctx={ctx} />
                  </div>
                  <SubtaskChecklist item={item} ctx={ctx} />
                  <NoteLabel item={item} ctx={ctx} link />
                  <div className="actions" onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => ctx.move(item, 'done')}>
                      ✓ 完了
                    </button>
                  </div>
                </div>
              ))}
              {cells[q.key].length === 0 && <div className="empty">ここにドラッグ</div>}
            </div>
          </section>
        </React.Fragment>
      ))}
    </div>
  )
}
