import type { ButtonProps, Dialog as DialogType } from '@inkdropapp/types'
import type { EditorView } from '@codemirror/view'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { getConfig, getEnv, saveEditingNote } from './env'
import { lang, locale, rangeSep, shortDate, tr, useLanguage } from './i18n'
import { setNoteSchedule, setTaskSchedule } from './notify'
import {
  TASK_RE,
  formatMinutesEn,
  formatMinutesJa,
  noteDueEdit,
  parseDueInfo,
  parseNoteDue,
  parsePriority,
  setScheduleMarkers,
  stripMarkers,
  toDateString,
  type DueInfo,
  type Priority
} from './parse'
import type { TaskItem } from './scheduler'

export type ReminderCommands = {
  'reminder:set-due': undefined
  'reminder:set-note-due': undefined
  'reminder:set-task-due': { line: number; text?: string }
}

/** Short weekday names from Sunday, in the UI language. */
const weekdayNames = () =>
  Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale(), { weekday: 'short' }))
const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00']
/** `null` = use the configured default, `-1` = no notification */
const REMIND_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, get label() { return tr('Default', '既定') } },
  { value: 0, get label() { return tr('At the time', '時刻ちょうど') } },
  { value: 5, get label() { return tr('5 min before', '5分前') } },
  { value: 15, get label() { return tr('15 min before', '15分前') } },
  { value: 30, get label() { return tr('30 min before', '30分前') } },
  { value: 60, get label() { return tr('1 hour before', '1時間前') } },
  { value: 60 * 24, get label() { return tr('1 day before', '1日前') } },
  { value: -1, get label() { return tr('No reminder', '通知しない') } }
]

/** What the picker writes: nothing, a due date (by when), or a period (from–to). */
type Kind = 'none' | 'due' | 'period'

const KINDS: Array<{ value: Kind; label: string; sub: string; title: string }> = [
  {
    value: 'none',
    get label() {
      return tr('No date', '期限なし')
    },
    get sub() {
      return tr('No due date', '期限を付けない')
    },
    get title() {
      return tr('No due date (e.g. to set only a priority)', '期限を付けない（優先度だけ付けるときなど）')
    }
  },
  {
    value: 'due',
    get label() {
      return tr('Due', '期限')
    },
    get sub() {
      return tr('By when', 'いつまでに')
    },
    get title() {
      return tr('By when', 'いつまでに')
    }
  },
  {
    value: 'period',
    get label() {
      return tr('Period', '期間')
    },
    get sub() {
      return tr('From – to', 'いつからいつまで')
    },
    get title() {
      return tr('From when to when (multi-day tasks)', 'いつからいつまで（複数日のタスク）')
    }
  }
]

/** A 🔔 option, relative to the due time (or a period's start). */
function remindOptionLabel(o: { value: number | null; label: string }, isPeriod: boolean, defaultMinutes: number): string {
  if (lang() === 'ja') {
    const base = isPeriod ? '開始' : '期限'
    if (o.value === null) return `既定（${base}の${formatMinutesJa(defaultMinutes)}前）`
    if (o.value === 0) return `${base}時刻ちょうど`
    return o.value > 0 ? `${base}の${o.label}` : o.label
  }
  const base = isPeriod ? 'start' : 'due time'
  if (o.value === null) return `Default (${formatMinutesEn(defaultMinutes)} before ${base})`
  if (o.value === 0) return `At ${base}`
  return o.value > 0 ? `${o.label.replace(/ before$/, '')} before ${base}` : o.label
}

function addDays(d: Date, n: number) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() + n)
  return r
}

function nextMonday(from: Date) {
  const diff = (8 - from.getDay()) % 7 || 7
  return addDays(from, diff)
}


/** Rewrites one editor line as a task carrying `due` (or none) and `priority`. */
function applyToLine(view: EditorView, line: number, due: DueInfo | null, priority: Priority) {
  const docLine = view.state.doc.line(line)
  const text = docLine.text
  const m = TASK_RE.exec(text)
  let next: string
  if (m) {
    next = `${m[1]}${m[2]}${m[3]}${setScheduleMarkers(m[4], due, priority)}`
  } else if (!due && !priority) {
    return
  } else {
    // Turn a plain line or list item into a task.
    const lm = /^(\s*)(?:([-*+]|\d+[.)])\s+)?(.*)$/.exec(text)!
    const bullet = lm[2] ?? '-'
    const body = stripMarkers(lm[3])
    next = `${lm[1]}${bullet} [ ] ${setScheduleMarkers(body, due, priority)}`.replace(/\[ \] {2,}/, '[ ] ')
  }
  view.dispatch({
    changes: { from: docLine.from, to: docLine.to, insert: next },
    selection: { anchor: docLine.from + next.length }
  })
}

/** The task the picker can work on: a task line, or a plain line to turn into one. */
interface TaskTarget {
  /** 1-based editor line */
  line: number
  label: string
  /** `false`: a plain line that becomes a task on OK */
  isTask: boolean
}

