import React, { useEffect, useMemo, useState } from 'react'

import { getConfig, getEnv, peekEnv } from './env'
import {
  jumpToAlert,
  setNoteDue,
  setNoteState,
  setTaskDue,
  setTaskMarkers,
  setTaskPriority,
  setTaskState,
  setNoteStatus,
  taskState,
  type NoteStatus,
  type TaskState
} from './notify'
import { dueDate, toDateString, type DayTime, type DueInfo, type Priority } from './parse'
import { getScheduler, type TaskItem } from './scheduler'
import { CalendarPanel } from './calendar/calendar-view'
import { Gantt } from './gantt'
import { Matrix } from './matrix'
import { NoteBoard } from './note-board'
import { flatten, makeLookup, nest, parentOf, subtasksOf, type TaskLookup, type TaskNode } from './subtasks'

/* ---- whether the task list is showing, in place of the note list and editor ---- */

const ACTIVE_CLASS = 'reminder-tasks-active'
let active = false
const activeListeners = new Set<(active: boolean) => void>()

export function setTasksViewActive(next: boolean) {
  if (active === next) return
  active = next
  document.body.classList.toggle(ACTIVE_CLASS, next)
  for (const l of activeListeners) l(next)
}

function useTasksViewActive(): boolean {
  const [value, setValue] = useState(active)
  useEffect(() => {
    activeListeners.add(setValue)
    setValue(active)
    return () => {
      activeListeners.delete(setValue)
    }
  }, [])
  return value
}

/** Indexed tasks, minus those in the notebooks the settings exclude. */
function listTasks(): TaskItem[] {
  if (!peekEnv()) return []
  const all = getScheduler()?.tasks() ?? []
  const { excludeNotebooks } = getConfig()
  if (!excludeNotebooks.length) return all
  const books: Record<string, { name: string }> = getEnv().store.getState().books?.hash ?? {}
  return all.filter(t => !excludeNotebooks.includes(books[t.bookId]?.name ?? ''))
}

function useTasks(): TaskItem[] {
  const [tasks, setTasks] = useState<TaskItem[]>(listTasks)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let sub: { dispose(): void } | null = null
    const refresh = () => setTasks(listTasks())
    // The scheduler may still be loading notes when the view mounts.
    const attach = () => {
      const scheduler = getScheduler()
      if (!scheduler) {
        timer = setTimeout(attach, 500)
        return
      }
      sub = scheduler.onDidChange(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(refresh, 100)
      })
      refresh()
    }
    attach()
    const configSub = getEnv().config.onDidChange('reminder.excludeNotebooks', refresh)
    return () => {
      if (timer) clearTimeout(timer)
      sub?.dispose()
      configSub.dispose()
    }
  }, [])
  return tasks
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  onHold: 'On Hold',
  completed: 'Completed',
  dropped: 'Dropped'
}

/** Note statuses in workflow order, as the filter, groups and board lanes show them */
export const STATUSES: Array<{ value: NoteStatus; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'active', label: 'Active' },
  { value: 'onHold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' }
]

/** Inkdrop's own status icon (the sidebar's), so colors follow the theme; a gray dot for None */
export const StatusIcon: React.FC<{ status: NoteStatus }> = ({ status }) => {
  const Icon = peekEnv()?.components.classes.NoteStatusIcon as React.ComponentType<{ status: string }> | undefined
  if (status === 'none' || !Icon) return <span className="status-dot" />
  return <Icon status={status} />
}

export const statusOf = (t: TaskItem): NoteStatus => (t.noteStatus as NoteStatus | undefined) ?? 'none'

/** A view setting kept across sessions; falls back to `fallback` when unset or unreadable. */
function usePersisted<T>(key: string, fallback: T, valid: (v: unknown) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      return saved !== null && valid(saved) ? saved : fallback
    } catch {
      return fallback
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // Not remembered; the default comes back next time.
    }
  }
  return [value, set]
}

/* ---- sidebar item ---- */

