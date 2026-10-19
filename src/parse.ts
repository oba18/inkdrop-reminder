/**
 * Task line syntax:
 *
 *   - [ ] 見積書を送る ⭐⭐ ⏰2026-10-20 15:00 🔔30m
 *   - [ ] 展示会の準備 ⏰2026-10-20〜2026-10-23 18:00
 *
 * `⏰YYYY-MM-DD[ HH:MM]` is the due date; `⏰<start>〜<end>` a period, whose
 * end is the due date. `🔔<n>m|h|d` is how long before the due date (a
 * period's start) to notify (`🔔0m` = at that time, `🔔off` = no notification).
 * Without `🔔` the configured default applies. A `🏃` marks an unchecked task
 * as in progress (the Kanban's middle lane), and `⭐`–`⭐⭐⭐` its priority.
 */

export const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)(.*)$/
export const DUE_RE =
  /⏰\s?(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?(?:\s?[〜~]\s?(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?)?/
export const REMIND_RE = /🔔\s?(?:(\d+)\s?([mhd])|(off))/
export const DOING_RE = /🏃(?:\u200D[♀♂]\uFE0F?)?\uFE0F?/u
export const PRIORITY_RE = /(?:⭐\uFE0F?){1,3}/u

export type Priority = 0 | 1 | 2 | 3

export interface Reminder {
  /** `null` = use the configured default */
  minutes: number | null
  off: boolean
}

export interface DayTime {
  date: string // YYYY-MM-DD
  time: string | null // HH:MM, `null` = all day
}

export interface DueInfo extends DayTime {
  /** Set for a period (`⏰<start>〜<end>`); `date`/`time` are then its end */
  start: DayTime | null
  reminder: Reminder
}

export interface ParsedTask {
  line: number
  checked: boolean
  /** Task text with the due/reminder/in-progress markers stripped */
  text: string
  /** Marked in progress with `🏃` */
  doing: boolean
  /** Number of `⭐` (0 = none) */
  priority: Priority
  due: DueInfo | null
  /** Line of the task this one is indented under (its parent), `null` at the top */
  parent: number | null
  /** Lines of the tasks directly indented under this one (its subtasks) */
  children: number[]
}

const UNIT_MINUTES = { m: 1, h: 60, d: 60 * 24 } as const

export function parseDueInfo(content: string): DueInfo | null {
  const due = DUE_RE.exec(content)
  if (!due) return null
  const remind = REMIND_RE.exec(content)
  let reminder: Reminder = { minutes: null, off: false }
  if (remind?.[3]) reminder = { minutes: null, off: true }
  else if (remind) {
    reminder = {
      minutes: Number(remind[1]) * UNIT_MINUTES[remind[2] as keyof typeof UNIT_MINUTES],
      off: false
    }
  }
  const at = (date: string, time?: string): DayTime => ({ date, time: time ? padTime(time) : null })
  if (due[3]) return { ...at(due[3], due[4]), start: at(due[1], due[2]), reminder }
  return { ...at(due[1], due[2]), start: null, reminder }
}

export function parsePriority(content: string): Priority {
  const m = PRIORITY_RE.exec(content)
  return m ? (Math.min(3, m[0].replace(/\uFE0F/g, '').length) as Priority) : 0
}

export function stripMarkers(content: string): string {
  return content
    .replace(new RegExp(DUE_RE.source, 'g'), '')
    .replace(new RegExp(REMIND_RE.source, 'g'), '')
    .replace(new RegExp(DOING_RE.source, 'gu'), '')
    .replace(new RegExp(PRIORITY_RE.source, 'gu'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/, '')
}

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s/

/** Leading whitespace width, a tab counting as 4 */
function indentOf(raw: string): number {
  let n = 0
  for (const c of raw) {
    if (c === ' ') n++
    else if (c === '\t') n += 4
    else break
  }
  return n
}

/**
 * Every checkbox task. A task indented under another one (directly, or under a
 * plain list item that is) is its subtask; a line back at the parent's
 * indentation or left of it ends the nesting.
 */
export function parseTasks(body: string): ParsedTask[] {
  const tasks: ParsedTask[] = []
  // Open list items, innermost last; `task` is null for a plain item.
  const stack: Array<{ indent: number; task: ParsedTask | null }> = []
  let inFence = false
  body.split('\n').forEach((raw, line) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence || raw.trim() === '') return
    const indent = indentOf(raw)
    // Leaves the items this line isn't inside. An indented paragraph within an
    // item keeps the nesting; a line at the left edge ends it.
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (!LIST_ITEM_RE.test(raw)) return
    const m = TASK_RE.exec(raw)
    const parent = [...stack].reverse().find(s => s.task)?.task ?? null
    if (!m) {
      stack.push({ indent, task: null })
      return
    }
    const task: ParsedTask = {
      line,
      checked: m[2] !== ' ',
      text: stripMarkers(m[4]).trim(),
      doing: DOING_RE.test(m[4]),
      priority: parsePriority(m[4]),
      due: parseDueInfo(m[4]),
      parent: parent?.line ?? null,
      children: []
    }
    parent?.children.push(line)
    tasks.push(task)
    stack.push({ indent, task })
  })
  return tasks
}

/**
 * Adds or removes the `🏃` marker in a task's content, placing it before the
 * due/reminder markers (or at the end).
 */
export function setDoingMarker(content: string, doing: boolean): string {
  const without = content.replace(new RegExp(`\\s*${DOING_RE.source}`, 'gu'), '')
  if (!doing) return without
  const at = without.search(/\s*[⭐⏰🔔]/u)
  // A line of markers only (the note's due line) gets it at the end.
  if (at <= 0 || !without.slice(0, at).trim()) return `${without.trimEnd()} 🏃`
  return `${without.slice(0, at)} 🏃${without.slice(at)}`
}

/** Sets the `⭐` count in a task's content (0 removes it), before the due markers. */
export function setPriorityMarker(content: string, priority: Priority): string {
  const without = content.replace(new RegExp(`\\s*${PRIORITY_RE.source}`, 'gu'), '')
  if (!priority) return without
  const stars = '⭐'.repeat(priority)
  const at = without.search(/\s*[⏰🔔]/u)
  if (at < 0) return `${without.trimEnd()} ${stars}`
  return `${without.slice(0, at)} ${stars}${without.slice(at)}`
}

function formatDayTime(d: DayTime): string {
  return `${d.date}${d.time ? ` ${d.time}` : ''}`
}

/** Just the `⏰…` (or `⏰…〜…`) token, without the reminder. */
export function formatDueToken(due: Pick<DueInfo, 'date' | 'time' | 'start'>): string {
  return `⏰${due.start ? `${formatDayTime(due.start)}〜` : ''}${formatDayTime(due)}`
}

/** Swaps the `⏰…` token in a line for `due`'s, leaving everything else (🔔 included) alone. */
export function replaceDueToken(content: string, due: Pick<DueInfo, 'date' | 'time' | 'start'>): string {
  return content.replace(DUE_RE, formatDueToken(due))
}

/** Like `replaceDueToken`, adding the token at the end of a line that has none. */
export function setDueMarker(content: string, due: Pick<DueInfo, 'date' | 'time' | 'start'>): string {
  return DUE_RE.test(content) ? replaceDueToken(content, due) : `${content.trimEnd()} ${formatDueToken(due)}`
}

export function formatMarkers(due: DueInfo): string {
  let s = formatDueToken(due)
  if (due.reminder.off) s += ' 🔔off'
  else if (due.reminder.minutes !== null) s += ` 🔔${formatMinutes(due.reminder.minutes)}`
  return s
}

export function formatMinutes(min: number): string {
  if (min > 0 && min % UNIT_MINUTES.d === 0) return `${min / UNIT_MINUTES.d}d`
  if (min > 0 && min % UNIT_MINUTES.h === 0) return `${min / UNIT_MINUTES.h}h`
  return `${min}m`
}

export function padTime(t: string): string {
  const [h, m] = t.split(':')
  return `${h.padStart(2, '0')}:${m}`
}

/** Local `Date` of a day and time; all-day falls back to `defaultTime`. */
export function dayTimeDate(dt: DayTime, defaultTime: string): Date {
  const [y, mo, d] = dt.date.split('-').map(Number)
  const [h, mi] = (dt.time ?? defaultTime).split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi)
}

