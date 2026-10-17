import { getEnv } from '../env'

export { getEnv, peekEnv, saveEditingNote } from '../env'

export type ViewKind = 'year' | 'month' | 'week' | 'day'

export interface CalendarConfig {
  weekStartsOn: 0 | 1
  /** Hour the week / day views scroll to */
  dayStartHour: number
}

export function getConfig(): CalendarConfig {
  const { config } = getEnv()
  return {
    weekStartsOn: config.get('reminder.calendarWeekStartsOn') === 'monday' ? 1 : 0,
    dayStartHour: config.get('reminder.calendarDayStartHour') ?? 8
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
