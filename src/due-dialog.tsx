import type { ButtonProps, Dialog as DialogType } from '@inkdropapp/types'
import type { EditorView } from '@codemirror/view'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { getConfig, getEnv, saveEditingNote } from './env'
import {
  DOING_RE,
  TASK_RE,
  formatMarkers,
  formatMinutesJa,
  parseDueInfo,
  parseNoteDue,
  parsePriority,
  stripMarkers,
  toDateString,
  type DueInfo,
  type Priority
} from './parse'

export type ReminderCommands = {
  'reminder:set-due': undefined
  'reminder:set-note-due': undefined
  'reminder:set-task-due': { line: number; text?: string }
}

interface Target {
  view: EditorView
  /** `task`: the line at `line`; `note`: the note's own due line */
  mode: 'task' | 'note'
  line: number
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00']
/** `null` = use the configured default, `-1` = no notification */
const REMIND_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '既定' },
  { value: 0, label: '時刻ちょうど' },
  { value: 5, label: '5分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 60 * 24, label: '1日前' },
  { value: -1, label: '通知しない' }
]

/** What the picker writes: nothing, a due date (by when), or a period (from–to). */
type Kind = 'none' | 'due' | 'period'

const KINDS: Array<{ value: Kind; label: string; title: string }> = [
  { value: 'none', label: '期限なし', title: '期限を付けない（優先度だけ付けるときなど）' },
  { value: 'due', label: '期限', title: 'いつまでに' },
  { value: 'period', label: '期間', title: 'いつからいつまで（複数日のタスク）' }
]

function addDays(d: Date, n: number) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() + n)
  return r
}

function nextMonday(from: Date) {
  const diff = (8 - from.getDay()) % 7 || 7
  return addDays(from, diff)
}

