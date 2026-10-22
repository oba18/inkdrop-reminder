import type { ConfigSchema, Environment, IInkdropPlugin } from '@inkdropapp/types'

import { AlertDialog } from './alert-dialog'
import { pushAlert } from './alerts'
import { DueDialog } from './due-dialog'
import { editorDueButtons } from './editor-buttons'
import { clearCalendarSources, registerCalendarSource } from './calendar/external'
import { getConfig, getEnv, setEnv } from './env'
import { languageConfig, locale, tr } from './i18n'
import { addMenus } from './menus'
import { NoteDueButton } from './note-due-button'
import { showDesktopNotification } from './notify'
import { remarkDue } from './remark-due'
import { ReminderScheduler } from './scheduler'
import { SideBarMenuItemTasks, TasksView, returnToTasksOnBack, setTasksViewActive, showTasks } from './tasks-view'

/** Due badges and ⏰+ buttons in the preview open the picker for their task / the note. */
function onPreviewClick(e: MouseEvent) {
  const el = (e.target as Element).closest?.('.mde-preview [data-reminder-line], .mde-preview [data-reminder-note]')
  if (!el) return
  e.preventDefault()
  e.stopPropagation()
  const line = Number(el.getAttribute('data-reminder-line'))
  const { commands } = getEnv()
  if (line) commands.dispatch(document.body, 'reminder:set-task-due' as any, { line })
  else commands.dispatch(document.body, 'reminder:set-note-due' as any)
}

/** Main layouts that hold the note list, where the task list takes its place. */
const MAIN_LAYOUTS = ['main:full', 'main:slim']

class ReminderPlugin implements IInkdropPlugin {
  /**
   * For other plugins: shows read-only events from another calendar next to the
   * tasks in the Tasks view's calendar. See `CalendarSource` in calendar/external.ts.
   */
  registerCalendarSource = registerCalendarSource

  config: Record<string, ConfigSchema> = {
    notificationStyle: {
      title: tr('Notification style', '通知方法'),
      type: 'string',
      default: 'both',
      enum: ['both', 'desktop', 'inapp'],
      description: tr(
        'both: desktop notification and a modal in Inkdrop / desktop: desktop notification only (falls back to the modal if it fails) / inapp: modal only',
        'both: デスクトップ通知と Inkdrop 画面中央のモーダル / desktop: デスクトップ通知のみ（失敗時はモーダルで表示） / inapp: モーダルのみ'
      )
    },
    defaultRemindMinutes: {
      title: tr('Default reminder (minutes before the due time)', '既定の通知タイミング（期限の何分前）'),
      description: tr('Used for tasks without a 🔔', '🔔 を指定していないタスクに使われます'),
      type: 'integer',
      default: 15,
      minimum: 0
    },
    defaultTime: {
      title: tr('Time for all-day due dates', '時刻なし（終日）の期限の時刻'),
      description: tr(
        'HH:MM. Tasks whose ⏰ has no time are due (and notified) at this time',
        'HH:MM 形式。⏰ に時刻がないタスクはこの時刻を期限として通知します'
      ),
      type: 'string',
      default: '09:00'
    },
    notifyMissed: {
      title: tr('Notify missed reminders on startup', '起動時に見逃したリマインダーを通知する'),
      description: tr(
        'Reminders that came due while Inkdrop was closed (within the last 12 hours)',
        'Inkdrop を閉じていた間（直近12時間以内）に通知時刻を過ぎたもの'
      ),
      type: 'boolean',
      default: true
    },
    autoComplete: {
      title: tr('Mark the note Completed when all its tasks are done', 'タスクがすべて完了したらノートを Completed にする'),
      type: 'boolean',
      default: true
    },
    autoReopen: {
      title: tr('Set the note back to Active when a task is unchecked', '完了済みのタスクのチェックを外したらノートを Active に戻す'),
      type: 'boolean',
      default: true
    },
    linkSubtasks: {
      title: tr('Link parent and subtask checkboxes', '親タスクと小タスクのチェックを連動させる'),
      description: tr(
        'Checking a parent checks its open subtasks; when all subtasks are done the parent is checked; unchecking a subtask unchecks the parent',
        '親をチェックすると未完了の小タスクもチェック、小タスクがすべて完了したら親もチェック、小タスクを外したら親も外します'
      ),
      type: 'boolean',
      default: true
    },
    excludeNotebooks: {
      title: tr('Notebooks to exclude from the task views', 'タスク一覧・カンバンに出さないノートブック'),
      description: tr(
        'Comma-separated notebook names (e.g. Templates, Archive), such as notebooks for templates',
        'ノートブック名をカンマ区切りで（例: Templates, Archive）。テンプレート用のノートブックなどに'
      ),
      type: 'string',
      default: ''
    },
    matrixImportantPriority: {
      title: tr('Matrix: ⭐ count that makes a task important (or more)', 'マトリクス: 「重要」とみなす ⭐ の数（以上）'),
      type: 'integer',
      default: 2,
      minimum: 1,
      maximum: 3
    },
    matrixUrgentDays: {
      title: tr('Matrix: due within this many days counts as urgent', 'マトリクス: 「緊急」とみなす期限（今日から何日以内）'),
      description: tr('Overdue tasks are urgent too. 0 means today only', '期限切れのタスクも緊急です。0 で今日まで'),
      type: 'integer',
      default: 2,
      minimum: 0
    },
    calendarWeekStartsOn: {
      title: tr('Calendar: week starts on', 'カレンダー: 週の始まり'),
      type: 'string',
      default: 'sunday',
      enum: ['sunday', 'monday']
    },
    calendarDayStartHour: {
      title: tr('Calendar: first hour shown in week / day views', 'カレンダー: 週・日表示で最初に表示する時刻（時）'),
      type: 'integer',
      default: 8,
      minimum: 0,
      maximum: 23
    },
    statusScope: {
      title: tr('Notes whose status is changed automatically', 'ステータスを自動で変更するノート'),
      type: 'string',
      default: 'reminder',
      enum: ['reminder', 'all'],
      description: tr(
        'reminder: only notes with ⏰ tasks / all: every note with tasks',
        'reminder: ⏰ 付きのタスクがあるノートだけ / all: タスクがあるすべてのノート'
      )
    },
    language: languageConfig
  }