/** "Tasks" entry under All Notes / Templates in the sidebar. */
export const SideBarMenuItemTasks: React.FC = () => {
  const isActive = useTasksViewActive()
  const tasks = useTasks()
  // Rendered once more while the plugin deactivates.
  const env = peekEnv()
  if (!env) return null
  const { SideBarMenuItem, StreamlineIcon } = env.components.classes as Record<string, React.ComponentType<any>>
  if (!SideBarMenuItem) return null
  // Matches the list's default: open tasks, Completed / Dropped notes left out.
  const openCount = tasks.filter(t => !t.task.checked && DEFAULT_STATUSES.includes(statusOf(t))).length
  return (
    <SideBarMenuItem
      className="sidebar-menu-item-tasks"
      active={isActive}
      onClick={() => env.commands.dispatch(document.body, 'reminder:show-tasks' as any)}
      renderIcon={() => (StreamlineIcon ? <StreamlineIcon name="task-list-check-1" /> : null)}
      renderAccessory={() => <span className="accessory-count">{openCount}</span>}
    >
      Tasks
    </SideBarMenuItem>
  )
}

SideBarMenuItemTasks.displayName = 'ReminderSideBarMenuItemTasks'

/* ---- the task list ---- */

type Filter = 'open' | 'done' | 'all'
export type Mode = 'list' | 'kanban' | 'matrix' | 'notes' | 'gantt' | 'calendar'
type GroupBy = 'due' | 'status' | 'note'

const GROUP_BYS: Array<{ value: GroupBy; label: string }> = [
  { value: 'due', label: '期限' },
  { value: 'status', label: 'ステータス' },
  { value: 'note', label: 'ノート' }
]

/** Completed / Dropped notes' tasks are hidden until asked for. */
const DEFAULT_STATUSES: NoteStatus[] = ['none', 'active', 'onHold']

const MODE_STORAGE_KEY = 'inkdrop-reminder:tasks-mode'

function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY)
    return saved === 'kanban' || saved === 'matrix' || saved === 'notes' || saved === 'gantt' || saved === 'calendar' ? saved : 'list'
  } catch {
    return 'list'
  }
}

const modeListeners = new Set<(mode: Mode) => void>()

/** Shows the Tasks view, in `mode` when given. */
export function showTasks(mode?: Mode) {
  if (mode) {
    saveMode(mode)
    for (const l of modeListeners) l(mode)
  }
  setTasksViewActive(true)
}

function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Not remembered; the list opens next time.
  }
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: '未完了' },
  { value: 'done', label: '完了' },
  { value: 'all', label: 'すべて' }
]

type Bucket = 'overdue' | 'past' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

const BUCKETS: Array<{ key: Bucket; label: string }> = [
  { key: 'overdue', label: '期限切れ' },
  { key: 'past', label: '過去' },
  { key: 'today', label: '今日' },
  { key: 'tomorrow', label: '明日' },
  { key: 'week', label: '7日以内' },
  { key: 'later', label: 'それ以降' },
  { key: 'none', label: '期限なし' }
]

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function addDays(base: Date, n: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)
  return toDateString(d)
}

function bucketOf(item: TaskItem, now: Date, defaultTime: string): Bucket {
  const due = item.task.due
  if (!due) return 'none'
  const today = toDateString(now)
  if (due.date < today) return item.task.checked ? 'past' : 'overdue'
  // A period under way belongs to today.
  if (due.start && due.start.date <= today && due.date > today) return 'today'
  if (due.date === today) {
    return !item.task.checked && dueDate(due, defaultTime) < now ? 'overdue' : 'today'
  }
  if (due.date === addDays(now, 1)) return 'tomorrow'
  if (due.date <= addDays(now, 7)) return 'week'
  return 'later'
}

function formatDayTime(dt: DayTime, { weekday = true } = {}): string {
  const [y, mo, d] = dt.date.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  const year = y === new Date().getFullYear() ? '' : `${y}/`
  return `${year}${mo}/${d}${weekday ? `(${WEEKDAYS[date.getDay()]})` : ''}${dt.time ? ` ${dt.time}` : ''}`
}

/** `10/20(火) 15:00`, or for a period `10/20〜10/23 18:00`. */
export function formatDue(item: TaskItem): string {
  const due = item.task.due!
  if (due.start) return `${formatDayTime(due.start, { weekday: false })}〜${formatDayTime(due, { weekday: false })}`
  return formatDayTime(due)
}

/** Plain text for a task: `[label](url)` → label, emphasis and code marks dropped. */
function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
}

export const itemKey = (t: TaskItem) => `${t.noteId}:${t.kind === 'note' ? 'note' : t.task.line}`

/** What a row or card is called: the task text, or the note title for a note's own due date. */
export function itemTitle(t: TaskItem): string {
  if (t.kind === 'note') return t.noteTitle || '無題のノート'
  return plainText(t.task.text) || '（無題のタスク）'
}

