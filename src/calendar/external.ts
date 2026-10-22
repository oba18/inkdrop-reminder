import { useSyncExternalStore } from 'react'

/**
 * Events from outside Inkdrop (another plugin's calendar feed), shown read-only
 * next to the tasks. Other plugins register a source through the reminder
 * package's main module:
 *
 *     const reminder = inkdrop.packages.getActivePackage('reminder')?.mainModule
 *     const sub = reminder.registerCalendarSource({
 *       id: 'my-calendar', name: 'My calendar', color: '#4285f4',
 *       getEvents: () => events, onDidChange: cb => unsubscribe
 *     })
 *     // later: sub.dispose()
 */
export interface ExternalEvent {
  id: string
  title: string
  /** `YYYY-MM-DD` for all-day events (end exclusive), else local `YYYY-MM-DDTHH:mm` */
  start: string
  end: string
  allDay: boolean
  /** Overrides the source's color */
  color?: string
  /** Shown in the tooltip */
  calendar?: string
  location?: string
}

export interface CalendarSource {
  id: string
  name: string
  color?: string
  /** Sidebar heading the source is listed under (e.g. its account); default "Other calendars" */
  group?: string
  /**
   * For sources that load only what is shown: whether it is on, and how to turn
   * it on or off (the sidebar checkbox). Without these the checkbox just hides it.
   */
  active?: boolean
  setActive?(active: boolean): void
  getEvents(): ExternalEvent[]
  /** Calls `cb` when the events change; returns an unsubscribe function */
  onDidChange?(cb: () => void): () => void
}

const sources = new Map<string, { source: CalendarSource; unsubscribe?: () => void }>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version++
  for (const l of listeners) l()
}

export function registerCalendarSource(source: CalendarSource): { dispose(): void } {
  sources.get(source.id)?.unsubscribe?.()
  sources.set(source.id, { source, unsubscribe: source.onDidChange?.(emit) })
  emit()
  return {
    dispose() {
      const entry = sources.get(source.id)
      if (entry?.source !== source) return
      entry.unsubscribe?.()
      sources.delete(source.id)
      emit()
    }
  }
}

export function clearCalendarSources() {
  for (const { unsubscribe } of sources.values()) unsubscribe?.()
  sources.clear()
  emit()
}

/** Whether the source's events are shown, given the sidebar's locally hidden ids. */
export function isSourceShown(source: CalendarSource, hidden: string[]): boolean {
  return source.setActive ? !!source.active : !hidden.includes(source.id)
}

/** The registered sources; re-renders when a source is added, removed or changes its events. */
export function useCalendarSources(): CalendarSource[] {
  useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
  return [...sources.values()].map(e => e.source)
}
