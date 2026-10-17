import type { CalItem } from './items'

/** What every view needs from the calendar shell. */
export interface ViewContext {
  today: Date
  weekStartsOn: 0 | 1
  /** Items on a day, already sorted */
  itemsOn(day: Date): CalItem[]
  /** Opens the task's note at its line */
  open(item: CalItem): void
  toggleDone(item: CalItem): void
  /** Reschedules a task to `start` (all day, or at its time) */
  move(item: CalItem, start: Date, allDay: boolean): void
  /** Switches to the day view of `day` */
  showDay(day: Date): void
}

/** HTML5 drag type for moving an item onto a day cell. */
export const DRAG_TYPE = 'application/x-inkdrop-reminder-calendar-item'