  private scheduler: ReminderScheduler | null = null
  private commands: { dispose(): void } | null = null
  private stopBackToTasks: (() => void) | null = null
  private menus: { dispose(): void } | null = null
  private languageWatch: { dispose(): void } | null = null

  activate(env: Environment) {
    setEnv(env)
    env.components.registerClass(DueDialog, 'ReminderDueDialog')
    env.layouts.addComponentToLayout('modal', 'ReminderDueDialog')
    env.components.registerClass(AlertDialog, 'ReminderAlertDialog')
    env.layouts.addComponentToLayout('modal', 'ReminderAlertDialog')
    env.components.registerClass(NoteDueButton, 'ReminderNoteDueButton')
    env.layouts.insertComponentToLayoutBefore('editor-header', 'EditorHeaderMore', 'ReminderNoteDueButton')
    env.markdownRenderer.remarkPlugins.push(remarkDue)
    env.commands.dispatch(document.body, 'editor:add-extension', { extension: editorDueButtons })
    document.addEventListener('click', onPreviewClick, true)

    // Only the main window schedules, so a note opened in a separate window
    // doesn't produce duplicate notifications.
    if (env.isMainWindow) {
      this.scheduler = new ReminderScheduler()
      this.scheduler.start().catch(err => {
        console.error('[reminder] failed to start:', err)
        env.notifications.addError(tr('Reminder: Failed to start reminders', 'Reminder: リマインダーの開始に失敗しました'), {
          detail: err instanceof Error ? err.message : String(err),
          dismissable: true
        })
      })

      // The task list reads the scheduler's index, so it lives in the main window too.
      env.components.registerClass(SideBarMenuItemTasks, 'ReminderSideBarMenuItemTasks')
      env.layouts.insertComponentToLayoutAfter('sidebar-menu', 'SideBarMenuItemTemplates', 'ReminderSideBarMenuItemTasks')
      env.components.registerClass(TasksView, 'ReminderTasksView')
      for (const layout of MAIN_LAYOUTS) {
        env.layouts.insertComponentToLayoutBefore(layout, 'NoteListBarLayout', 'ReminderTasksView')
      }
    }

    if (env.isMainWindow) this.stopBackToTasks = returnToTasksOnBack()
    this.commands = env.commands.add(document.body, {
      'reminder:test-notification': {
        description: tr('Reminder: Send a test notification', 'Reminder: テスト通知を送る'),
        didDispatch: () => this.testNotification(env)
      },
      'reminder:show-status': {
        description: tr('Reminder: Show scheduled reminders', 'Reminder: 登録中のリマインダーを表示'),
        didDispatch: () => this.showStatus(env)
      },
      'reminder:show-tasks': {
        description: tr('Reminder: Show tasks', 'Reminder: タスクの一覧を表示'),
        didDispatch: () => {
          if (env.isMainWindow) setTasksViewActive(true)
        }
      },
      'reminder:show-calendar': {
        description: tr('Reminder: Show calendar', 'Reminder: カレンダーを表示'),
        didDispatch: () => {
          if (env.isMainWindow) showTasks('calendar')
        }
      },
      'reminder:show-matrix': {
        description: tr('Reminder: Show Eisenhower matrix', 'Reminder: アイゼンハワーマトリクスを表示'),
        didDispatch: () => {
          if (env.isMainWindow) showTasks('matrix')
        }
      }
    } as any)
    this.menus = addMenus(env)
    this.languageWatch = env.config.onDidChange('reminder.language', () => {
      this.menus?.dispose()
      this.menus = addMenus(env)
    })
  }

