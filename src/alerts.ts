import type { ParsedTask } from './parse'

export interface ReminderAlert {
  id: string
  noteId: string
  noteTitle: string
  /** `null` for the note's own due date */
  task: ParsedTask | null
  at: Date
  /** `at` is a period's start */
  isStart?: boolean
  /** Sample shown by the test command: no open/complete actions */
  test?: boolean
}

type Listener = (alerts: ReminderAlert[]) => void

/** Fired reminders waiting to be acknowledged in the alert modal. */
let queue: ReminderAlert[] = []
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(queue)
}

export function pushAlert(alert: ReminderAlert) {
  queue = [...queue.filter(a => a.id !== alert.id), alert]
  emit()
}

export function dismissAlert(id: string) {
  queue = queue.filter(a => a.id !== id)
  emit()
}

export function dismissAllAlerts() {
  queue = []
  emit()
}

export function subscribeAlerts(listener: Listener): () => void {
  listeners.add(listener)
  listener(queue)
  return () => listeners.delete(listener)
}