function shortDate(ds: string) {
  const [y, m, d] = ds.split('-').map(Number)
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`
}

/** Rewrites one editor line as a task carrying `due` (or none) and `priority`. */
function applyToLine({ view, line }: Target, due: DueInfo | null, priority: Priority) {
  const docLine = view.state.doc.line(line)
  const text = docLine.text
  const m = TASK_RE.exec(text)
  const stars = priority ? ` ${'⭐'.repeat(priority)}` : ''
  const markers = due ? ` ${formatMarkers(due)}` : ''
  let next: string
  if (m) {
    const body = stripMarkers(m[4])
    // Keep the in-progress marker the line already had.
    const doing = DOING_RE.test(m[4]) ? ' 🏃' : ''
    next = `${m[1]}${m[2]}] ${body}${doing}${stars}${markers}`
  } else if (!due && !priority) {
    return
  } else {
    // Turn a plain line or list item into a task.
    const lm = /^(\s*)(?:([-*+]|\d+[.)])\s+)?(.*)$/.exec(text)!
    const bullet = lm[2] ?? '-'
    const body = stripMarkers(lm[3])
    next = `${lm[1]}${bullet} [ ] ${body}${stars}${markers}`.replace(/\[ \] {2,}/, '[ ] ')
  }
  view.dispatch({
    changes: { from: docLine.from, to: docLine.to, insert: next },
    selection: { anchor: docLine.from + next.length }
  })
}

/**
 * Writes the note-level due line (`⏰… 🔔…` alone on a line), replacing an
 * existing one or inserting it at the top of the body; `null` removes it.
 */
function applyToNote({ view }: Target, due: DueInfo | null) {
  const doc = view.state.doc
  const existing = parseNoteDue(doc.toString())
  if (existing) {
    const line = doc.line(existing.line + 1)
    if (due) {
      const doing = existing.doing ? ' 🏃' : ''
      view.dispatch({ changes: { from: line.from, to: line.to, insert: `${formatMarkers(due)}${doing}` } })
      return
    }
    // Remove the line, plus the blank line we put after it.
    let to = Math.min(line.to + 1, doc.length)
    if (line.number < doc.lines && doc.line(line.number + 1).text === '') {
      to = Math.min(doc.line(line.number + 1).to + 1, doc.length)
    }
    view.dispatch({ changes: { from: line.from, to } })
  } else if (due) {
    const insert = doc.length ? `${formatMarkers(due)}\n\n` : formatMarkers(due)
    view.dispatch({ changes: { from: 0, insert } })
  }
}

function apply(target: Target, due: DueInfo | null, priority: Priority) {
  if (target.mode === 'note') applyToNote(target, due)
  else applyToLine(target, due, priority)
  // Save now so the scheduler sees the new due date right away.
  saveEditingNote(target.view.state.doc.toString()).catch(err =>
    console.error('[reminder] save failed:', err)
  )
}

/** The task the picker can work on: a task line, or a plain line to turn into one. */
interface TaskTarget {
  /** 1-based editor line */
  line: number
  label: string
  /** `false`: a plain line that becomes a task on OK */
  isTask: boolean
}

interface Session {
  view: EditorView
  task: TaskTarget | null
}

function taskTargetAt(view: EditorView, line: number): TaskTarget | null {
  if (line < 1 || line > view.state.doc.lines) return null
  const text = view.state.doc.line(line).text
  const m = TASK_RE.exec(text)
  if (m) return { line, label: stripMarkers(m[4]).trim(), isTask: true }
  // Blank lines, headings and the note's own due line can't become tasks.
  const plain = stripMarkers(text)
    .replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, '')
    .trim()
  if (!plain || /^\s*#/.test(text)) return null
  return { line, label: plain, isTask: false }
}

/** The task line holding `text`, nearest to `line` (lines can move between render and click). */
function findTaskLine(view: EditorView, line: number, text?: string): number | null {
  const at = taskTargetAt(view, line)
  if (at?.isTask && (!text || at.label === text)) return line
  if (!text) return at?.isTask ? line : null
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const t = taskTargetAt(view, n)
    if (t?.isTask && t.label === text) return n
  }
  return null
}

function existing(view: EditorView, mode: Mode, task: TaskTarget | null): { due: DueInfo | null; priority: Priority } {
  if (mode === 'note') return { due: parseNoteDue(view.state.doc.toString())?.due ?? null, priority: 0 }
  if (!task?.isTask) return { due: null, priority: 0 }
  const m = TASK_RE.exec(view.state.doc.line(task.line).text)
  return m ? { due: parseDueInfo(m[4]), priority: parsePriority(m[4]) } : { due: null, priority: 0 }
}

type Mode = 'task' | 'note'

/** 終日 / preset times / any time, for one end of a due date or period. */
const TimeRow: React.FC<{ label: string; value: string | null; onChange: (t: string | null) => void }> = ({
  label,
  value,
  onChange
}) => (
  <div className="reminder-row">
    <span className="label">{label}</span>
    <div className="reminder-times">
      <button type="button" className={value === null ? 'active' : ''} onClick={() => onChange(null)}>
        終日
      </button>
      {TIME_PRESETS.map(t => (
        <button key={t} type="button" className={value === t ? 'active' : ''} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
      <input type="time" value={value ?? ''} onChange={e => onChange(e.target.value || null)} />
    </div>
  </div>
)

/**
 * TickTick-style due date picker: quick picks, a month calendar, time and
 * reminder offset. A switch at the top picks what it sets: the task (the line
 * under the cursor, or the one whose ⏰ button was clicked) or the note itself;
 * another picks a due date (by when) or a period (from–to). Tasks also get a
 * priority (⭐–⭐⭐⭐).
 *
 * - `reminder:set-due` (⌘⇧R): the task under the cursor, else the note
 * - `reminder:set-note-due` (⌘⇧E): the note
 * - `reminder:set-task-due` `{ line, text }`: a given task (editor / preview buttons)
 */
export const DueDialog: React.FC = () => {
  const [{ Dialog, Button }] = useState(() => ({
    Dialog: getEnv().components.classes.Dialog as DialogType,
    Button: getEnv().components.getComponentClass<ButtonProps>('Button')!
  }))
  const [session, setSession] = useState<Session | null>(null)
  const [mode, setMode] = useState<Mode>('task')
  const [kind, setKind] = useState<Kind>('due')
  /** The due date, or a period's end */
  const [date, setDate] = useState<string>(toDateString(new Date()))
  const [time, setTime] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>(toDateString(new Date()))
  const [startTime, setStartTime] = useState<string | null>(null)
  /** Which end of the period the next calendar click sets */
  const [rangeStage, setRangeStage] = useState<'start' | 'end'>('start')
  const [remind, setRemind] = useState<number | null>(null)
  const [priority, setPriority] = useState<Priority>(0)
  const [month, setMonth] = useState(() => new Date())
  const [hadDue, setHadDue] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')

  const target: Target | null = session
    ? mode === 'note' || !session.task
      ? { view: session.view, mode: 'note', line: 0 }
      : { view: session.view, mode: 'task', line: session.task.line }
    : null

  const load = useCallback((view: EditorView, nextMode: Mode, task: TaskTarget | null) => {
    const { due, priority } = existing(view, nextMode, task)
    const today = toDateString(new Date())
    const shown = due?.start?.date ?? due?.date
    const base = shown ? new Date(`${shown}T00:00`) : new Date()
    setMode(nextMode)
    setKind(due?.start ? 'period' : 'due')
    setDate(due?.date ?? today)
    setTime(due?.time ?? null)
    setStartDate(due?.start?.date ?? due?.date ?? today)
    setStartTime(due?.start?.time ?? null)
    setRangeStage('start')
    setRemind(due?.reminder.off ? -1 : (due?.reminder.minutes ?? null))
    setPriority(priority)
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1))
    setHadDue(!!due)
  }, [])

  const close = useCallback(() => {
    // In preview mode the editor is hidden; leave the focus alone then.
    if (session?.view.dom.offsetParent) session.view.focus()
    setSession(null)
  }, [session])

  useEffect(() => {
    const env = getEnv()
    const open = (view: EditorView, prefer: Mode, task: TaskTarget | null) => {
      const nextMode = prefer === 'task' && task ? 'task' : 'note'
      load(view, nextMode, task)
      setNoteTitle(env.store.getState().editingNote?.title ?? '')
      setSession({ view, task })
    }
    const editor = () => {
      const view = env.getActiveEditor()
      if (!view) env.notifications.addWarning('ノートを開いてください')
      return view
    }
    /** The task under the cursor, while the editor is showing. */
    const cursorTask = (view: EditorView) =>
      view.dom.offsetParent ? taskTargetAt(view, view.state.doc.lineAt(view.state.selection.main.head).number) : null

    const sub = env.commands.add<ReminderCommands>(document.body, {
      'reminder:set-due': {
        description: '期限とリマインダーを設定（カーソルの行のタスク、なければノート）',
        didDispatch: () => {
          const view = editor()
          if (view) open(view, 'task', cursorTask(view))
        }
      },
      'reminder:set-note-due': {
        description: 'ノートに期限とリマインダーを設定',
        didDispatch: () => {
          const view = editor()
          if (view) open(view, 'note', cursorTask(view))
        }
      },
      'reminder:set-task-due': {
        hiddenInCommandPalette: true,
        didDispatch: (e: any) => {
          const view = editor()
          if (!view) return
          const { line, text } = (e?.detail ?? {}) as { line?: number; text?: string }
          const found = line ? findTaskLine(view, line, text) : null
          if (!found) {
            env.notifications.addWarning('タスクの行が見つかりませんでした')
            return
          }
          open(view, 'task', taskTargetAt(view, found))
        }
      }
    } as any)
    return () => sub.dispose()
  }, [load])

  const switchMode = (next: Mode) => {
    if (!session || next === mode || (next === 'task' && !session.task)) return
    load(session.view, next, session.task)
  }

  const changeKind = (next: Kind) => {
    if (next === kind) return
    // A period starts from the current due date; a due date keeps the end.
    if (next === 'period' && kind !== 'period') {
      setStartDate(date)
      setStartTime(null)
      setRangeStage('end')
    }
    setKind(next)
  }

  const setPeriod = (from: string, to: string) => {
    setStartDate(from)
    setDate(to)
    const d = new Date(`${from}T00:00`)
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  /** Calendar click: a due date, or the next end of the period (start, then end). */
  const pickDay = (ds: string) => {
    if (kind !== 'period') {
      setDate(ds)
      return
    }
    if (rangeStage === 'start' || ds < startDate) {
      setStartDate(ds)
      if (date < ds) setDate(ds)
      setRangeStage('end')
    } else {
      setDate(ds)
      setRangeStage('start')
    }
  }

  const buildDue = (overrideDate?: string): DueInfo | null => {
    if (kind === 'none') return null
    const reminder = remind === -1 ? { minutes: null, off: true } : { minutes: remind, off: false }
    if (kind === 'period') {
      // A one-day period with no times is just a due date.
      const sameDay = startDate === date && !startTime && !time
      return {
        date,
        time,
        start: sameDay ? null : { date: startDate, time: startTime },
        reminder
      }
    }
    return { date: overrideDate ?? date, time, start: null, reminder }
  }

  const submit = (overrideDate?: string) => {
    if (!target) return
    try {
      apply(target, buildDue(overrideDate), priority)
    } catch (err) {
      console.error('[reminder] failed to apply due date:', err)
    }
    close()
  }

  const clear = () => {
    if (target) apply(target, null, priority)
    close()
  }

  const today = useMemo(() => new Date(), [session])
  const quickPicks =
    kind === 'period'
      ? [
          { label: '今日〜明日', icon: '☀️', from: today, to: addDays(today, 1) },
          { label: '今週末まで', icon: '🗓️', from: today, to: addDays(today, (7 - today.getDay()) % 7) },
          { label: '来週（月〜金）', icon: '📅', from: nextMonday(today), to: addDays(nextMonday(today), 4) }
        ]
      : [
          { label: '今日', icon: '☀️', from: today, to: today },
          { label: '明日', icon: '🌅', from: addDays(today, 1), to: addDays(today, 1) },
          { label: '来週月曜', icon: '📅', from: nextMonday(today), to: nextMonday(today) }
        ]

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = addDays(first, -first.getDay())
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const { defaultRemindMinutes } = getConfig()
  const task = session?.task ?? null
  const showDates = kind !== 'none'
  const remindBaseLabel = kind === 'period' ? '開始' : '期限'

  return (
    <Dialog
      visible={!!session}
      className="reminder-due-dialog"
      onBackdropClick={close}
      onEscKeyDown={close}
      autofocus
    >
      <Dialog.Content>
        <div
          className="reminder-picker"
          onKeyDown={e => {
            if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
              e.preventDefault()
              submit()
            }
          }}
        >
          <div className="reminder-target">
            <button
              type="button"
              className={mode === 'task' ? 'active' : ''}
              disabled={!task}
              title={task ? 'このタスクの期限を設定' : 'タスクの行にカーソルを置くか、タスクの ⏰ ボタンから開くと選べます'}
              onClick={() => switchMode('task')}
            >
              ☑️ タスク
            </button>
            <button
              type="button"
              className={mode === 'note' ? 'active' : ''}
              title="このノート自体の期限を設定"
              onClick={() => switchMode('note')}
            >
              📒 ノート
            </button>
          </div>
          <div className="reminder-title">
            <span className="name">
              {mode === 'task' && task ? task.label : noteTitle || '無題のノート'}
            </span>
            {mode === 'task' && task && !task.isTask && (
              <span className="kind">この行をタスクにして期限を付けます</span>
            )}
          </div>

          {mode === 'task' && (
            <div className="reminder-row">
              <span className="label">⭐ 優先度</span>
              <div className="reminder-priority">
                {([0, 1, 2, 3] as Priority[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    className={priority === p ? 'active' : ''}
                    title={p ? `優先度 ${'★'.repeat(p)}` : '優先度なし'}
                    onClick={() => setPriority(p)}
                  >
                    {p ? '★'.repeat(p) : 'なし'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="reminder-kind">
            {KINDS.map(k => (
              <button
                key={k.value}
                type="button"
                className={kind === k.value ? 'active' : ''}
                title={k.title}
                onClick={() => changeKind(k.value)}
              >
                {k.label}
                <span className="sub">{k.title.replace(/（.*）/, '')}</span>
              </button>
            ))}
          </div>

          {showDates && (
            <>
              <div className="reminder-quick">
                {quickPicks.map(q => {
                  const from = toDateString(q.from)
                  const to = toDateString(q.to)
                  const active = kind === 'period' ? from === startDate && to === date : to === date
                  return (
                    <button
                      key={q.label}
                      type="button"
                      className={active ? 'active' : ''}
                      title={`${q.label}（Shiftを押しながらクリックで即決定）`}
                      onClick={e => {
                        if (kind === 'period') {
                          setPeriod(from, to)
                          setRangeStage('start')
                        } else {
                          setDate(to)
                          setMonth(new Date(q.to.getFullYear(), q.to.getMonth(), 1))
                        }
                        if (e.shiftKey && kind !== 'period') submit(to)
                      }}
                    >
                      <span className="icon">{q.icon}</span>
                      <span>{q.label}</span>
                    </button>
                  )
                })}
              </div>

              {kind === 'period' && (
                <div className="reminder-range-summary">
                  <span className={rangeStage === 'start' ? 'next' : ''}>開始 {shortDate(startDate)}</span>
                  <span className="arrow">〜</span>
                  <span className={rangeStage === 'end' ? 'next' : ''}>終了 {shortDate(date)}</span>
                  <span className="hint">
                    {rangeStage === 'start' ? '開始日をクリック' : '終了日をクリック'}
                  </span>
                </div>
              )}

              <div className="reminder-calendar">
                <div className="reminder-calendar-header">
                  <button
                    type="button"
                    onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  >
                    ‹
                  </button>
                  <span>
                    {month.getFullYear()}年{month.getMonth() + 1}月
                  </span>
                  <button
                    type="button"
                    onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  >
                    ›
                  </button>
                </div>
                <div className="reminder-calendar-grid">
                  {WEEKDAYS.map(w => (
                    <span key={w} className="weekday">
                      {w}
                    </span>
                  ))}
                  {cells.map(d => {
                    const ds = toDateString(d)
                    const isPeriod = kind === 'period'
                    const cls = [
                      'day',
                      d.getMonth() !== month.getMonth() && 'outside',
                      ds === toDateString(today) && 'today',
                      isPeriod
                        ? ds === startDate || ds === date
                          ? 'selected'
                          : ds > startDate && ds < date && 'in-range'
                        : ds === date && 'selected',
                      isPeriod && ds === startDate && startDate !== date && 'range-start',
                      isPeriod && ds === date && startDate !== date && 'range-end',
                      d.getDay() === 0 && 'sun',
                      d.getDay() === 6 && 'sat'
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <button
                        key={ds}
                        type="button"
                        className={cls}
                        onClick={() => pickDay(ds)}
                        onDoubleClick={() => kind === 'due' && submit(ds)}
                      >
                        {d.getDate()}
                      </button>
                    )
                  })}
                </div>
              </div>

              {kind === 'period' ? (
                <>
                  <TimeRow label="🕐 開始" value={startTime} onChange={setStartTime} />
                  <TimeRow label="🕐 終了" value={time} onChange={setTime} />
                </>
              ) : (
                <TimeRow label="🕐 時刻" value={time} onChange={setTime} />
              )}

              <div className="reminder-row">
                <span className="label">🔔 通知</span>
                <select
                  value={remind === null ? 'default' : String(remind)}
                  onChange={e => setRemind(e.target.value === 'default' ? null : Number(e.target.value))}
                >
                  {REMIND_OPTIONS.map(o => (
                    <option key={o.label} value={o.value === null ? 'default' : String(o.value)}>
                      {o.value === null
                        ? `既定（${remindBaseLabel}の${formatMinutesJa(defaultRemindMinutes)}前）`
                        : o.value === 0
                          ? `${remindBaseLabel}時刻ちょうど`
                          : o.value > 0
                            ? `${remindBaseLabel}の${o.label}`
                            : o.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </Dialog.Content>
      <Dialog.Actions className="reminder-actions">
        {hadDue && (
          <Button className="reminder-clear" negative basic onClick={clear}>
            期限を削除
          </Button>
        )}
        <Button onClick={close}>キャンセル</Button>
        <Button primary onClick={() => submit()}>
          OK
        </Button>
      </Dialog.Actions>
    </Dialog>
  )
}

DueDialog.displayName = 'ReminderDueDialog'
