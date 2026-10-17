import type { ConfigSchema, Environment, IInkdropPlugin } from '@inkdropapp/types'

import { AlertDialog } from './alert-dialog'
import { pushAlert } from './alerts'
import { DueDialog } from './due-dialog'
import { editorDueButtons } from './editor-buttons'
import { getConfig, getEnv, setEnv } from './env'
import { NoteDueButton } from './note-due-button'
import { showDesktopNotification } from './notify'
import { remarkDue } from './remark-due'
import { ReminderScheduler } from './scheduler'
import { SideBarMenuItemTasks, TasksView, setTasksViewActive, showTasks } from './tasks-view'

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
  config: Record<string, ConfigSchema> = {
    notificationStyle: {
      title: '通知方法',
      type: 'string',
      default: 'both',
      enum: ['both', 'desktop', 'inapp'],
      description:
        'both: デスクトップ通知と Inkdrop 画面中央のモーダル / desktop: デスクトップ通知のみ（失敗時はモーダルで表示） / inapp: モーダルのみ'
    },
    defaultRemindMinutes: {
      title: '既定の通知タイミング（期限の何分前）',
      description: '🔔 を指定していないタスクに使われます',
      type: 'integer',
      default: 15,
      minimum: 0
    },
    defaultTime: {
      title: '時刻なし（終日）の期限の時刻',
      description: 'HH:MM 形式。⏰ に時刻がないタスクはこの時刻を期限として通知します',
      type: 'string',
      default: '09:00'
    },
    notifyMissed: {
      title: '起動時に見逃したリマインダーを通知する',
      description: 'Inkdrop を閉じていた間（直近12時間以内）に通知時刻を過ぎたもの',
      type: 'boolean',
      default: true
    },
    autoComplete: {
      title: 'タスクがすべて完了したらノートを Completed にする',
      type: 'boolean',
      default: true
    },
    autoReopen: {
      title: '完了済みのタスクのチェックを外したらノートを Active に戻す',
      type: 'boolean',
      default: true
    },
    linkSubtasks: {
      title: '親タスクと小タスクのチェックを連動させる',
      description:
        '親をチェックすると未完了の小タスクもチェック、小タスクがすべて完了したら親もチェック、小タスクを外したら親も外します',
      type: 'boolean',
      default: true
    },
    excludeNotebooks: {
      title: 'タスク一覧・カンバンに出さないノートブック',
      description: 'ノートブック名をカンマ区切りで（例: Templates, Archive）。テンプレート用のノートブックなどに',
      type: 'string',
      default: ''
    },
    calendarWeekStartsOn: {
      title: 'カレンダー: 週の始まり',
      type: 'string',
      default: 'sunday',
      enum: ['sunday', 'monday']
    },
    calendarDayStartHour: {
      title: 'カレンダー: 週・日表示で最初に表示する時刻（時）',
      type: 'integer',
      default: 8,
      minimum: 0,
      maximum: 23
    },
    statusScope: {
      title: 'ステータスを自動で変更するノート',
      type: 'string',
      default: 'reminder',
      enum: ['reminder', 'all'],
      description: 'reminder: ⏰ 付きのタスクがあるノートだけ / all: タスクがあるすべてのノート'
    }
  }

  private scheduler: ReminderScheduler | null = null
  private commands: { dispose(): void } | null = null

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
        env.notifications.addError('Reminder: リマインダーの開始に失敗しました', {
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

    this.commands = env.commands.add(document.body, {
      'reminder:test-notification': {
        description: 'Reminder: テスト通知を送る',
        didDispatch: () => this.testNotification(env)
      },
      'reminder:show-status': {
        description: 'Reminder: 登録中のリマインダーを表示',
        didDispatch: () => this.showStatus(env)
      },
      'reminder:show-tasks': {
        description: 'Reminder: タスクの一覧を表示',
        didDispatch: () => {
          if (env.isMainWindow) setTasksViewActive(true)
        }
      },
      'reminder:show-calendar': {
        description: 'Reminder: カレンダーを表示',
        didDispatch: () => {
          if (env.isMainWindow) showTasks('calendar')
        }
      }
    } as any)
  }

  private async testNotification(env: Environment) {
    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    const result = await showDesktopNotification('⏰ Reminder テスト', 'デスクトップ通知は正常に動いています')
    pushAlert({
      id: `test:${Date.now()}`,
      noteId: '',
      noteTitle: 'テスト通知',
      task: { line: 0, checked: false, text: 'Reminder のテスト通知です', doing: false, priority: 0, due: null, parent: null, children: [] },
      at: new Date(),
      test: true
    })
    const detail = `Notification.permission: ${permission} → 結果: ${result}`
    if (result === 'shown') {
      env.notifications.addSuccess('テスト通知を送りました', {
        detail: `${detail}\n画面右上に通知が出ていなければ、macOS の「システム設定 > 通知 > Inkdrop」を確認してください。`,
        dismissable: true
      })
    } else {
      env.notifications.addWarning('デスクトップ通知を出せませんでした', {
        detail: `${detail}\nリマインダーは Inkdrop 内の通知で表示されます。`,
        dismissable: true
      })
    }
  }

  private showStatus(env: Environment) {
    if (!this.scheduler?.started) {
      env.notifications.addWarning('Reminder: スケジューラが動いていません', {
        detail: 'メインウィンドウで実行してください。開発者ツールのコンソールにエラーが出ていないか確認してください。',
        dismissable: true
      })
      return
    }
    const { defaultRemindMinutes } = getConfig()
    const fmt = (d: Date) =>
      d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const list = this.scheduler.upcoming().filter(r => r.at.getTime() > Date.now() - 864e5)
    const lines = list.slice(0, 10).map(r => {
      const min = r.task.due!.reminder.off ? null : (r.task.due!.reminder.minutes ?? defaultRemindMinutes)
      const notifyAt = min === null ? '通知なし' : `通知 ${fmt(new Date(r.at.getTime() - min * 60000))}`
      return `・${r.task.text || r.title}（期限 ${fmt(r.at)} / ${notifyAt}）`
    })
    env.notifications.addInfo(`Reminder: 未完了のリマインダー ${list.length}件`, {
      detail: lines.join('\n') || 'ありません',
      dismissable: true
    })
  }

  deactivate(env: Environment) {
    setTasksViewActive(false)
    for (const layout of MAIN_LAYOUTS) env.layouts.removeComponentFromLayout(layout, 'ReminderTasksView')
    env.components.deleteClass(TasksView, 'ReminderTasksView')
    env.layouts.removeComponentFromLayout('sidebar-menu', 'ReminderSideBarMenuItemTasks')
    env.components.deleteClass(SideBarMenuItemTasks, 'ReminderSideBarMenuItemTasks')
    this.scheduler?.stop()
    this.scheduler = null
    this.commands?.dispose()
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