/** Local `Date` of the due moment (a period's end). */
export function dueDate(due: DueInfo, defaultTime: string): Date {
  return dayTimeDate(due, defaultTime)
}

/** What a reminder counts back from: a period's start, else the due moment. */
export function remindBase(due: DueInfo, defaultTime: string): Date {
  return dayTimeDate(due.start ?? due, defaultTime)
}

export function toDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface NoteDue {
  line: number
  due: DueInfo
  /** Marked in progress with `🏃` */
  doing: boolean
}

/**
 * A note-level due date is a line holding nothing but the markers, e.g.
 *
 *   ⏰2026-10-20 15:00 🔔30m
 *
 * The first such line outside a code fence wins; task lines never count.
 */
export function parseNoteDue(body: string): NoteDue | null {
  let inFence = false
  const lines = body.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line]
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence
    if (inFence || TASK_RE.test(raw) || stripMarkers(raw).trim() !== '') continue
    const due = parseDueInfo(raw)
    if (due) return { line, due, doing: DOING_RE.test(raw) }
  }
  return null
}

/**
 * Display label such as `10/20 15:00 · 🔔30分前`. Date-only dues show the time
 * they are treated as (`defaultTime`), so the effective time is always visible.
 */
export function formatDueLabel(due: DueInfo, defaultTime: string, defaultRemindMinutes: number): string {
  const md = (dt: DayTime) => {
    const [, mo, d] = dt.date.split('-').map(Number)
    return `${mo}/${d}`
  }
  let remind: string
  if (due.reminder.off) remind = '🔕'
  else {
    const min = due.reminder.minutes ?? defaultRemindMinutes
    const base = due.start ? '開始' : '期限'
    remind = `🔔${min === 0 ? `${base}時刻` : `${due.start ? '開始' : ''}${formatMinutesJa(min)}前`}`
  }
  if (due.start) {
    // A period shows times only where set: `10/20〜10/23`, `10/20 09:00〜10/23 18:00`.
    const t = (dt: DayTime) => (dt.time ? ` ${dt.time}` : '')
    return `${md(due.start)}${t(due.start)}〜${md(due)}${t(due)} · ${remind}`
  }
  return `${md(due)} ${due.time ?? defaultTime} · ${remind}`
}

