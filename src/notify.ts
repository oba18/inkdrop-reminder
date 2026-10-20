import { dismissAlert, pushAlert, type ReminderAlert } from './alerts'
import { getConfig, getEnv, saveEditingNote } from './env'
import { lang, locale, tr } from './i18n'
import {
  TASK_RE,
  noteDueEdit,
  parseNoteDue,
  replaceDueToken,
  setDueMarker,
  setDoingMarker,
  setPriorityMarker,
  setScheduleMarkers,
  stripMarkers,
  type DueInfo,
  type ParsedTask,
  type Priority
} from './parse'

/* ---- telling this device's edits from synced ones ---- */

/** How long a mark from one of our own writes waits for the note's change event */
const LOCAL_EDIT_MS = 10_000
const localEdits = new Map<string, number>()

/** Records that this window is about to change the note. */
function markLocalEdit(noteId: string) {
  localEdits.set(noteId, Date.now())
}

/**
 * Whether a change to the note was made on this device: by one of the
 * plugin's own actions, or in the editor of a focused window. A change that
 * arrived by sync from another device is left alone, so two devices don't
 * both react to it and write conflicting revisions.
 */
export function isLocalEdit(noteId: string): boolean {
  const marked = localEdits.get(noteId)
  if (marked !== undefined && Date.now() - marked < LOCAL_EDIT_MS) return true
  localEdits.delete(noteId)
  return getEnv().store.getState().editingNote?._id === noteId && document.hasFocus()
}

/** How long to wait for `onshow`/`onerror` before assuming the OS took it. */
const SHOW_TIMEOUT_MS = 3000

export type DesktopResult = 'shown' | 'denied' | 'unsupported' | 'error'

/**
 * Shows an OS notification through the renderer's Web Notification API,
 * asking for permission first if it hasn't been decided yet.
 */
export async function showDesktopNotification(
  title: string,
  body: string,
  opts: { tag?: string; onClick?: () => void } = {}
): Promise<DesktopResult> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    let permission = Notification.permission
    if (permission === 'default') permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      console.warn(`[reminder] desktop notification permission: ${permission}`)
      return 'denied'
    }
    const n = new Notification(title, { body, tag: opts.tag })
    if (opts.onClick) n.onclick = opts.onClick
    return await new Promise<DesktopResult>(resolve => {
      n.onshow = () => resolve('shown')
      n.onerror = e => {
        console.error('[reminder] desktop notification error:', e)
        resolve('error')
      }
      setTimeout(() => resolve('shown'), SHOW_TIMEOUT_MS)
    })
  } catch (err) {
    console.error('[reminder] desktop notification failed:', err)
    return 'error'
  }
}

function waitFor<T>(probe: () => T | null | undefined, timeoutMs = 3000): Promise<T | null> {
  return new Promise(resolve => {
    const start = Date.now()
    const tick = () => {
      const v = probe()
      if (v) resolve(v)
      else if (Date.now() - start > timeoutMs) resolve(null)
      else setTimeout(tick, 50)
    }
    tick()
  })
}

function flash(el: Element) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('reminder-flash')
  setTimeout(() => el.classList.remove('reminder-flash'), 2000)
}

/**
 * Points the note list (and the sidebar selection) at the note's notebook, so
 * the opened note shows up selected in it. The list may still be on whatever
 * the sidebar had before the Tasks view, e.g. Templates, which doesn't list
 * it. All Notes and the note's own notebook are left as they are. Returns
 * whether it switched.
 */
async function showNotebookOf(noteId: string): Promise<boolean> {
  const env = getEnv()
  const query = env.store.getState().queryContext as
    | { mode?: string; bookId?: string; tagId?: string; status?: string }
    | undefined
  const note = await env.localDB.notes.get(noteId)
  if (!note?.bookId || query?.mode === 'all') return false
  if (query?.mode === 'book' && query.bookId === note.bookId && !query.tagId && !query.status) return false
  env.commands.dispatch(document.body, 'core:note-list-show-notes-in-book', { bookId: note.bookId })
  return true
}

/**
 * Opens the alert's note and, for a task, moves the editor cursor to its line
 * and highlights it in the preview.
 */
