import type { ButtonProps, Dialog as DialogType } from '@inkdropapp/types'
import React, { useEffect, useState } from 'react'

import { dismissAlert, dismissAllAlerts, subscribeAlerts, type ReminderAlert } from './alerts'
import { getEnv } from './env'
import { completeAlert, describeWhen, jumpToAlert } from './notify'

function formatAt(at: Date) {
  return at.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Centered modal listing the reminders that just came due. Each one can be
 * opened (jumping to the task line) or marked done right from here.
 */
export const AlertDialog: React.FC = () => {
  const [{ Dialog, Button }] = useState(() => ({
    Dialog: getEnv().components.classes.Dialog as DialogType,
    Button: getEnv().components.getComponentClass<ButtonProps>('Button')!
  }))
  const [alerts, setAlerts] = useState<ReminderAlert[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeAlerts(setAlerts)
    return () => {
      unsubscribe()
    }
  }, [])

  const open = (alert: ReminderAlert) => {
    dismissAllAlerts()
    jumpToAlert(alert).catch(err => console.error('[reminder] jump failed:', err))
  }

  const complete = async (alert: ReminderAlert) => {
    try {
      await completeAlert(alert)
      setError(null)
      dismissAlert(alert.id)
    } catch (err) {
      console.error('[reminder] complete failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog
      visible={alerts.length > 0}
      className="reminder-alert-dialog"
      onEscKeyDown={dismissAllAlerts}
      autofocus
    >
      <Dialog.Content>
        <div className="reminder-alert">
          <div className="reminder-alert-header">
            <span className="bell">⏰</span>
            <span>リマインダー{alerts.length > 1 ? `（${alerts.length}件）` : ''}</span>
          </div>
          <ul className="reminder-alert-list">
            {alerts.map(alert => {
              const overdue = alert.at.getTime() < Date.now() - 60 * 1000
              return (
                <li key={alert.id} className={overdue ? 'overdue' : ''}>
                  <div className="kind">{alert.task ? '☑️ タスク' : '📒 ノート'}</div>
                  <div className="title">{alert.task?.text || alert.noteTitle}</div>
                  {alert.task && <div className="note">📒 {alert.noteTitle}</div>}
                  <div className="when">
                    <span className="badge">{describeWhen(alert.at, alert.isStart)}</span>
                    <span>{formatAt(alert.at)}</span>
                  </div>
                  <div className="buttons">
                    {alert.test ? null : (
                      <>
                        <Button primary onClick={() => open(alert)}>
                          {alert.task ? 'タスクを開く' : 'ノートを開く'}
                        </Button>
                        <Button onClick={() => complete(alert)}>
                          {alert.task ? '✓ 完了にする' : '✓ ノートを完了にする'}
                        </Button>
                      </>
                    )}
                    <Button basic onClick={() => dismissAlert(alert.id)}>
                      閉じる
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {error && <div className="reminder-alert-error">{error}</div>}
        </div>
      </Dialog.Content>
      {alerts.length > 1 && (
        <Dialog.Actions className="reminder-actions">
          <Button onClick={dismissAllAlerts}>すべて閉じる</Button>
        </Dialog.Actions>
      )}
    </Dialog>
  )
}

AlertDialog.displayName = 'ReminderAlertDialog'