/**
 * What the open picker edits: a line or the due line of the note in the
 * editor, or a task / note's due date from the Tasks view.
 */
interface Session {
  /** The task it can set, if any */
  task: Pick<TaskTarget, 'label' | 'isTask'> | null
  noteTitle: string
  /** What the target switch offers; a single one hides it */
  modes: Mode[]
  read(mode: Mode): { due: DueInfo | null; priority: Priority }
  write(mode: Mode, due: DueInfo | null, priority: Priority): Promise<void>
  /** Runs on close, e.g. to give the editor its focus back */
  restore?(): void
}

function editorSession(view: EditorView, task: TaskTarget | null, noteTitle: string): Session {
  return {
    task,
    noteTitle,
    modes: ['task', 'note'],
    read: mode => existing(view, mode, task),
    write: async (mode, due, priority) => {
      if (mode === 'note' || !task) {
        const edit = noteDueEdit(view.state.doc.toString(), due)
        if (edit) view.dispatch({ changes: edit })
      } else {
        applyToLine(view, task.line, due, priority)
      }
      // Save now so the scheduler sees the new due date right away.
      await saveEditingNote(view.state.doc.toString())
    },
    // In preview mode the editor is hidden; leave the focus alone then.
    restore: () => {
      if (view.dom.offsetParent) view.focus()
    }
  }
}

/** A task (or a note's own due date) from the Tasks view, written back without the editor. */
function itemSession(item: TaskItem): Session {
  const mode: Mode = item.kind === 'note' ? 'note' : 'task'
  return {
    task: mode === 'task' ? { label: stripMarkers(item.task.text).trim(), isTask: true } : null,
    noteTitle: item.noteTitle,
    modes: [mode],
    read: () => ({ due: item.task.due, priority: mode === 'task' ? item.task.priority : 0 }),
    write: (_, due, priority) =>
      mode === 'note' ? setNoteSchedule(item.noteId, due) : setTaskSchedule(item.noteId, item.task, due, priority)
  }
}

let openSession: ((session: Session) => void) | null = null

