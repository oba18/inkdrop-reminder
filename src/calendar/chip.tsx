import React from 'react'

import { DRAG_TYPE, type ViewContext } from './context'
import { tr } from '../i18n'
import { formatTime, sameDay } from './dates'
import { isAllDayLike, isDone, type CalItem } from './items'
import type { TaskItem as SourceItem } from '../scheduler'

/** Tooltip for a read-only external event. */
export function externalTip(item: CalItem): string {
  const ext = item.external
  return [item.title, ext?.calendar ? `🗓 ${ext.calendar}` : `🗓 ${ext?.source ?? ''}`, ext?.location ? `📍 ${ext.location}` : '']
    .filter(Boolean)
    .join('\n')
}

/**
 * What is being dragged, readable during dragover (dataTransfer isn't): a calendar
 * item, or a task without a due date from the sidebar.
 */
export const dragging: { item: CalItem | null; unscheduled: SourceItem | null } = { item: null, unscheduled: null }

/** One line in a month cell, the all-day row, or a list. */
export const Chip: React.FC<{ item: CalItem; ctx: ViewContext; day?: Date }> = ({ item, ctx, day }) => {
  const done = isDone(item)
  // Task periods are bars across their days.
  const task = item.task
  // Task periods and multi-day / all-day events are bars across their days.
  const bar = isAllDayLike(item) && (task ? !!task.due.start : true)
  const continued = !!day && bar && !sameDay(item.start, day)
  const cls = [
    'calendar-chip',
    task ? 'task' : 'external',
    bar ? 'bar' : 'dot',
    done && 'done',
    continued && 'continued',
    task?.kind === 'note' && 'note-due'
  ]
    .filter(Boolean)
    .join(' ')
  const tip = task
    ? `${item.title}\n📒 ${task.noteTitle}\n${tr('Click to open the note, drag to change the date', 'クリックでノートを開く・ドラッグで日付を変更')}`
    : externalTip(item)
  return (
    <div
      className={cls}
      style={{ '--item-color': item.color } as React.CSSProperties}
      title={tip}
      draggable={!!task}
      onDragStart={e => {
        e.dataTransfer.setData(DRAG_TYPE, item.key)
        e.dataTransfer.effectAllowed = 'move'
        dragging.item = item
      }}
      onDragEnd={() => {
        dragging.item = null
      }}
      onClick={e => {
        e.stopPropagation()
        ctx.open(item)
      }}
    >
      {!task ? (
        !bar && <span className="dot-mark" />
      ) : !bar || !continued ? (
        <input
          type="checkbox"
          checked={done}
          onClick={e => e.stopPropagation()}
          onChange={() => ctx.toggleDone(item)}
          title={done ? tr('Mark as not done', '未完了に戻す') : tr('Mark as done', '完了にする')}
        />
      ) : (
        !bar && <span className="dot-mark" />
      )}
      {!item.allDay && !bar && <span className="time">{formatTime(item.start)}</span>}
      <span className="label">{item.title}</span>
    </div>
  )
}
