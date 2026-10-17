import { jumpToAlert, setNoteDue, setNoteState, setTaskDue, setTaskState } from '../notify'
import type { DayTime, DueInfo } from '../parse'
import type { TaskItem as SourceItem } from '../scheduler'

export type { DayTime }

/** The due date; for a period, `start` is set and `date`/`time` are its end. */
export type Due = Pick<DueInfo, 'date' | 'time' | 'start'>

/** A task (or a note's own due date) with a due date, as the calendar shows it. */
export interface TaskItem {
  /** `noteId:line` (`noteId:note` for a note's own due date) */
  key: string
  noteTitle: string
  kind: 'task' | 'note'
  text: string
  checked: boolean
  due: DueInfo
  source: SourceItem
}

/** Plain text: `[label](url)` → label, emphasis and code marks dropped. */
function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
}

/** The Tasks view's items that have a due date. */
export function calendarTasks(items: SourceItem[]): TaskItem[] {
  const out: TaskItem[] = []
  for (const t of items) {
    if (!t.task.due) continue
    out.push({
      key: `${t.noteId}:${t.kind === 'note' ? 'note' : t.task.line}`,
      noteTitle: t.noteTitle || '無題のノート',
      kind: t.kind,
      text: t.kind === 'note' ? t.noteTitle || '無題のノート' : plainText(t.task.text) || '（無題のタスク）',
      checked: t.task.checked,
      due: t.task.due,
      source: t
    })
  }
  return out
}

/** Moves a task's due date / period; its `🔔` setting stays. */
export async function rescheduleTask(item: TaskItem, due: Due) {
  const next: DueInfo = { ...due, reminder: item.due.reminder }
  const { source } = item
  if (source.kind === 'note') await setNoteDue(source.noteId, next)
  else await setTaskDue(source.noteId, source.task, next)
}

export async function setTaskDone(item: TaskItem, done: boolean) {
  const { source } = item
  const state = done ? 'done' : 'todo'
  if (source.kind === 'note') await setNoteState(source.noteId, state)
  else await setTaskState(source.noteId, source.task, state)
}

/** Opens the note and puts the cursor on the task's line. */
export async function openTask(item: TaskItem) {
  const { source } = item
  await jumpToAlert({ noteId: source.noteId, task: source.kind === 'note' ? null : source.task })
}