/** Opens the picker on a task or note's due date from the Tasks view. */
export function editItemDue(item: TaskItem) {
  if (openSession) openSession(itemSession(item))
  else getEnv().notifications.addWarning(tr('Could not open the due date picker', '期限の設定画面を開けませんでした'))
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
        {tr('All day', '終日')}
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
  useLanguage()
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

  const load = useCallback((s: Session, nextMode: Mode) => {
    const { due, priority } = s.read(nextMode)
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
    session?.restore?.()
    setSession(null)
  }, [session])

  useEffect(() => {
    const env = getEnv()
    const show = (s: Session, prefer: Mode = s.modes[0]) => {
      const nextMode = prefer === 'task' && s.task ? 'task' : 'note'
      load(s, s.modes.includes(nextMode) ? nextMode : s.modes[0])
      setSession(s)
    }
    const open = (view: EditorView, prefer: Mode, task: TaskTarget | null) =>
      show(editorSession(view, task, env.store.getState().editingNote?.title ?? ''), prefer)
    const editor = () => {
      const view = env.getActiveEditor()
      if (!view) env.notifications.addWarning(tr('Open a note first', 'ノートを開いてください'))
      return view
    }
    /** The task under the cursor, while the editor is showing. */
    const cursorTask = (view: EditorView) =>
      view.dom.offsetParent ? taskTargetAt(view, view.state.doc.lineAt(view.state.selection.main.head).number) : null

    const sub = env.commands.add<ReminderCommands>(document.body, {
      'reminder:set-due': {
        description: tr(
          'Reminder: Set due date & reminder (task at the cursor, or the note)',
          '期限とリマインダーを設定（カーソルの行のタスク、なければノート）'
        ),
        didDispatch: () => {
          const view = editor()
          if (view) open(view, 'task', cursorTask(view))
        }
      },
      'reminder:set-note-due': {
        description: tr("Reminder: Set the note's due date & reminder", 'ノートに期限とリマインダーを設定'),
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
            env.notifications.addWarning(tr('The task line was not found', 'タスクの行が見つかりませんでした'))
            return
          }
          open(view, 'task', taskTargetAt(view, found))
        }
      }
    } as any)
    openSession = show
    return () => {
      sub.dispose()
      if (openSession === show) openSession = null
    }
  }, [load])

  const switchMode = (next: Mode) => {
    if (!session || next === mode || (next === 'task' && !session.task)) return
    load(session, next)
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

  const write = (due: DueInfo | null) => {
    if (!session) return
    session.write(mode, due, priority).catch(err => {
      console.error('[reminder] failed to apply due date:', err)
      getEnv().notifications.addError(tr('Could not save the due date', '期限を保存できませんでした'), {
        detail: err instanceof Error ? err.message : String(err)
      })
    })
    close()
  }

  const submit = (overrideDate?: string) => write(buildDue(overrideDate))

  const clear = () => write(null)

  const today = useMemo(() => new Date(), [session])
  const quickPicks =
    kind === 'period'
      ? [
          { label: tr('Today – tomorrow', '今日〜明日'), icon: '☀️', from: today, to: addDays(today, 1) },
          { label: tr('Through this weekend', '今週末まで'), icon: '🗓️', from: today, to: addDays(today, (7 - today.getDay()) % 7) },
          { label: tr('Next week (Mon – Fri)', '来週（月〜金）'), icon: '📅', from: nextMonday(today), to: addDays(nextMonday(today), 4) }
        ]
      : [
          { label: tr('Today', '今日'), icon: '☀️', from: today, to: today },
          { label: tr('Tomorrow', '明日'), icon: '🌅', from: addDays(today, 1), to: addDays(today, 1) },
          { label: tr('Next Monday', '来週月曜'), icon: '📅', from: nextMonday(today), to: nextMonday(today) }
        ]

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = addDays(first, -first.getDay())
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const { defaultRemindMinutes } = getConfig()
  const task = session?.task ?? null
  const showDates = kind !== 'none'
  const isPeriod = kind === 'period'

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
          {session && session.modes.length > 1 && (
            <div className="reminder-target">
              <button
                type="button"
                className={mode === 'task' ? 'active' : ''}
                disabled={!task}
                title={
                  task
                    ? tr("Set this task's due date", 'このタスクの期限を設定')
                    : tr(
                        "Available when the cursor is on a task line, or when opened from a task's ⏰ button",
                        'タスクの行にカーソルを置くか、タスクの ⏰ ボタンから開くと選べます'
                      )
                }
                onClick={() => switchMode('task')}
              >
                ☑️ {tr('Task', 'タスク')}
              </button>
              <button
                type="button"
                className={mode === 'note' ? 'active' : ''}
                title={tr("Set the note's own due date", 'このノート自体の期限を設定')}
                onClick={() => switchMode('note')}
              >
                📒 {tr('Note', 'ノート')}
              </button>
            </div>
          )}
          <div className="reminder-title">
            <span className="name">
              {mode === 'task' && task ? task.label : session?.noteTitle || tr('Untitled note', '無題のノート')}
            </span>
            {mode === 'task' && task && !task.isTask && (
              <span className="kind">{tr('Turns this line into a task with a due date', 'この行をタスクにして期限を付けます')}</span>
            )}
          </div>

          {mode === 'task' && (
            <div className="reminder-row">
              <span className="label">⭐ {tr('Priority', '優先度')}</span>
              <div className="reminder-priority">
                {([0, 1, 2, 3] as Priority[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    className={priority === p ? 'active' : ''}
                    title={p ? tr(`Priority ${'★'.repeat(p)}`, `優先度 ${'★'.repeat(p)}`) : tr('No priority', '優先度なし')}
                    onClick={() => setPriority(p)}
                  >
                    {p ? '★'.repeat(p) : tr('None', 'なし')}
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
                <span className="sub">{k.sub}</span>
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
                      title={tr(`${q.label} (Shift-click to confirm right away)`, `${q.label}（Shiftを押しながらクリックで即決定）`)}
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
                  <span className={rangeStage === 'start' ? 'next' : ''}>
                    {tr('Start', '開始')} {shortDate(startDate)}
                  </span>
                  <span className="arrow">{rangeSep().trim()}</span>
                  <span className={rangeStage === 'end' ? 'next' : ''}>
                    {tr('End', '終了')} {shortDate(date)}
                  </span>
                  <span className="hint">
                    {rangeStage === 'start' ? tr('Click the start date', '開始日をクリック') : tr('Click the end date', '終了日をクリック')}
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
                  <span>{month.toLocaleDateString(locale(), { year: 'numeric', month: 'long' })}</span>
                  <button
                    type="button"
                    onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  >
                    ›
                  </button>
                </div>
                <div className="reminder-calendar-grid">
                  {weekdayNames().map(w => (
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
                  <TimeRow label={`🕐 ${tr('Start', '開始')}`} value={startTime} onChange={setStartTime} />
                  <TimeRow label={`🕐 ${tr('End', '終了')}`} value={time} onChange={setTime} />
                </>
              ) : (
                <TimeRow label={`🕐 ${tr('Time', '時刻')}`} value={time} onChange={setTime} />
              )}

              <div className="reminder-row">
                <span className="label">🔔 {tr('Remind', '通知')}</span>
                <select
                  value={remind === null ? 'default' : String(remind)}
                  onChange={e => setRemind(e.target.value === 'default' ? null : Number(e.target.value))}
                >
                  {REMIND_OPTIONS.map(o => (
                    <option key={o.label} value={o.value === null ? 'default' : String(o.value)}>
                      {remindOptionLabel(o, isPeriod, defaultRemindMinutes)}
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
            {tr('Remove due date', '期限を削除')}
          </Button>
        )}
        <Button onClick={close}>{tr('Cancel', 'キャンセル')}</Button>
        <Button primary onClick={() => submit()}>
          OK
        </Button>
      </Dialog.Actions>
    </Dialog>
  )
}

DueDialog.displayName = 'ReminderDueDialog'