export async function jumpToAlert(alert: Pick<ReminderAlert, 'noteId' | 'task'>) {
  const env = getEnv()
  env.window.show()
  env.window.focus()
  // After switching notebooks, open it again even if it is already open, to select it in the new list.
  const switched = await showNotebookOf(alert.noteId)
  if (switched || env.store.getState().editingNote?._id !== alert.noteId) {
    env.commands.dispatch(document.body, 'core:open-note', {
      noteId: alert.noteId,
      selectInNoteListBar: true
    })
  }
  const task = alert.task
  if (!task) return
  await waitFor(() => env.store.getState().editingNote?._id === alert.noteId)
  // Let the editor and preview render the newly opened note.
  await new Promise(r => setTimeout(r, 300))

  // Focus restored by the closing modal can land after our first move, so
  // re-apply once if the cursor isn't on the task line.
  for (let attempt = 0; attempt < 2; attempt++) {
    const view = env.getActiveEditor()
    if (!view || task.line + 1 > view.state.doc.lines) break
    const line = view.state.doc.line(task.line + 1)
    if (view.dom.offsetParent) view.focus()
    view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true })
    await new Promise(r => setTimeout(r, 250))
    if (view.state.doc.lineAt(view.state.selection.main.head).number === line.number) break
  }
  const li = await waitFor(() =>
    [...document.querySelectorAll('.mde-preview li')].find(el =>
      (el.firstChild?.textContent ?? el.textContent ?? '').includes(task.text)
    )
  , 1000)
  if (li) flash(li)
}

/** `isStart`: `at` is a period's start rather than a due date. */
export function describeWhen(at: Date, isStart = false): string {
  const diffMs = at.getTime() - Date.now()
  // Within a minute either side of the due time counts as "now".
  if (Math.abs(diffMs) < 60 * 1000) return isStart ? tr('Starts now', '開始です') : tr('Due now', '期限です')
  if (diffMs < 0) return isStart ? tr('Already started', '開始時刻を過ぎています') : tr('Overdue', '期限を過ぎています')
  const diffMin = Math.ceil(diffMs / 60000)
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  if (lang() === 'ja') {
    const prefix = isStart ? '開始まで' : ''
    return diffMin < 60 ? `${prefix}あと${diffMin}分` : `${prefix}あと${h}時間${m ? `${m}分` : ''}`
  }
  const left = diffMin < 60 ? `${diffMin} min` : `${h} h${m ? ` ${m} min` : ''}`
  return isStart ? `Starts in ${left}` : `Due in ${left}`
}

