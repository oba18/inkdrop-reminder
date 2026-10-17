import React from 'react'

import { DRAG_TYPE, type ViewContext } from './context'
import { formatTime, sameDay } from './dates'
import { isAllDayLike, isDone, type CalItem } from './items'

/** Keys of the item being dragged, readable during dragover (dataTransfer isn't). */
export const dragging: { item: CalItem | null } = { item: null }

/** One line in a month cell, the all-day row, or a list. */
export const Chip: React.FC<{ item: CalItem; ctx: ViewContext; day?: Date }> = ({ item, ctx, day }) => {
  const done = isDone(item)
  // Task periods are bars across their days.
  const bar = isAllDayLike(item) && !!item.task.due.start
  const continued = !!day && bar && !sameDay(item.start, day)
  const cls = [
    'calendar-chip',
    'task',
    bar ? 'bar' : 'dot',
    done && 'done',
    continued && 'continued',
    item.task.kind === 'note' && 'note-due'
  ]
    .filter(Boolean)
    .join(' ')
  const tip = `${item.title}\n📒 ${item.task.noteTitle}\nクリックでノートを開く・ドラッグで日付を変更`
  return (
    <div
      className={cls}
      style={{ '--item-color': item.color } as React.CSSProperties}
      title={tip}
      draggable
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
      {!bar || !continued ? (
        <input
          type="checkbox"
          checked={done}
          onClick={e => e.stopPropagation()}
          onChange={() => ctx.toggleDone(item)}
          title={done ? '未完了に戻す' : '完了にする'}
        />
      ) : (
        !bar && <span className="dot-mark" />
      )}
      {!item.allDay && !bar && <span className="time">{formatTime(item.start)}</span>}
      <span className="label">{item.title}</span>
    </div>
  )
}
