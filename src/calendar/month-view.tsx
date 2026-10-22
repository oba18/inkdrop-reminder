import React, { useEffect, useRef, useState } from 'react'

import { Chip, dragging } from './chip'
import { DRAG_TYPE, type ViewContext } from './context'
import { locale, tr } from '../i18n'
import { monthGrid, sameDay, toDateString, weekdayLabels } from './dates'

const CHIP_HEIGHT = 22
const CELL_HEADER = 26

/** How many chips fit in a cell, from the grid's height. */
function useChipsPerCell(ref: React.RefObject<HTMLDivElement | null>, rows: number): number {
  const [n, setN] = useState(3)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const cell = el.clientHeight / rows
      setN(Math.max(1, Math.floor((cell - CELL_HEADER - 4) / CHIP_HEIGHT)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, rows])
  return n
}

export const MonthView: React.FC<{ month: Date; ctx: ViewContext }> = ({ month, ctx }) => {
  const days = monthGrid(month, ctx.weekStartsOn)
  // Five rows when the month fits, like Google Calendar.
  const rows = days[35].getMonth() !== month.getMonth() ? 5 : 6
  const shown = days.slice(0, rows * 7)
  const gridRef = useRef<HTMLDivElement>(null)
  const perCell = useChipsPerCell(gridRef, rows)
  const [over, setOver] = useState<string | null>(null)

  const drop = (day: Date) => (e: React.DragEvent) => {
    e.preventDefault()
    setOver(null)
    const item = dragging.item
    const task = dragging.unscheduled
    dragging.item = dragging.unscheduled = null
    if (task) return ctx.schedule(task, day, true)
    if (!item || e.dataTransfer.getData(DRAG_TYPE) !== item.key) return
    if (sameDay(item.start, day)) return
    // Keep the time of day; only the date changes.
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), item.start.getHours(), item.start.getMinutes())
    ctx.move(item, start, item.allDay)
  }

  return (
    <div className="calendar-month">
      <div className="calendar-month-weekdays">
        {weekdayLabels(ctx.weekStartsOn).map((w, i) => (
          <div key={i} className={`weekday ${{ 0: 'sun', 6: 'sat' }[(i + ctx.weekStartsOn) % 7] ?? ''}`}>
            {w}
          </div>
        ))}
      </div>
      <div ref={gridRef} className="calendar-month-grid" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {shown.map(day => {
          const ds = toDateString(day)
          const items = ctx.itemsOn(day)
          // Leave room for the "+N" line when it overflows.
          const fit = items.length > perCell ? Math.max(0, perCell - 1) : perCell
          const cls = [
            'calendar-month-cell',
            day.getMonth() !== month.getMonth() && 'outside',
            sameDay(day, ctx.today) && 'today',
            day.getDay() === 0 && 'sun',
            day.getDay() === 6 && 'sat',
            over === ds && 'drag-over'
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={ds}
              className={cls}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== ds) setOver(ds)
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
              }}
              onDrop={drop(day)}
            >
              <div className="calendar-month-date">
                <button
                  type="button"
                  className="date-number"
                  title={tr('Show this day', 'この日を表示')}
                  onClick={e => {
                    e.stopPropagation()
                    ctx.showDay(day)
                  }}
                >
                  {day.getDate() === 1 ? day.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) : day.getDate()}
                </button>
              </div>
              <div className="calendar-month-items">
                {items.slice(0, fit).map(item => (
                  <Chip key={item.key} item={item} ctx={ctx} day={day} />
                ))}
                {items.length > fit && (
                  <button
                    type="button"
                    className="more"
                    onClick={e => {
                      e.stopPropagation()
                      ctx.showDay(day)
                    }}
                  >
                    {tr(`${items.length - fit} more`, `他 ${items.length - fit} 件`)}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