export const KindChip: React.FC<{ item: TaskItem }> = ({ item }) =>
  item.kind === 'note' ? <span className="kind-note">📒 ノート</span> : null

function matches(item: TaskItem, keyword: string): boolean {
  if (!keyword) return true
  const k = keyword.toLowerCase()
  return item.task.text.toLowerCase().includes(k) || item.noteTitle.toLowerCase().includes(k)
}

/**
 * Every checkbox task across all notes, grouped by due date. Shown in place of
 * the note list and editor while "Tasks" is selected in the sidebar.
 */
export const TasksView: React.FC = () => {
  const isActive = useTasksViewActive()
  if (!isActive) return null
  return <TasksViewBody />
}

TasksView.displayName = 'ReminderTasksView'

const TasksViewBody: React.FC = () => {
  const env = getEnv()
  const tasks = useTasks()
  const [mode, setMode] = useState<Mode>(loadMode)
  const [filter, setFilter] = useState<Filter>('open')
  const [keyword, setKeyword] = useState('')
  const [statuses, setStatuses] = usePersisted<NoteStatus[]>(
    'inkdrop-reminder:status-filter',
    DEFAULT_STATUSES,
    v => Array.isArray(v)
  )
  const [groupBy, setGroupBy] = usePersisted<GroupBy>('inkdrop-reminder:list-group', 'due', v =>
    GROUP_BYS.some(g => g.value === v)
  )
  const toggleStatus = (status: NoteStatus) =>
    setStatuses(statuses.includes(status) ? statuses.filter(s => s !== status) : [...statuses, status])
  const [error, setError] = useState<string | null>(null)
  // Re-group each minute so "overdue" stays current.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    modeListeners.add(setMode)
    return () => {
      modeListeners.delete(setMode)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000)

    // Leave the view when the user picks another sidebar item or opens a note
    // some other way.
    const onClick = (e: MouseEvent) => {
      const item = (e.target as Element).closest?.('.sidebar-layout .sidebar-menu-item.selectable')
      if (item && !item.classList.contains('sidebar-menu-item-tasks')) setTasksViewActive(false)
    }
    document.addEventListener('click', onClick, true)
    let { queryContext, editingNote } = env.store.getState()
    let noteId = editingNote?._id
    const unsubscribe = env.store.subscribe(() => {
      const state = env.store.getState()
      if (state.queryContext !== queryContext || state.editingNote?._id !== noteId) {
        setTasksViewActive(false)
      }
      queryContext = state.queryContext
      noteId = state.editingNote?._id
    })
    return () => {
      clearInterval(timer)
      document.removeEventListener('click', onClick, true)
      unsubscribe()
    }
  }, [])

  // Re-sort the matrix as soon as its thresholds change in the settings.
  const [, setConfigVersion] = useState(0)
  useEffect(() => {
    const bump = () => setConfigVersion(n => n + 1)
    const subs = ['reminder.matrixImportantPriority', 'reminder.matrixUrgentDays'].map(key =>
      env.config.onDidChange(key, bump)
    )
    return () => {
      for (const sub of subs) sub.dispose()
    }
  }, [])

  const { defaultTime, matrixImportantPriority, matrixUrgentDays } = getConfig()
  const matrixRule = useMemo(
    () => ({ importantPriority: matrixImportantPriority, urgentDays: matrixUrgentDays }),
    [matrixImportantPriority, matrixUrgentDays]
  )
  const books: Record<string, { name: string }> = env.store.getState().books?.hash ?? {}

  const lookup = useMemo(() => makeLookup(tasks), [tasks])

  const visible = useMemo(() => {
    // Soonest due first; without a due date, the most recently updated note first.
    const time = (t: TaskItem) => (t.task.due ? dueDate(t.task.due, defaultTime).getTime() : Infinity)
    // A subtask shows along with a parent that matches.
    const hit = (t: TaskItem | undefined): boolean => !!t && (matches(t, keyword.trim()) || hit(parentOf(t, lookup)))
    return tasks
      .filter(t => statuses.includes(statusOf(t)) && hit(t))
      .sort(
        (x, y) =>
          (time(x) === time(y) ? 0 : time(x) < time(y) ? -1 : 1) ||
          y.task.priority - x.task.priority ||
          y.noteUpdatedAt - x.noteUpdatedAt ||
          x.noteId.localeCompare(y.noteId) ||
          x.task.line - y.task.line
      )
  }, [tasks, lookup, keyword, defaultTime, statuses])

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapsed = (item: TaskItem) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      const key = itemKey(item)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Subtasks go under their parent, so they sit in the parent's group whatever their own due date.
  const groups = useMemo((): ListGroup[] => {
    const shown = visible.filter(t => (filter === 'open' ? !t.task.checked : filter === 'done' ? t.task.checked : true))
    const byKey = new Map<string, TaskNode[]>()
    const keyOf = (t: TaskItem) =>
      groupBy === 'status' ? statusOf(t) : groupBy === 'note' ? t.noteId : bucketOf(t, now, defaultTime)
    for (const node of nest(shown)) {
      const k = keyOf(node.item)
      byKey.set(k, [...(byKey.get(k) ?? []), node])
    }
    if (groupBy === 'due') {
      return BUCKETS.filter(b => byKey.has(b.key)).map(b => ({ ...b, className: b.key, nodes: byKey.get(b.key)! }))
    }
    if (groupBy === 'status') {
      return STATUSES.filter(st => byKey.has(st.value)).map(st => ({
        key: st.value,
        label: st.value === 'none' ? 'ステータスなし' : st.label,
        status: st.value,
        className: `status-${st.value}`,
        nodes: byKey.get(st.value)!
      }))
    }
    // By note: in the order the notes' first tasks come (soonest due first).
    return [...byKey].map(([noteId, nodes]) => ({ key: noteId, label: '', className: 'note-group', nodes, note: nodes[0].item }))
  }, [visible, filter, now, defaultTime, groupBy])

  const total =
    mode === 'list'
      ? groups.reduce((n, g) => n + flatten(g.nodes, new Set(), itemKey).length, 0)
      : mode === 'notes'
        ? // The board's cards: notes with something left to do, plus closed ones.
          new Set(
            visible
              .filter(t => !t.task.checked || statusOf(t) === 'completed' || statusOf(t) === 'dropped')
              .map(t => t.noteId)
          ).size
        : visible.filter(t => !t.task.checked && (mode !== 'matrix' || t.kind === 'task')).length

  const changeMode = (next: Mode) => {
    setMode(next)
    saveMode(next)
  }

  const open = (item: TaskItem, { noteOnly = false } = {}) => {
    setTasksViewActive(false)
    const task = noteOnly || item.kind === 'note' ? null : item.task
    jumpToAlert({ noteId: item.noteId, task }).catch(err =>
      console.error('[reminder] jump failed:', err)
    )
  }

  const move = async (item: TaskItem, state: TaskState) => {
    if (taskState(item.task) === state) return
    try {
      if (item.kind === 'note') await setNoteState(item.noteId, state)
      else await setTaskState(item.noteId, item.task, state)
      setError(null)
    } catch (err) {
      console.error('[reminder] update failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const prioritize = async (item: TaskItem, priority: Priority) => {
    try {
      await setTaskPriority(item.noteId, item.task, priority)
      setError(null)
    } catch (err) {
      console.error('[reminder] priority failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const reschedule = async (item: TaskItem, due: DueInfo) => {
    try {
      if (item.kind === 'note') await setNoteDue(item.noteId, due)
      else await setTaskDue(item.noteId, item.task, due)
      setError(null)
    } catch (err) {
      console.error('[reminder] reschedule failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const updateMarkers = async (item: TaskItem, changes: { priority?: Priority; due?: DueInfo }) => {
    try {
      await setTaskMarkers(item.noteId, item.task, changes)
      setError(null)
    } catch (err) {
      console.error('[reminder] matrix move failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeStatus = async (noteId: string, status: NoteStatus) => {
    try {
      await setNoteStatus(noteId, status)
      setError(null)
    } catch (err) {
      console.error('[reminder] status change failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const ctx: ItemContext = { books, now, defaultTime, lookup, open, move, prioritize, reschedule }

  return (
    <div className={`reminder-tasks-view mode-${mode}`}>
      <div className="reminder-tasks-header">
        <h1>
          Tasks <span className="count">{total}</span>
        </h1>
        <div className="reminder-tasks-filters">
          {MODES.map(m => (
            <button
              key={m.value}
              type="button"
              className={mode === m.value ? 'active' : ''}
              onClick={() => changeMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'list' && (
          <div className="reminder-tasks-filters" title="グループ">
            {GROUP_BYS.map(g => (
              <button
                key={g.value}
                type="button"
                className={groupBy === g.value ? 'active' : ''}
                onClick={() => setGroupBy(g.value)}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
        {mode === 'list' && (
          <div className="reminder-tasks-filters">
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                className={filter === f.value ? 'active' : ''}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div className="reminder-status-filter" title="表示するノートのステータス">
          {STATUSES.map(st => (
            <button
              key={st.value}
              type="button"
              className={`status-${st.value}${statuses.includes(st.value) ? ' active' : ''}`}
              onClick={() => toggleStatus(st.value)}
            >
              <StatusIcon status={st.value} />
              {st.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="reminder-tasks-search"
          placeholder="タスク・ノートを検索"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
      </div>
      {error && <div className="reminder-tasks-error">{error}</div>}
      {!getScheduler()?.started ? (
        <div className="reminder-tasks-empty">読み込み中…</div>
      ) : mode === 'kanban' ? (
        <Kanban items={visible} ctx={ctx} />
      ) : mode === 'matrix' ? (
        <Matrix items={visible} ctx={ctx} rule={matrixRule} update={updateMarkers} />
      ) : mode === 'notes' ? (
        <NoteBoard items={visible} all={tasks} statuses={statuses} ctx={ctx} changeStatus={changeStatus} />
      ) : mode === 'gantt' ? (
        <Gantt items={visible} ctx={ctx} />
      ) : mode === 'calendar' ? (
        <CalendarPanel items={visible} leave={() => setTasksViewActive(false)} />
      ) : (
        <div className="reminder-tasks-body">
          {groups.length === 0 ? (
            <div className="reminder-tasks-empty">タスクはありません</div>
          ) : (
            groups.map(g => (
              <section key={g.key} className={`reminder-tasks-group ${g.className}`}>
                <h2>
                  {g.status && <StatusIcon status={g.status} />}
                  {g.note ? <NoteGroupTitle item={g.note} ctx={ctx} /> : g.label}{' '}
                  <span className="count">{flatten(g.nodes, new Set(), itemKey).length}</span>
                </h2>
                <ul>
                  {flatten(g.nodes, collapsed, itemKey).map(({ node, depth }) => {
                    const item = node.item
                    return (
                      <li
                        key={itemKey(item)}
                        className={[
                          item.task.checked && 'checked',
                          depth && 'subtask',
                          item.noteStatus === 'onHold' && 'on-hold'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ '--depth': depth } as React.CSSProperties}
                        onClick={() => open(item)}
                        title="クリックでタスクを開く"
                      >
                        <CollapseToggle
                          node={node}
                          collapsed={collapsed.has(itemKey(item))}
                          onToggle={() => toggleCollapsed(item)}
                        />
                        <input
                          type="checkbox"
                          checked={item.task.checked}
                          onClick={e => e.stopPropagation()}
                          onChange={() => move(item, item.task.checked ? 'todo' : 'done')}
                        />
                        <KindChip item={item} />
                        {depth === 0 && <ParentLabel item={item} ctx={ctx} />}
                        <span className="text">{itemTitle(item)}</span>
                        <Progress item={item} ctx={ctx} />
                        <Stars item={item} ctx={ctx} />
                        {item.task.doing && !item.task.checked && <span className="doing">🏃 進行中</span>}
                        <DueBadge item={item} ctx={ctx} />
                        {depth === 0 && groupBy !== 'note' && <NoteLabel item={item} ctx={ctx} />}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface ListGroup {
  key: string
  label: string
  className: string
  nodes: TaskNode[]
  /** Grouped by note: a task of the note, for its title and status */
  note?: TaskItem
  /** Grouped by status: which */
  status?: NoteStatus
}

/** A by-note group's heading: the note (click to open it), its status and notebook */
const NoteGroupTitle: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => (
  <span className="note-group-title" onClick={() => ctx.open(item, { noteOnly: true })} title="クリックでノートを開く">
    📒 {item.noteTitle || '無題のノート'}
    {STATUS_LABELS[statusOf(item)] && (
      <span className={`status-chip status-${statusOf(item)}`}>
        <StatusIcon status={statusOf(item)} />
        {STATUS_LABELS[statusOf(item)]}
      </span>
    )}
    {ctx.books[item.bookId] && <span className="book">📁 {ctx.books[item.bookId].name}</span>}
  </span>
)

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'list', label: 'リスト' },
  { value: 'kanban', label: 'カンバン' },
  { value: 'matrix', label: 'マトリクス' },
  { value: 'notes', label: 'ノート' },
  { value: 'gantt', label: 'ガント' },
  { value: 'calendar', label: 'カレンダー' }
]

export interface ItemContext {
  books: Record<string, { name: string }>
  now: Date
  defaultTime: string
  /** Any indexed task by note and line, for subtasks and parents */
  lookup: TaskLookup
  open: (item: TaskItem, opts?: { noteOnly?: boolean }) => void
  move: (item: TaskItem, state: TaskState) => Promise<void>
  prioritize: (item: TaskItem, priority: Priority) => Promise<void>
  reschedule: (item: TaskItem, due: DueInfo) => Promise<void>
}

/** ★★☆ for a task; click a star to set that priority, the current one again to clear it. */
export const Stars: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => {
  if (item.kind === 'note') return null
  const p = item.task.priority
  return (
    <span className={`stars p${p}`} onClick={e => e.stopPropagation()}>
      {([1, 2, 3] as Priority[]).map(n => (
        <button
          key={n}
          type="button"
          className={n <= p ? 'on' : ''}
          title={n === p ? '優先度をなしにする' : `優先度 ${'★'.repeat(n)}`}
          onClick={() => ctx.prioritize(item, n === p ? 0 : n)}
        >
          {n <= p ? '★' : '☆'}
        </button>
      ))}
    </span>
  )
}

/** ▾ / ▸ before a task that has subtasks in view; a spacer otherwise, so the checkboxes line up. */
export const CollapseToggle: React.FC<{ node: TaskNode; collapsed: boolean; onToggle: () => void }> = ({
  node,
  collapsed,
  onToggle
}) =>
  node.children.length ? (
    <button
      type="button"
      className="subtask-toggle"
      title={collapsed ? '小タスクを表示' : '小タスクを隠す'}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  ) : (
    <span className="subtask-toggle" />
  )

/** `☑ 1/3`: how many of a task's subtasks are done */
export const Progress: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => {
  const subs = subtasksOf(item, ctx.lookup)
  if (!subs.length) return null
  const done = subs.filter(t => t.task.checked).length
  return (
    <span className={`subtask-progress${done === subs.length ? ' complete' : ''}`} title="完了した小タスク">
      ☑ {done}/{subs.length}
    </span>
  )
}

/** `↳ 親タスク` on a subtask shown on its own, its parent being filtered out */
export const ParentLabel: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => {
  const parent = parentOf(item, ctx.lookup)
  return parent ? <span className="subtask-parent">↳ {itemTitle(parent)}</span> : null
}

export const DueBadge: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => {
  if (!item.task.due) return null
  const bucket = bucketOf(item, ctx.now, ctx.defaultTime)
  return <span className={`due ${bucket}`}>⏰ {formatDue(item)}</span>
}

export const NoteLabel: React.FC<{ item: TaskItem; ctx: ItemContext; link?: boolean }> = ({ item, ctx, link }) => (
  <span
    className={`note${link ? ' link' : ''}`}
    title={link ? 'クリックでノートを開く' : undefined}
    onClick={
      link
        ? e => {
            e.stopPropagation()
            ctx.open(item, { noteOnly: true })
          }
        : undefined
    }
  >
    {item.noteStatus && STATUS_LABELS[item.noteStatus] && (
      <span className={`status ${item.noteStatus}`}>{STATUS_LABELS[item.noteStatus]}</span>
    )}
    {item.kind === 'note' ? (
      // The title is the card itself; just say where the note lives.
      ctx.books[item.bookId] && <span className="book">📁 {ctx.books[item.bookId].name}</span>
    ) : (
      <>
        📒 {item.noteTitle || '無題のノート'}
        {ctx.books[item.bookId] && <span className="book"> · {ctx.books[item.bookId].name}</span>}
      </>
    )}
  </span>
)

/* ---- Kanban ---- */

const LANES: Array<{ state: TaskState; label: string }> = [
  { state: 'todo', label: '未着手' },
  { state: 'doing', label: '進行中' },
  { state: 'done', label: '完了' }
]

/** Done tasks pile up; show the most recent ones and page through the rest. */
const DONE_PAGE = 30
const DRAG_TYPE = 'application/x-inkdrop-reminder-task'

const Kanban: React.FC<{ items: TaskItem[]; ctx: ItemContext }> = ({ items, ctx }) => {
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE)
  const [dragOver, setDragOver] = useState<TaskState | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const lanes = useMemo(() => {
    const by: Record<TaskState, TaskItem[]> = { todo: [], doing: [], done: [] }
    // Subtasks are a checklist on their parent's card, not cards of their own.
    for (const { item: t } of nest(items)) by[taskState(t.task)].push(t)
    // Open lanes: higher priority first (then by due date, as given).
    const byPriority = (x: TaskItem, y: TaskItem) => y.task.priority - x.task.priority
    by.todo.sort(byPriority)
    by.doing.sort(byPriority)
    // Done: the most recently updated notes first, whatever the due date.
    by.done.sort((x, y) => y.noteUpdatedAt - x.noteUpdatedAt || x.task.line - y.task.line)
    return by
  }, [items])

  const keyOf = itemKey

  const onDrop = (state: TaskState) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    setDragging(null)
    const key = e.dataTransfer.getData(DRAG_TYPE)
    const item = items.find(t => keyOf(t) === key)
    if (item) ctx.move(item, state)
  }

  return (
    <div className="reminder-kanban">
      {LANES.map(lane => {
        const all = lanes[lane.state]
        const shown = lane.state === 'done' ? all.slice(0, doneLimit) : all
        return (
          <section
            key={lane.state}
            className={`reminder-kanban-lane ${lane.state}${dragOver === lane.state ? ' drag-over' : ''}`}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOver !== lane.state) setDragOver(lane.state)
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
            }}
            onDrop={onDrop(lane.state)}
          >
            <h2>
              {lane.label} <span className="count">{all.length}</span>
            </h2>
            <div className="reminder-kanban-cards">
              {shown.map(item => (
                <div
                  key={keyOf(item)}
                  className={`reminder-kanban-card${dragging === keyOf(item) ? ' dragging' : ''}${
                    item.noteStatus === 'onHold' ? ' on-hold' : ''
                  }`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData(DRAG_TYPE, keyOf(item))
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(keyOf(item))
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setDragOver(null)
                  }}
                  onClick={() => ctx.open(item)}
                  title="クリックでタスクを開く・ドラッグで移動"
                >
                  <div className="text">
                    <KindChip item={item} />
                    {itemTitle(item)}
                  </div>
                  <ParentLabel item={item} ctx={ctx} />
                  <div className="meta">
                    <Progress item={item} ctx={ctx} />
                    <Stars item={item} ctx={ctx} />
                    <DueBadge item={item} ctx={ctx} />
                  </div>
                  <SubtaskChecklist item={item} ctx={ctx} />
                  <NoteLabel item={item} ctx={ctx} link />
                  <div className="actions" onClick={e => e.stopPropagation()}>
                    {LANES.filter(l => l.state !== lane.state).map(l => (
                      <button key={l.state} type="button" onClick={() => ctx.move(item, l.state)}>
                        {LANE_ACTIONS[l.state]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {shown.length < all.length && (
                <button type="button" className="more" onClick={() => setDoneLimit(n => n + DONE_PAGE * 2)}>
                  さらに表示（残り {all.length - shown.length} 件）
                </button>
              )}
              {all.length === 0 && <div className="empty">ここにドラッグ</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** A card's subtasks (and theirs, indented): check them off, click one to jump to it. */
export const SubtaskChecklist: React.FC<{ item: TaskItem; ctx: ItemContext }> = ({ item, ctx }) => {
  const subs = subtasksOf(item, ctx.lookup)
  if (!subs.length) return null
  return (
    <ul className="subtask-checklist" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      {subs.map(sub => (
        <li key={itemKey(sub)} className={sub.task.checked ? 'checked' : ''}>
          <div className="row">
            <input
              type="checkbox"
              checked={sub.task.checked}
              onChange={() => ctx.move(sub, sub.task.checked ? 'todo' : 'done')}
            />
            <span className="text" onClick={() => ctx.open(sub)} title="クリックでタスクを開く">
              {itemTitle(sub)}
            </span>
            {sub.task.doing && !sub.task.checked && <span className="doing">🏃</span>}
            <DueBadge item={sub} ctx={ctx} />
          </div>
          <SubtaskChecklist item={sub} ctx={ctx} />
        </li>
      ))}
    </ul>
  )
}

const LANE_ACTIONS: Record<TaskState, string> = {
  todo: '↩ 未着手',
  doing: '🏃 進行中',
  done: '✓ 完了'
}
