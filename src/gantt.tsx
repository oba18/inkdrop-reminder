import React, { useMemo, useRef, useState } from 'react'

import { taskState } from './notify'
import { locale, tr } from './i18n'
import { dueDate, toDateString, type DueInfo } from './parse'
import type { TaskItem } from './scheduler'
import { flatten, nest, type TaskNode } from './subtasks'
import {
  CollapseToggle,
  KindChip,
  ParentLabel,
  Progress,
  Stars,
  formatDue,
  itemKey,
  itemTitle,
  type ItemContext
} from './tasks-view'

/** Days on screen: five weeks */
const SPAN_DAYS = 35
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Monday of the week before `d`'s, so a little of the past stays in view. */
function defaultFrom(d: Date) {
  const monday = addDays(startOfDay(d), -((d.getDay() + 6) % 7))
  return addDays(monday, -7)
}

function parseDay(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Whole days from `from` to the day `ds`. */
function dayIndex(from: Date, ds: string) {
  return Math.round((parseDay(ds).getTime() - from.getTime()) / DAY_MS)
}

/** What a drag changes: the whole bar, or one of its ends. */
type DragMode = 'move' | 'start' | 'end'

interface Drag {
  key: string
  mode: DragMode
  /** Days moved so far */
  delta: number
}

function shiftDay(ds: string, n: number) {
  return toDateString(addDays(parseDay(ds), n))
}

/** Days from a period's start to its end (0 for a plain due date). */
function lengthOf(due: DueInfo) {
  return due.start ? dayIndex(parseDay(due.start.date), due.date) : 0
}

/** Keeps a drag from turning a period inside out. */
function clampDelta(due: DueInfo, mode: DragMode, delta: number) {
  const len = lengthOf(due)
  if (mode === 'start') return Math.min(delta, len)
  if (mode === 'end') return Math.max(delta, -len)
  return delta
}

/**
 * The due date after a drag. Times stay as they were. Stretching a plain due
 * date's end makes it a period; a period squeezed to one untimed day becomes
 * a plain due date again.
 */
function draggedDue(due: DueInfo, mode: DragMode, delta: number): DueInfo {
  if (!delta) return due
  let start = due.start
  let date = due.date
  if (mode === 'move') {
    start = start && { ...start, date: shiftDay(start.date, delta) }
    date = shiftDay(date, delta)
  } else if (mode === 'start' && start) {
    start = { ...start, date: shiftDay(start.date, delta) }
  } else if (mode === 'end') {
    start = start ?? { date: due.date, time: null }
    date = shiftDay(date, delta)
  }
  if (start && start.date === date && !start.time) start = null
  return { ...due, start, date }
}

interface Row {
  item: TaskItem
  /** The due date shown, a drag in progress included */
  due: DueInfo
  /** Day indexes in the window, clipped */
  first: number
  last: number
  clippedStart: boolean
  clippedEnd: boolean
  milestone: boolean
  /** Subtask level under a parent row (0 at the top) */
  depth: number
  /** The row's place in the subtask tree */
  node?: TaskNode
}

/**
 * Timeline of every task (and note) with a due date or period: a bar from a
 * period's start to its end, a ◆ on a plain due date. Click to jump to it.
 */
export const Gantt: React.FC<{
  items: TaskItem[]
  ctx: ItemContext
}> = ({ items, ctx }) => {
  const [from, setFrom] = useState(() => defaultFrom(ctx.now))
  const [showDone, setShowDone] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapsed = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const scrollRef = useRef<HTMLDivElement>(null)
  const to = addDays(from, SPAN_DAYS - 1)
  const fromStr = toDateString(from)
  const toStr = toDateString(to)

  const days = useMemo(() => Array.from({ length: SPAN_DAYS }, (_, i) => addDays(from, i)), [from])
  const todayIdx = dayIndex(from, toDateString(ctx.now))

  const { rows, outside } = useMemo(() => {
    const rows: Row[] = []
    let outside = 0
    for (const item of items) {
      const original = item.task.due
      if (!original || (!showDone && item.task.checked)) continue
      const dragging = drag?.key === itemKey(item)
      const due = dragging ? draggedDue(original, drag.mode, drag.delta) : original
      const start = due.start?.date ?? due.date
      // A bar being dragged stays on screen even when pulled off the edge.
      if (!dragging && (due.date < fromStr || start > toStr)) {
        outside++
        continue
      }
      const s = dayIndex(from, start)
      const e = dayIndex(from, due.date)
      rows.push({
        item,
        due,
        first: Math.min(SPAN_DAYS - 1, Math.max(0, s)),
        last: Math.max(0, Math.min(SPAN_DAYS - 1, e)),
        clippedStart: s < 0,
        clippedEnd: e > SPAN_DAYS - 1,
        milestone: !due.start,
        depth: 0
      })
    }
    // Sorted by the saved dates, so a row doesn't jump around while dragged.
    rows.sort(
      (a, b) =>
        (a.item.task.due!.start?.date ?? a.item.task.due!.date).localeCompare(
          b.item.task.due!.start?.date ?? b.item.task.due!.date
        ) ||
        a.item.task.due!.date.localeCompare(b.item.task.due!.date) ||
        b.item.task.priority - a.item.task.priority
    )
    // Subtask rows follow their parent's row (when it has one on screen).
    const byKey = new Map(rows.map(r => [itemKey(r.item), r]))
    const tree = nest(rows.map(r => r.item))
    const nested = flatten(tree, collapsed, itemKey).map(({ node, depth }) => ({
      ...byKey.get(itemKey(node.item))!,
      depth,
      node
    }))
    return { rows: nested, outside }
  }, [items, from, fromStr, toStr, showDone, drag, collapsed])

  const grid = { gridTemplateColumns: `var(--gantt-label-width) repeat(${SPAN_DAYS}, var(--gantt-day-width))` }

  /**
   * Drags a bar (or one of its ends) by whole days; on release the new dates
   * are written to the note. A press without movement is a click: open it.
   */
  const beginDrag = (e: React.PointerEvent, r: Row, mode: DragMode) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const key = itemKey(r.item)
    const original = r.item.task.due!
    const dayWidth =
      scrollRef.current?.querySelector('.reminder-gantt-header .day')?.getBoundingClientRect().width || 34
    const startX = e.clientX
    let delta = 0
    let moved = false
    const bodyClass = mode === 'move' ? 'reminder-gantt-dragging' : 'reminder-gantt-resizing'
    document.body.classList.add(bodyClass)
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) <= 3) return
      const next = clampDelta(original, mode, Math.round((ev.clientX - startX) / dayWidth))
      if (!moved || next !== delta) {
        moved = true
        delta = next
        setDrag({ key, mode, delta })
      }
    }
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove(bodyClass)
      if (!moved) {
        setDrag(null)
        ctx.open(r.item)
        return
      }
      if (delta) await ctx.reschedule(r.item, draggedDue(original, mode, delta))
      // Hold the dragged position until the index catches up with the edit.
      setTimeout(() => setDrag(null), delta ? 400 : 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const barClass = (r: Row) => {
    const state = taskState(r.item.task)
    const overdue = !r.item.task.checked && dueDate(r.due, ctx.defaultTime) < ctx.now
    return [
      'bar',
      state,
      overdue && 'overdue',
      r.milestone && 'milestone',
      r.clippedStart && 'clipped-start',
      r.clippedEnd && 'clipped-end',
      drag?.key === itemKey(r.item) && 'dragging',
      `p${r.item.task.priority}`
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div className="reminder-gantt">
      <div className="reminder-gantt-toolbar">
        <button type="button" onClick={() => setFrom(addDays(from, -7))} title={tr('Previous week', '前の週')}>
          ‹
        </button>
        <button type="button" onClick={() => setFrom(defaultFrom(new Date()))}>
          {tr('Today', '今日')}
        </button>
        <button type="button" onClick={() => setFrom(addDays(from, 7))} title={tr('Next week', '次の週')}>
          ›
        </button>
        <span className="range">
          {from.getFullYear()}/{from.getMonth() + 1}/{from.getDate()} 〜 {to.getMonth() + 1}/{to.getDate()}
        </span>
        <label className="show-done">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          {tr('Show done', '完了も表示')}
        </label>
        {outside > 0 && <span className="outside">{tr(`${outside} out of range`, `表示範囲外 ${outside}件`)}</span>}
      </div>

      <div className="reminder-gantt-scroll" ref={scrollRef}>
        <div className="reminder-gantt-table" style={{ width: 'max-content' }}>
          <div className="reminder-gantt-header" style={grid}>
            <div className="label-cell">
              {tr('Task', 'タスク')}
            </div>
            {days.map((d, i) => (
              <div
                key={i}
                className={[
                  'day',
                  (d.getDay() === 0 || d.getDay() === 6) && 'weekend',
                  i === todayIdx && 'today',
                  d.getDate() === 1 && 'month-start'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {(i === 0 || d.getDate() === 1) && <span className="month">{d.toLocaleDateString(locale(), { month: 'short' })}</span>}
                <span className="date">{d.getDate()}</span>
                <span className="weekday">{d.toLocaleDateString(locale(), { weekday: 'narrow' })}</span>
              </div>
            ))}
          </div>

          <div className="reminder-gantt-body">
            {/* Day columns behind the rows: weekends and today */}
            <div className="columns" style={grid}>
              <div />
              {days.map((d, i) => (
                <div
                  key={i}
                  className={[(d.getDay() === 0 || d.getDay() === 6) && 'weekend', i === todayIdx && 'today']
                    .filter(Boolean)
                    .join(' ')}
                />
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="reminder-tasks-empty">
                {tr('No tasks with a due date or period in this range', 'この期間に期限・期間が設定されたタスクはありません')}
              </div>
            ) : (
              rows.map(r => (
                <div key={itemKey(r.item)} className="row" style={grid}>
                  <div
                    className="label-cell"
                    onClick={() => ctx.open(r.item)}
                    title={tr('Click to open', 'クリックで開く')}
                  >
                    <div className="title" style={{ paddingLeft: `${r.depth * 16}px` }}>
                      <CollapseToggle
                        node={r.node!}
                        collapsed={collapsed.has(itemKey(r.item))}
                        onToggle={() => toggleCollapsed(itemKey(r.item))}
                      />
                      <KindChip item={r.item} />
                      {r.depth === 0 && <ParentLabel item={r.item} ctx={ctx} />}
                      <span className={r.item.task.checked ? 'done' : ''}>{itemTitle(r.item)}</span>
                    </div>
                    <div className="sub" style={{ paddingLeft: `${r.depth * 16}px` }}>
                      <Progress item={r.item} ctx={ctx} />
                      <Stars item={r.item} ctx={ctx} />
                      <span className="when">{formatDue(r.item)}</span>
                      {r.item.kind === 'task' && <span className="note">📒 {r.item.noteTitle || tr('Untitled note', '無題のノート')}</span>}
                    </div>
                  </div>
                  <div
                    className={barClass(r)}
                    style={{ gridColumn: `${r.first + 2} / ${r.last + 3}` }}
                    onPointerDown={e => beginDrag(e, r, 'move')}
                    title={`${itemTitle(r.item)}\n${formatDue({ ...r.item, task: { ...r.item.task, due: r.due } })}\n${tr('Drag to move, drag an end to change the period', 'ドラッグで移動・端をドラッグで期間を変更')}`}
                  >
                    {!r.milestone && !r.clippedStart && (
                      <span className="handle start" onPointerDown={e => beginDrag(e, r, 'start')} />
                    )}
                    {r.milestone ? (
                      <span className="diamond">◆</span>
                    ) : (
                      <span className="bar-label">{itemTitle(r.item)}</span>
                    )}
                    {!r.clippedEnd && <span className="handle end" onPointerDown={e => beginDrag(e, r, 'end')} />}
                    {drag?.key === itemKey(r.item) && (
                      <span className="drag-label">
                        {formatDue({ ...r.item, task: { ...r.item.task, due: r.due } })}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
