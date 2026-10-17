import type { Note } from 'inkdrop-model'

import { getConfig, getEnv } from './env'
import { applyCheckChanges, isLocalEdit, notifyReminder } from './notify'
import { cascadeChecks, dueDate, parseNoteDue, parseTasks, remindBase, type ParsedTask } from './parse'

const CHECK_INTERVAL_MS = 30 * 1000
const PAGE_SIZE = 500
/** Reminders missed while Inkdrop was closed are still shown if this recent */
const MISSED_WINDOW_MS = 12 * 60 * 60 * 1000
const FIRED_STORAGE_KEY = 'inkdrop-reminder:fired'
const FIRED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface NoteEntry {
  title: string
  status: Note['status']
  bookId: string
  updatedAt: number
  tags: string[]
  tasks: ParsedTask[]
  /** The note's own due date, as a pseudo task with empty `text` (`line` -1 when none) */
  noteDue: ParsedTask | null
  /** Whether every task in the note was checked, last time we looked */
  allDone: boolean
}

const CLOSED_STATUSES: Array<Note['status']> = ['completed', 'dropped']
/** Notes whose reminders don't fire: closed ones, and those put on hold */
const SILENT_STATUSES: Array<Note['status']> = [...CLOSED_STATUSES, 'onHold']

/** Every reminder a note carries: the note's own due date first, then its tasks. */
function reminders(entry: NoteEntry): ParsedTask[] {
  return entry.noteDue ? [entry.noteDue, ...entry.tasks] : entry.tasks
}

export interface TaskItem {
  noteId: string
  noteTitle: string
  noteStatus: Note['status']
  bookId: string
  noteUpdatedAt: number
  noteTags: string[]
  /** `note`: the note's own due date (`task.text` is empty) */
  kind: 'task' | 'note'
  task: ParsedTask
}

let current: ReminderScheduler | null = null

/** The main window's scheduler, or `null` in other windows / before start. */
export function getScheduler(): ReminderScheduler | null {
  return current
}

/**
 * Keeps an in-memory index of every note's tasks, fires desktop notifications
 * when a reminder is due, and flips the note status when its tasks are done.
 */
export class ReminderScheduler {
  private notes = new Map<string, NoteEntry>()
  private timer: ReturnType<typeof setInterval> | null = null
  started = false
  private subscription: { dispose(): void } | null = null
  private fired: Record<string, number> = loadFired()
  private listeners = new Set<() => void>()