export async function notifyReminder(
  noteId: string,
  noteTitle: string,
  task: ParsedTask | null,
  at: Date,
  isStart = false
) {
  const { notificationStyle } = getConfig()
  const title = `⏰ ${task?.text || noteTitle}`
  const time = at.toLocaleString(locale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  const body = `${describeWhen(at, isStart)}${tr(` (${time})`, `（${time}）`)}\n${noteTitle}`
  const alert: ReminderAlert = {
    id: `${noteId}:${task ? task.line : 'note'}:${at.getTime()}`,
    noteId,
    noteTitle,
    task,
    at,
    isStart
  }

  let desktop: DesktopResult | null = null
  if (notificationStyle !== 'inapp') {
    desktop = await showDesktopNotification(title, body, {
      tag: alert.id,
      onClick: () => {
        jumpToAlert(alert)
        dismissAlert(alert.id)
      }
    })
  }
  // The in-app modal as well when asked to, or as a fallback so a reminder is
  // never lost.
  if (notificationStyle !== 'desktop' || desktop !== 'shown') pushAlert(alert)
}

/**
 * Marks the alert's task as done (`[ ]` → `[x]`), or for a note-level due
 * date, sets the note status to Completed.
 */
export async function completeAlert(alert: ReminderAlert) {
  markLocalEdit(alert.noteId)
  const env = getEnv()
  const isEditing = env.store.getState().editingNote?._id === alert.noteId
  if (!alert.task) {
    if (isEditing) env.commands.dispatch(document.body, 'editor:change-note-status-completed' as any)
    else {
      const note = await env.localDB.notes.get(alert.noteId)
      await env.localDB.notes.put({ ...note, status: 'completed' })
    }
    return
  }
  await setTaskState(alert.noteId, alert.task, 'done')
}

export type TaskState = 'todo' | 'doing' | 'done'

export function taskState(task: Pick<ParsedTask, 'checked' | 'doing'>): TaskState {
  return task.checked ? 'done' : task.doing ? 'doing' : 'todo'
}

/**
 * Rewrites a task line for `state`: `[ ]` / `[ ] … 🏃` / `[x]` (a finished
 * task drops its `🏃`). Goes through the editor when the note is open there so
 * its in-memory copy stays in sync.
 */
export async function setTaskState(noteId: string, task: Pick<ParsedTask, 'line' | 'text'>, state: TaskState) {
  await rewriteTaskLine(noteId, task, m => `${m[1]}${state === 'done' ? 'x' : ' '}${m[3]}${setDoingMarker(m[4], state === 'doing')}`)
}

/** Sets a task's `⭐` count (0 removes it). */
export async function setTaskPriority(noteId: string, task: Pick<ParsedTask, 'line' | 'text'>, priority: Priority) {
  await rewriteTaskLine(noteId, task, m => `${m[1]}${m[2]}${m[3]}${setPriorityMarker(m[4], priority)}`)
}

/** Moves a task's due date / period (its `🔔` setting stays). */
export async function setTaskDue(noteId: string, task: Pick<ParsedTask, 'line' | 'text'>, due: DueInfo) {
  await rewriteTaskLine(noteId, task, m => `${m[1]}${m[2]}${m[3]}${replaceDueToken(m[4], due)}`)
}

/** Sets a task's `⭐` count and/or due date (added when it has none) in one write. */
export async function setTaskMarkers(
  noteId: string,
  task: Pick<ParsedTask, 'line' | 'text'>,
  { priority, due }: { priority?: Priority; due?: DueInfo }
) {
  await rewriteTaskLine(noteId, task, m => {
    let content = m[4]
    if (priority !== undefined) content = setPriorityMarker(content, priority)
    if (due) content = setDueMarker(content, due)
    return `${m[1]}${m[2]}${m[3]}${content}`
  })
}

/** Sets a task's priority and due date / period / reminder (`null` removes the due date). */
export async function setTaskSchedule(
  noteId: string,
  task: Pick<ParsedTask, 'line' | 'text'>,
  due: DueInfo | null,
  priority: Priority
) {
  await rewriteTaskLine(noteId, task, m => `${m[1]}${m[2]}${m[3]}${setScheduleMarkers(m[4], due, priority)}`)
}

/** Sets a note's own due date / period / reminder, adding or (`null`) removing its due line. */
export async function setNoteSchedule(noteId: string, due: DueInfo | null) {
  markLocalEdit(noteId)
  const env = getEnv()
  const view = env.store.getState().editingNote?._id === noteId ? env.getActiveEditor() : null
  if (view) {
    const edit = noteDueEdit(view.state.doc.toString(), due)
    if (!edit) return
    view.dispatch({ changes: edit })
    await saveEditingNote(view.state.doc.toString())
    return
  }
  const note = await env.localDB.notes.get(noteId)
  const body: string = note.body ?? ''
  const edit = noteDueEdit(body, due)
  if (!edit) return
  await env.localDB.notes.put({
    ...note,
    body: body.slice(0, edit.from) + edit.insert + body.slice(edit.to),
    updatedAt: Date.now()
  })
}

/** Moves a note's own due date / period. */
export async function setNoteDue(noteId: string, due: DueInfo) {
  markLocalEdit(noteId)
  const env = getEnv()
  const view = env.store.getState().editingNote?._id === noteId ? env.getActiveEditor() : null
  if (view) {
    const nd = parseNoteDue(view.state.doc.toString())
    if (!nd) throw new Error(tr("The note's due date was not found", 'ノートの期限が見つかりませんでした'))
    const line = view.state.doc.line(nd.line + 1)
    view.dispatch({ changes: { from: line.from, to: line.to, insert: replaceDueToken(line.text, due) } })
    await saveEditingNote(view.state.doc.toString())
    return
  }
  const note = await env.localDB.notes.get(noteId)
  const nd = parseNoteDue(note.body ?? '')
  if (!nd) throw new Error(tr("The note's due date was not found", 'ノートの期限が見つかりませんでした'))
  const lines = (note.body ?? '').split('\n')
  lines[nd.line] = replaceDueToken(lines[nd.line], due)
  await env.localDB.notes.put({ ...note, body: lines.join('\n'), updatedAt: Date.now() })
}

/**
 * Rewrites the task's line (found by line number, or by its text if it moved)
 * from its `TASK_RE` match.
 */
async function rewriteTaskLine(
  noteId: string,
  task: Pick<ParsedTask, 'line' | 'text'>,
  rewrite: (m: RegExpExecArray) => string
) {
  markLocalEdit(noteId)
  const env = getEnv()
  const { line, text } = task
  const mark = (raw: string) => rewrite(TASK_RE.exec(raw)!)
  const isTarget = (raw: string) => TASK_RE.test(raw) && stripMarkers(TASK_RE.exec(raw)![4]).trim() === text
  const view = env.store.getState().editingNote?._id === noteId ? env.getActiveEditor() : null
  if (view) {
    const docLine = line + 1 <= view.state.doc.lines ? view.state.doc.line(line + 1) : null
    if (docLine && isTarget(docLine.text)) {
      view.dispatch({ changes: { from: docLine.from, to: docLine.to, insert: mark(docLine.text) } })
      // Save now so the status rule runs right away.
      await saveEditingNote(view.state.doc.toString())
      return
    }
  }
  const note = await env.localDB.notes.get(noteId)
  const lines = (note.body ?? '').split('\n')
  // The line may have moved since it was indexed; fall back to the text.
  const idx = lines[line] !== undefined && isTarget(lines[line]) ? line : lines.findIndex(isTarget)
  if (idx < 0) throw new Error(tr('The task was not found', 'タスクが見つかりませんでした'))
  lines[idx] = mark(lines[idx])
  await env.localDB.notes.put({ ...note, body: lines.join('\n'), updatedAt: Date.now() })
}

/**
 * Moves a note-level due date between the Kanban lanes: `🏃` on the due line
 * for in progress, and the note status Completed for done (Active again when
 * taken back out of done).
 */
export async function setNoteState(noteId: string, state: TaskState) {
  markLocalEdit(noteId)
  const env = getEnv()
  const doing = state === 'doing'
  const closed = (status?: string) => status === 'completed' || status === 'dropped'
  const nextStatus = (status?: string) =>
    state === 'done' ? (closed(status) ? null : 'completed') : closed(status) ? 'active' : null
  const editing = env.store.getState().editingNote
  const view = editing?._id === noteId ? env.getActiveEditor() : null
  if (view) {
    const nd = parseNoteDue(view.state.doc.toString())
    if (nd && nd.doing !== doing) {
      const line = view.state.doc.line(nd.line + 1)
      view.dispatch({ changes: { from: line.from, to: line.to, insert: setDoingMarker(line.text, doing) } })
      await saveEditingNote(view.state.doc.toString())
    }
    const status = nextStatus(editing?.status)
    if (status) env.commands.dispatch(document.body, `editor:change-note-status-${status}` as any)
    return
  }
  const note = await env.localDB.notes.get(noteId)
  const lines = (note.body ?? '').split('\n')
  const nd = parseNoteDue(note.body ?? '')
  if (nd && nd.doing !== doing) lines[nd.line] = setDoingMarker(lines[nd.line], doing)
  const status = nextStatus(note.status)
  await env.localDB.notes.put({
    ...note,
    body: lines.join('\n'),
    ...(status ? { status } : {}),
    updatedAt: Date.now()
  })
}

/**
 * Applies `cascadeChecks` results to the note. `body` is the text they were
 * computed from: a line that has changed since (the user kept typing) is left
 * alone. Checking drops a task's `🏃`, as in `setTaskState`.
 */
export async function applyCheckChanges(noteId: string, body: string, changes: Map<number, boolean>) {
  markLocalEdit(noteId)
  const original = body.split('\n')
  const mark = (raw: string, checked: boolean) => {
    const m = TASK_RE.exec(raw)!
    return `${m[1]}${checked ? 'x' : ' '}${m[3]}${checked ? setDoingMarker(m[4], false) : m[4]}`
  }
  const env = getEnv()
  const view = env.store.getState().editingNote?._id === noteId ? env.getActiveEditor() : null
  if (view) {
    const edits = []
    for (const [line, checked] of changes) {
      if (line + 1 > view.state.doc.lines) continue
      const docLine = view.state.doc.line(line + 1)
      if (docLine.text !== original[line] || !TASK_RE.test(docLine.text)) continue
      edits.push({ from: docLine.from, to: docLine.to, insert: mark(docLine.text, checked) })
    }
    if (!edits.length) return
    view.dispatch({ changes: edits })
    await saveEditingNote(view.state.doc.toString())
    return
  }
  const note = await env.localDB.notes.get(noteId)
  const lines = (note.body ?? '').split('\n')
  let changed = false
  for (const [line, checked] of changes) {
    if (lines[line] !== original[line] || !TASK_RE.test(lines[line])) continue
    lines[line] = mark(lines[line], checked)
    changed = true
  }
  if (changed) await env.localDB.notes.put({ ...note, body: lines.join('\n'), updatedAt: Date.now() })
}

export type NoteStatus = 'none' | 'active' | 'onHold' | 'completed' | 'dropped'

/** Sets a note's status, through the editor when the note is open there. */
export async function setNoteStatus(noteId: string, status: NoteStatus) {
  markLocalEdit(noteId)
  const env = getEnv()
  if (env.store.getState().editingNote?._id === noteId) {
    env.commands.dispatch(document.body, `editor:change-note-status-${status.toLowerCase()}` as any)
    return
  }
  const note = await env.localDB.notes.get(noteId)
  if (note.status === status) return
  await env.localDB.notes.put({ ...note, status, updatedAt: Date.now() })
}
