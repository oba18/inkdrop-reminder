export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
export const DAY_MS = 24 * 60 * 60 * 1000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
}

export function addMonths(d: Date, n: number): Date {
  // Clamp to the last day, so Jan 31 + 1 month is Feb 28/29.
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

export function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  const day = startOfDay(d)
  const diff = (day.getDay() - weekStartsOn + 7) % 7
  return addDays(day, -diff)
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` in local time. */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** `HH:MM` in local time. */
export function toTimeString(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** Local date from `YYYY-MM-DD` (+ optional `HH:MM`). */
export function parseLocal(date: string, time?: string | null): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = (time ?? '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, h, mi)
}

/** The 42 days shown in a month grid. */
export function monthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  const start = startOfWeek(startOfMonth(month), weekStartsOn)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function weekdayLabels(weekStartsOn: 0 | 1): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + weekStartsOn) % 7])
}

/** `9:00` / `14:30` — Google Calendar drops the leading zero. */
export function formatTime(d: Date): string {
  return `${d.getHours()}:${p2(d.getMinutes())}`
}

export function formatRange(start: Date, end: Date, allDay: boolean): string {
  const day = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
  if (allDay) {
    const last = addDays(end, -1)
    return sameDay(start, last) ? `${day(start)} 終日` : `${day(start)} 〜 ${day(last)}`
  }
  if (sameDay(start, end)) return `${day(start)} ${formatTime(start)} 〜 ${formatTime(end)}`
  return `${day(start)} ${formatTime(start)} 〜 ${day(end)} ${formatTime(end)}`
}
