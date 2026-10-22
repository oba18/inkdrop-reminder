import type { Environment } from '@inkdropapp/types'

import { tr } from './i18n'

/** Registers the editor context menus and the Plugins menu in the UI language. */
export function addMenus(env: Environment): { dispose(): void } {
  const taskDue = tr('Set Task Due Date & Reminder…', 'タスクの期限とリマインダーを設定…')
  const noteDue = tr('Set Note Due Date & Reminder…', 'ノートの期限とリマインダーを設定…')
  const context = env.contextMenu.add({
    '.cm-editor': [
      { label: taskDue, command: 'reminder:set-due' },
      { label: noteDue, command: 'reminder:set-note-due' }
    ],
    '.editor-header-more .menu': [{ label: noteDue, command: 'reminder:set-note-due' }]
  } as any)
  const menu = env.menu.add([
    {
      label: 'Plugins',
      submenu: [
        {
          label: 'Reminder',
          submenu: [
            { label: taskDue, command: 'reminder:set-due' },
            { label: noteDue, command: 'reminder:set-note-due' },
            { label: tr('Show Tasks', 'タスクの一覧を表示'), command: 'reminder:show-tasks' },
            { type: 'separator' },
            { label: tr('List', 'リスト'), command: 'reminder:show-list' },
            { label: tr('Kanban', 'カンバン'), command: 'reminder:show-kanban' },
            { label: tr('Eisenhower Matrix', 'マトリクス'), command: 'reminder:show-matrix' },
            { label: tr('Note Board', 'ノート'), command: 'reminder:show-note-board' },
            { label: tr('Gantt Chart', 'ガント'), command: 'reminder:show-gantt' },
            { label: tr('Calendar', 'カレンダー'), command: 'reminder:show-calendar' },
            { type: 'separator' },
            { label: tr('Show Scheduled Reminders', '登録中のリマインダーを表示'), command: 'reminder:show-status' },
            { label: tr('Send Test Notification', 'テスト通知を送る'), command: 'reminder:test-notification' }
          ]
        }
      ]
    }
  ] as any)
  return {
    dispose() {
      context.dispose()
      menu.dispose()
    }
  }
}
