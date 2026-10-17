import type { Environment } from '@inkdropapp/types'

/**
 * Captures the `Environment` handed to `activate()` so other modules can reach
 * it without the (discouraged) global `inkdrop`.
 */
let captured: Environment | undefined

export function setEnv(env: Environment | undefined): void {
  captured = env
}

/** The env, or `undefined` once the plugin is deactivated. */
export function peekEnv(): Environment | undefined {
  return captured
}

export function getEnv(): Environment {
  if (!captured) throw new Error('[reminder] env accessed before activate()')
  return captured
}

export interface ReminderConfig {
  defaultRemindMinutes: number
  defaultTime: string
  notifyMissed: boolean
  autoComplete: boolean
  autoReopen: boolean
  /** Check/uncheck parents and subtasks together */
  linkSubtasks: boolean
  statusScope: 'reminder' | 'all'
  notificationStyle: 'both' | 'desktop' | 'inapp'
  /** Notebook names whose tasks the task list leaves out */
  excludeNotebooks: string[]
}

export function getConfig(): ReminderConfig {
  const { config } = getEnv()
  return {
    defaultRemindMinutes: config.get('reminder.defaultRemindMinutes') ?? 15,
    defaultTime: config.get('reminder.defaultTime') ?? '09:00',
    notifyMissed: config.get('reminder.notifyMissed') ?? true,
    autoComplete: config.get('reminder.autoComplete') ?? true,
    autoReopen: config.get('reminder.autoReopen') ?? true,
    linkSubtasks: config.get('reminder.linkSubtasks') ?? true,
    statusScope: config.get('reminder.statusScope') ?? 'reminder',
    notificationStyle: config.get('reminder.notificationStyle') ?? 'both',
    excludeNotebooks: String(config.get('reminder.excludeNotebooks') ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
  }
}

/**
 * Saves the editing note after a programmatic editor change. Such edits aren't
 * autosaved, and the editor copies its text into the store with a delay, so
 * wait for the store to catch up before dispatching `core:save-note`.
 */
export async function saveEditingNote(expectedBody: string, timeoutMs = 3000): Promise<void> {
  const env = getEnv()
  const start = Date.now()
  while (env.store.getState().editingNote?.body !== expectedBody && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 50))
  }
  env.commands.dispatch(document.body, 'core:save-note' as any)
}