  private async testNotification(env: Environment) {
    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    const result = await showDesktopNotification(
      tr('⏰ Reminder test', '⏰ Reminder テスト'),
      tr('Desktop notifications are working', 'デスクトップ通知は正常に動いています')
    )
    pushAlert({
      id: `test:${Date.now()}`,
      noteId: '',
      noteTitle: tr('Test notification', 'テスト通知'),
      task: { line: 0, checked: false, text: tr('This is a Reminder test notification', 'Reminder のテスト通知です'), doing: false, priority: 0, due: null, parent: null, children: [] },
      at: new Date(),
      test: true
    })
    const detail = `Notification.permission: ${permission} → ${tr('result', '結果')}: ${result}`
    if (result === 'shown') {
      env.notifications.addSuccess(tr('Test notification sent', 'テスト通知を送りました'), {
        detail: `${detail}\n${tr(
          "If no notification appeared at the top right of the screen, check macOS System Settings > Notifications > Inkdrop.",
          '画面右上に通知が出ていなければ、macOS の「システム設定 > 通知 > Inkdrop」を確認してください。'
        )}`,
        dismissable: true
      })
    } else {
      env.notifications.addWarning(tr('Could not show a desktop notification', 'デスクトップ通知を出せませんでした'), {
        detail: `${detail}\n${tr('Reminders will be shown inside Inkdrop.', 'リマインダーは Inkdrop 内の通知で表示されます。')}`,
        dismissable: true
      })
    }
  }

  private showStatus(env: Environment) {
    if (!this.scheduler?.started) {
      env.notifications.addWarning(tr('Reminder: The scheduler is not running', 'Reminder: スケジューラが動いていません'), {
        detail: tr(
          'Run this in the main window, and check the developer tools console for errors.',
          'メインウィンドウで実行してください。開発者ツールのコンソールにエラーが出ていないか確認してください。'
        ),
        dismissable: true
      })
      return
    }
    const { defaultRemindMinutes } = getConfig()
    const fmt = (d: Date) =>
      d.toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const list = this.scheduler.upcoming().filter(r => r.at.getTime() > Date.now() - 864e5)
    const lines = list.slice(0, 10).map(r => {
      const min = r.task.due!.reminder.off ? null : (r.task.due!.reminder.minutes ?? defaultRemindMinutes)
      let notifyAt = tr('no reminder', '通知なし')
      if (min !== null) {
        const at = fmt(new Date(r.at.getTime() - min * 60000))
        notifyAt = tr(`remind ${at}`, `通知 ${at}`)
      }
      const text = r.task.text || r.title
      return tr(`• ${text} (due ${fmt(r.at)} / ${notifyAt})`, `・${text}（期限 ${fmt(r.at)} / ${notifyAt}）`)
    })
    env.notifications.addInfo(tr(`Reminder: ${list.length} open reminders`, `Reminder: 未完了のリマインダー ${list.length}件`), {
      detail: lines.join('\n') || tr('None', 'ありません'),
      dismissable: true
    })
  }

  deactivate(env: Environment) {
    clearCalendarSources()
    setTasksViewActive(false)
    this.stopBackToTasks?.()
    this.stopBackToTasks = null
    for (const layout of MAIN_LAYOUTS) env.layouts.removeComponentFromLayout(layout, 'ReminderTasksView')
    env.components.deleteClass(TasksView, 'ReminderTasksView')
    env.layouts.removeComponentFromLayout('sidebar-menu', 'ReminderSideBarMenuItemTasks')
    env.components.deleteClass(SideBarMenuItemTasks, 'ReminderSideBarMenuItemTasks')
    this.scheduler?.stop()
    this.scheduler = null
    this.commands?.dispose()
    this.menus?.dispose()
    this.menus = null
    this.languageWatch?.dispose()
    this.languageWatch = null
    document.removeEventListener('click', onPreviewClick, true)
    env.commands.dispatch(document.body, 'editor:remove-extension', { extension: editorDueButtons })
    this.commands = null
    const i = env.markdownRenderer.remarkPlugins.indexOf(remarkDue)
    if (i >= 0) env.markdownRenderer.remarkPlugins.splice(i, 1)
    env.layouts.removeComponentFromLayout('editor-header', 'ReminderNoteDueButton')
    env.components.deleteClass(NoteDueButton, 'ReminderNoteDueButton')
    env.layouts.removeComponentFromLayout('modal', 'ReminderAlertDialog')
    env.components.deleteClass(AlertDialog, 'ReminderAlertDialog')
    env.layouts.removeComponentFromLayout('modal', 'ReminderDueDialog')
    env.components.deleteClass(DueDialog, 'ReminderDueDialog')
    setEnv(undefined)
  }
}

export default new ReminderPlugin()
