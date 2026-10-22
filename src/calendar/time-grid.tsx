import React, { useEffect, useRef, useState } from 'react'

import { Chip, dragging, externalTip } from './chip'
import { DRAG_TYPE, type ViewContext } from './context'
import { tr } from '../i18n'
import { formatTime, sameDay, startOfDay, toDateString, weekdayName } from './dates'
import { getConfig } from './env'
import { isAllDayLike, isDone, layoutDay, type CalItem } from './items'

const HOUR_PX = 48
const MIN_PX = HOUR_PX / 60
const SNAP_MIN = 15
const CLICK_SLOP = 4

/** A timed task being dragged to another time / day */
interface Drag {
  item: CalItem
  day0: number
  x0: number
  y0: number
  dMin: number
  dDay: number
  moved: boolean
}

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN

/** Week (7 days) or day (1 day) view with an all-day row and an hour grid. */
export const TimeGrid: React.FC<{ days: Date[]; ctx: ViewContext }> = ({ days, ctx }) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [overAllDay, setOverAllDay] = useState<string | null>(null)
  /**
   * Where a task without a due date, or an all-day item from the all-day row,
   * would land in the time grid (minutes from midnight). Timed items move by
   * pointer drag instead.
   */
  const [overSlot, setOverSlot] = useState<{ day: string; min: number } | null>(null)

  const slotAt = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(24 * 60 - SNAP_MIN, snap((e.clientY - rect.top) / MIN_PX - SNAP_MIN / 2)))
  }
  dragRef.current = drag

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Start scrolled to the working day (or to now, when it is later).
  const rangeKey = toDateString(days[0])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const showsToday = days.some(d => sameDay(d, new Date()))
    const hour = showsToday ? Math.max(getConfig().dayStartHour, new Date().getHours() - 2) : getConfig().dayStartHour
    el.scrollTop = Math.max(0, hour * HOUR_PX - 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, days.length])

  /* ---- pointer interactions on the hour grid ---- */

  const dayIndexAt = (clientX: number): number => {
    const cols = colsRef.current?.querySelectorAll<HTMLElement>('.calendar-grid-col')
    if (!cols?.length) return 0
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect()
      if (clientX < r.right) return i
    }
    return cols.length - 1
  }

  const onItemPointerDown = (item: CalItem, day: number) => (e: React.PointerEvent) => {
    // External events are read-only.
    if (!item.task || e.button !== 0 || (e.target as Element).closest('input')) return
    e.stopPropagation()
    e.preventDefault()
    colsRef.current?.setPointerCapture(e.pointerId)
    setDrag({ item, day0: day, x0: e.clientX, y0: e.clientY, dMin: 0, dDay: 0, moved: false })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < CLICK_SLOP) return
    const dMin = snap((e.clientY - d.y0) / MIN_PX)
    const dDay = dayIndexAt(e.clientX) - d.day0
    if (!d.moved || dMin !== d.dMin || dDay !== d.dDay) setDrag({ ...d, moved: true, dMin, dDay })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    setDrag(null)
    if (colsRef.current?.hasPointerCapture(e.pointerId)) colsRef.current.releasePointerCapture(e.pointerId)
    if (!d) return
    if (!d.moved) {
      ctx.open(d.item)
      return
    }
    const { start } = preview(d)
    if (start.getTime() !== d.item.start.getTime()) ctx.move(d.item, start, false)
  }

  /** Where a dragged item would land. */
  const preview = (d: Drag) => {
    const shift = (d.dMin + d.dDay * 24 * 60) * 60_000
    return { start: new Date(d.item.start.getTime() + shift), end: new Date(d.item.end.getTime() + shift) }
  }

  /* ---- all-day row drops ---- */

  const dropAllDay = (day: Date) => (e: React.DragEvent) => {
    e.preventDefault()
    setOverAllDay(null)
    const item = dragging.item
    const task = dragging.unscheduled
    dragging.item = dragging.unscheduled = null
    if (task) return ctx.schedule(task, startOfDay(day), true)
    if (!item || e.dataTransfer.getData(DRAG_TYPE) !== item.key) return
    if (item.allDay && sameDay(item.start, day)) return
    ctx.move(item, startOfDay(day), true)
  }

  const timedOn = (day: Date) => ctx.itemsOn(day).filter(i => !isAllDayLike(i))
  const allDayOn = (day: Date) => ctx.itemsOn(day).filter(isAllDayLike)
  const draggingKey = drag?.moved ? drag.item.key : null

  return (
    <div className={`calendar-timegrid days-${days.length}`}>
      <div className="calendar-timegrid-head">
        <div className="gutter" />
        {days.map(day => (
          <div
            key={toDateString(day)}
            className={`calendar-timegrid-dayhead${sameDay(day, ctx.today) ? ' today' : ''}${day.getDay() === 0 ? ' sun' : day.getDay() === 6 ? ' sat' : ''}`}
          >
            <span className="weekday">{weekdayName(day.getDay())}</span>
            <button type="button" className="date-number" onClick={() => ctx.showDay(day)} title={tr('Show this day', 'この日を表示')}>
              {day.getDate()}
            </button>
          </div>
        ))}
      </div>

      <div className="calendar-timegrid-allday">
        <div className="gutter">{tr('All day', '終日')}</div>
        {days.map(day => {
          const ds = toDateString(day)
          return (
            <div
              key={ds}
              className={`calendar-allday-cell${overAllDay === ds ? ' drag-over' : ''}`}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                if (overAllDay !== ds) setOverAllDay(ds)
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverAllDay(null)
              }}
              onDrop={dropAllDay(day)}
            >
              {allDayOn(day).map(item => (
                <Chip key={item.key} item={item} ctx={ctx} day={day} />
              ))}
            </div>
          )
        })}
      </div>

      <div ref={scrollRef} className="calendar-timegrid-scroll">
        <div className="calendar-timegrid-body" style={{ height: 24 * HOUR_PX }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>
          <div
            ref={colsRef}
            className="calendar-grid-cols"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {days.map((day, di) => {
              const placed = layoutDay(timedOn(day), day)
              const isToday = sameDay(day, now)
              return (
                <div
                  key={toDateString(day)}
                  className={`calendar-grid-col${isToday ? ' today' : ''}`}
                  onDragOver={e => {
                    if (!dragging.unscheduled && !dragging.item?.task) return
                    e.preventDefault()
                    const slot = { day: toDateString(day), min: slotAt(e) }
                    if (overSlot?.day !== slot.day || overSlot.min !== slot.min) setOverSlot(slot)
                  }}
                  onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSlot(null)
                  }}
                  onDrop={e => {
                    const task = dragging.unscheduled
                    const item = dragging.item
                    dragging.unscheduled = dragging.item = null
                    setOverSlot(null)
                    if (!task && !item?.task) return
                    e.preventDefault()
                    const min = slotAt(e)
                    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(min / 60), min % 60)
                    // An all-day item gets this time (a period keeps its own times and moves by days).
                    if (task) ctx.schedule(task, at, false)
                    else ctx.move(item!, at, false)
                  }}
                >
                  {overSlot?.day === toDateString(day) && (
                    <div
                      className="calendar-block preview task"
                      style={{ top: overSlot.min * MIN_PX, height: 30 * MIN_PX - 2, left: 1, right: 4, '--item-color': 'var(--calendar-task-color)' } as React.CSSProperties}
                    >
                      <span className="label">{dragging.unscheduled?.task.text ?? dragging.item?.title}</span>
                      <span className="time">{`${Math.floor(overSlot.min / 60)}:${String(overSlot.min % 60).padStart(2, '0')}`}</span>
                    </div>
                  )}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="hour-line" style={{ top: h * HOUR_PX }} />
                  ))}
                  {placed.map(p => (
                    <TimedBlock
                      key={p.item.key}
                      item={p.item}
                      style={{
                        top: p.top * MIN_PX,
                        height: Math.max(18, (p.bottom - p.top) * MIN_PX - 2),
                        left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                        width: `calc(${100 / p.cols}% - ${p.cols > 1 ? 3 : 6}px)`
                      }}
                      ghosted={draggingKey === p.item.key}
                      ctx={ctx}
                      onMoveStart={onItemPointerDown(p.item, di)}
                    />
                  ))}
                  {/* Preview of the item being dragged, in the column it's over. */}
                  {drag?.moved && (() => {
                    const { start, end } = preview(drag)
                    if (!sameDay(start, day)) return null
                    const top = (start.getTime() - startOfDay(day).getTime()) / 60_000
                    const bottom = Math.min(24 * 60, (end.getTime() - startOfDay(day).getTime()) / 60_000)
                    return (
                      <div
                        className="calendar-block preview task"
                        style={{ top: top * MIN_PX, height: Math.max(18, (bottom - top) * MIN_PX - 2), left: 1, right: 4, '--item-color': drag.item.color } as React.CSSProperties}
                      >
                        <span className="label">{drag.item.title}</span>
                        <span className="time">
                          {formatTime(start)} – {formatTime(end)}
                        </span>
                      </div>
                    )
                  })()}
                  {isToday && (
                    <div className="now-line" style={{ top: ((now.getTime() - startOfDay(now).getTime()) / 60_000) * MIN_PX }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const TimedBlock: React.FC<{
  item: CalItem
  style: React.CSSProperties
  ghosted: boolean
  ctx: ViewContext
  onMoveStart: (e: React.PointerEvent) => void
}> = ({ item, style, ghosted, ctx, onMoveStart }) => {
  const short = item.end.getTime() - item.start.getTime() <= 30 * 60_000
  const cls = ['calendar-block', item.task ? 'task' : 'external', isDone(item) && 'done', ghosted && 'ghosted', short && 'short']
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      style={{ ...style, '--item-color': item.color } as React.CSSProperties}
      title={item.task ? `${item.title}\n📒 ${item.task.noteTitle}` : externalTip(item)}
      onPointerDown={onMoveStart}
    >
      <div className="content">
        {item.task && (
          <input type="checkbox" checked={isDone(item)} onChange={() => ctx.toggleDone(item)} onPointerDown={e => e.stopPropagation()} />
        )}
        <span className="label">{item.title}</span>
        <span className="time">{formatTime(item.start)}</span>
      </div>
    </div>
  )
}