export function formatMinutesJa(min: number): string {
  if (min > 0 && min % (60 * 24) === 0) return `${min / (60 * 24)}日`
  if (min > 0 && min % 60 === 0) return `${min / 60}時間`
  return `${min}分`
}

/**
 * Checkbox changes that keep parents and subtasks in step after the user
 * checked or unchecked tasks (`prev` → `next`, the same note's tasks before
 * and after an edit):
 *
 * - checking a task checks its open subtasks, all the way down
 * - checking a task's last open sibling checks the parent (and up)
 * - unchecking a subtask unchecks its checked parent (and up)
 *
 * Unchecking a parent leaves its subtasks as they are. Returns the lines to
 * change and their new state; empty when nothing needs to follow.
 */
export function cascadeChecks(prev: ParsedTask[], next: ParsedTask[]): Map<number, boolean> {
  const byLine = new Map(next.map(t => [t.line, t]))
  // Match each task to its earlier self: same line and text, else the same text (it moved).
  const unmatched = new Map<string, ParsedTask[]>()
  for (const p of prev) unmatched.set(p.text, [...(unmatched.get(p.text) ?? []), p])
  const before = (t: ParsedTask): ParsedTask | undefined => {
    const list = unmatched.get(t.text)
    if (!list?.length) return undefined
    const i = Math.max(0, list.findIndex(p => p.line === t.line))
    return list.splice(i, 1)[0]
  }
  const toggled = next.filter(t => {
    const p = before(t)
    return p !== undefined && p.checked !== t.checked
  })

  const desired = new Map<number, boolean>()
  const isChecked = (t: ParsedTask) => desired.get(t.line) ?? t.checked
  const checkDown = (t: ParsedTask) => {
    for (const line of t.children) {
      const c = byLine.get(line)!
      if (!isChecked(c)) desired.set(line, true)
      checkDown(c)
    }
  }
  const settleUp = (t: ParsedTask) => {
    for (let p = t.parent === null ? undefined : byLine.get(t.parent); p; ) {
      const allDone = p.children.every(line => isChecked(byLine.get(line)!))
      if (allDone === isChecked(p)) break
      desired.set(p.line, allDone)
      p = p.parent === null ? undefined : byLine.get(p.parent)
    }
  }
  for (const t of toggled) {
    if (t.checked) checkDown(t)
    settleUp(t)
  }
  for (const [line, checked] of desired) if (byLine.get(line)!.checked === checked) desired.delete(line)
  return desired
}
