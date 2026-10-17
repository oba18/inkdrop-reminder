import { DAY_MS, addDays, parseLocal, startOfDay } from './dates'
import type { TaskItem } from './tasks'

/** How long a timed task looks in the week / day views. */
export const TASK_MINUTES = 30
export const TASK_COLOR = 'var(--calendar-task-color)'

/** A task (or note due date) placed on the calendar */
export interface CalItem {
  key: string
  title: string
  start: Date
  /** Exclusive end; midnight after the last day for all-day items */
  end: Date
  allDay: boolean
  color: string
  task: TaskItem
}

export function taskToItem(task: TaskItem): CalItem {
  const { due } = task
  const base = { key: `task:${task.key}`, title: task.text, color: TASK_COLOR, task }
  if (due.start) {
    // A period: from its start to the end of its last day (or its end time).
    const start = parseLocal(due.start.date, due.start.time)
    const end = due.time ? parseLocal(due.date, due.time) : addDays(parseLocal(due.date), 1)
    return { ...base, start, end: end > start ? end : addDays(startOfDay(start), 1), allDay: !due.start.time && !due.time }
  }
  const allDay = !due.time
  const start = parseLocal(due.date, due.time)
  return {
    ...base,
    start,
    end: allDay ? addDays(start, 1) : new Date(start.getTime() + TASK_MINUTES * 60_000),
    allDay
  }
}

export function isDone(item: CalItem): boolean {
  return item.task.checked
}

/** Whether the item takes up any of `day`. */
export function onDay(item: CalItem, day: Date): boolean {
  const s = startOfDay(day).getTime()
  const e = s + DAY_MS
  if (item.start.getTime() === item.end.getTime()) return item.start.getTime() >= s && item.start.getTime() < e
  return item.start.getTime() < e && item.end.getTime() > s
}

/** Items lasting a day or more (or all-day) go in the all-day row / month bars. */
export function isAllDayLike(item: CalItem): boolean {
  return item.allDay || item.end.getTime() - item.start.getTime() >= DAY_MS
}

/** Order inside a day: all-day first, then by start, longer first. */
export function compareItems(a: CalItem, b: CalItem): number {
  const ad = isAllDayLike(a) ? 0 : 1
  const bd = isAllDayLike(b) ? 0 : 1
  return (
    ad - bd ||
    a.start.getTime() - b.start.getTime() ||
    b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()) ||
    Number(isDone(a)) - Number(isDone(b)) ||
    a.title.localeCompare(b.title)
  )
}

/* ---- side-by-side layout of overlapping timed items ---- */

export interface Placed {
  item: CalItem
  /** Minutes from midnight, clipped to the day */
  top: number
  bottom: number
  col: number
  cols: number
}

export function layoutDay(items: CalItem[], day: Date): Placed[] {
  const dayStart = startOfDay(day).getTime()
  const placed: Placed[] = items
    .map(item => {
      const top = Math.max(0, (item.start.getTime() - dayStart) / 60_000)
      const bottom = Math.min(24 * 60, (item.end.getTime() - dayStart) / 60_000)
      // Short items still get enough height to read.
      return { item, top, bottom: Math.max(bottom, top + 20), col: 0, cols: 1 }
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)

  // Clusters of transitively overlapping items share a column count.
  let cluster: Placed[] = []
  let clusterEnd = -1
  const flush = () => {
    const colEnds: number[] = []
    for (const p of cluster) {
      let col = colEnds.findIndex(end => end <= p.top)
      if (col < 0) col = colEnds.length
      colEnds[col] = p.bottom
      p.col = col
    }
    for (const p of cluster) p.cols = colEnds.length
    cluster = []
  }
  for (const p of placed) {
    if (p.top >= clusterEnd && cluster.length) flush()
    cluster.push(p)
    clusterEnd = Math.max(clusterEnd, p.bottom)
  }
  if (cluster.length) flush()
  return placed
}
