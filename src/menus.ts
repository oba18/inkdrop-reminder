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
            { label: tr('Show Calendar', 'カレンダーを表示'), command: 'reminder:show-calendar' },
            { label: tr('Show Eisenhower Matrix', 'アイゼンハワーマトリクスを表示'), command: 'reminder:show-matrix' },
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