  async start() {
    current = this
    const env = getEnv()
    this.subscription = env.localDB.onNoteChange(change => {
      this.handleChange(change).catch(err => console.error('[reminder] change failed:', err))
    })
    // `all()` lists the open notes (completed/dropped are left out). The result
    // carries `docs` at runtime, despite the `rows` in @inkdropapp/types.
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const res: any = await env.localDB.notes.all({
        limit: PAGE_SIZE,
        skip,
        pinnedFirst: false,
        sort: [{ createdAt: 'asc' }]
      })
      const docs: Note[] = res.docs ?? res.rows?.map((r: any) => r.doc).filter(Boolean) ?? []
      for (const doc of docs) this.index(doc, { initial: true })
      if (docs.length < PAGE_SIZE) break
    }
    // Closed notes too, so the task list can show their tasks.
    for (const status of ['completed', 'dropped'] as const) {
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const res: any = await env.localDB.notes.findWithStatus(status, { limit: PAGE_SIZE, skip })
        const docs: Note[] = res.docs ?? res.rows?.map((r: any) => r.doc).filter(Boolean) ?? []
        for (const doc of docs) this.index(doc, { initial: true })
        if (docs.length < PAGE_SIZE) break
      }
    }
    this.emit()
    // Reminders that came due more than MISSED_WINDOW_MS ago are never shown,
    // even with notifyMissed off, so the first run doesn't flood.
    this.check({ startup: true })
    this.timer = setInterval(() => this.check({ startup: false }), CHECK_INTERVAL_MS)
    this.started = true
    console.info(`[reminder] scheduler started: ${this.notes.size} notes indexed`)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.subscription?.dispose()
    this.subscription = null
    this.notes.clear()
    this.listeners.clear()
    this.started = false
    if (current === this) current = null
  }

  /** Called whenever the indexed tasks change. */
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  /** Every task and note-level due date in every note (closed notes included). */
  tasks(): TaskItem[] {
    const list: TaskItem[] = []
    for (const [noteId, entry] of this.notes) {
      for (const task of reminders(entry)) {
        list.push({
          noteId,
          noteTitle: entry.title,
          noteStatus: entry.status,
          bookId: entry.bookId,
          noteUpdatedAt: entry.updatedAt,
          noteTags: entry.tags,
          kind: task === entry.noteDue ? 'note' : 'task',
          task
        })
      }
    }
    return list
  }

  /** Upcoming unchecked reminders, soonest first. */
  upcoming(): Array<{ noteId: string; title: string; task: ParsedTask; at: Date }> {
    const { defaultTime } = getConfig()
    const list = []
    for (const [noteId, entry] of this.notes) {
      if (SILENT_STATUSES.includes(entry.status)) continue
      for (const task of reminders(entry)) {
        if (task.checked || !task.due) continue
        list.push({ noteId, title: entry.title, task, at: dueDate(task.due, defaultTime) })
      }
    }
    return list.sort((a, b) => a.at.getTime() - b.at.getTime())
  }

  private async handleChange(change: Record<string, any>) {
    const id: string | undefined = change.id ?? change.doc?._id ?? change._id
    if (!id?.startsWith('note:')) return
    if (change.deleted || change.doc?._deleted) {
      if (this.notes.delete(id)) this.emit()
      return
    }
    const inline = change.doc ?? (change.body !== undefined ? change : undefined)
    const note: Note | undefined =
      inline?.body !== undefined
        ? inline
        : await getEnv()
            .localDB.notes.get(id)
            .catch(() => undefined)
    if (note) this.index(note, { initial: false })
    else this.notes.delete(id)
    this.emit()
  }

  private index(note: Note, { initial }: { initial: boolean }) {
    if (note.bookId === 'trash' || note.bookId === 'template') {
      this.notes.delete(note._id)
      return
    }
    const body = note.body ?? ''
    // Only notes with tasks or a due date matter; keep the index small.
    if (!body.includes('[') && !body.includes('⏰')) {
      this.notes.delete(note._id)
      return
    }
    const tasks = parseTasks(body)
    const nd = parseNoteDue(body)
    // A note-level reminder is done once the note is closed.
    const noteDue: ParsedTask | null = nd
      ? { line: nd.line, checked: CLOSED_STATUSES.includes(note.status), text: '', doing: nd.doing, priority: 0, due: nd.due, parent: null, children: [] }
      : null
    const allDone = tasks.length > 0 && tasks.every(t => t.checked)
    const prev = this.notes.get(note._id)
    this.notes.set(note._id, {
      title: note.title,
      status: note.status,
      bookId: note.bookId,
      updatedAt: note.updatedAt,
      tags: note.tags ?? [],
      tasks,
      noteDue,
      allDone
    })
    // Automatic edits react only to changes made on this device; another device
    // that also runs the plugin handles its own, and synced changes are left alone.
    const local = !initial && isLocalEdit(note._id)
    // Keep parents and subtasks in step with what the user just checked.
    if (local && prev && getConfig().linkSubtasks) {
      const changes = cascadeChecks(prev.tasks, tasks)
      if (changes.size) {
        applyCheckChanges(note._id, body, changes).catch(err =>
          console.error('[reminder] subtask update failed:', err)
        )
      }
    }
    // A note seen for the first time: assume a completed one was all done.
    const prevAllDone = prev ? prev.allDone : note.status === 'completed'
    if (local && prevAllDone !== allDone) {
      this.updateStatus(note, tasks, !!noteDue, allDone).catch(err =>
        console.error('[reminder] status update failed:', err)
      )
    }
  }

  /** Runs only on the transition, so a status the user sets by hand sticks. */
  private async updateStatus(note: Note, tasks: ParsedTask[], hasNoteDue: boolean, allDone: boolean) {
    const cfg = getConfig()
    if (cfg.statusScope === 'reminder' && !hasNoteDue && !tasks.some(t => t.due)) return
    let next: Note['status'] | null = null
    if (allDone && cfg.autoComplete && note.status !== 'completed') next = 'completed'
    if (!allDone && cfg.autoReopen && note.status === 'completed') next = 'active'
    if (!next) return

    const env = getEnv()
    if (env.store.getState().editingNote?._id === note._id) {
      // Go through the editor so its in-memory copy of the note stays in sync.
      env.commands.dispatch(document.body, `editor:change-note-status-${next}` as any)
    } else {
      const latest = await env.localDB.notes.get(note._id)
      await env.localDB.notes.put({ ...latest, status: next })
    }
    console.debug(`[reminder] ${note._id} -> ${next}`)
  }

  private check({ startup }: { startup: boolean }) {
    const cfg = getConfig()
    const now = Date.now()
    for (const [noteId, entry] of this.notes) {
      // A Completed / Dropped / On Hold note reminds of nothing, its tasks included.
      if (SILENT_STATUSES.includes(entry.status)) continue
      for (const task of reminders(entry)) {
        if (task.checked || !task.due || task.due.reminder.off) continue
        // A period reminds of its start.
        const at = remindBase(task.due, cfg.defaultTime)
        const minutes = task.due.reminder.minutes ?? cfg.defaultRemindMinutes
        const remindAt = at.getTime() - minutes * 60 * 1000
        if (remindAt > now) continue
        const key = `${noteId}|${task === entry.noteDue ? '#note' : task.text}|${at.toISOString()}|${minutes}`
        if (this.fired[key]) continue
        this.markFired(key)
        const missed = now - remindAt > CHECK_INTERVAL_MS * 2
        if (now - remindAt > MISSED_WINDOW_MS) continue
        if (missed && startup && !cfg.notifyMissed) continue
        notifyReminder(noteId, entry.title, task === entry.noteDue ? null : task, at, !!task.due.start)
      }
    }
  }

  private markFired(key: string) {
    this.fired[key] = Date.now()
    saveFired(this.fired)
  }
}

function loadFired(): Record<string, number> {
  try {
    const data = JSON.parse(localStorage.getItem(FIRED_STORAGE_KEY) ?? '{}')
    const cutoff = Date.now() - FIRED_RETENTION_MS
    return Object.fromEntries(Object.entries<number>(data).filter(([, t]) => t > cutoff))
  } catch {
    return {}
  }
}

function saveFired(fired: Record<string, number>) {
  try {
    localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(fired))
  } catch {
    // Storage unavailable: worst case a reminder repeats after a restart.
  }
}
