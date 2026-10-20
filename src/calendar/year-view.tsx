import React from 'react'

import type { ViewContext } from './context'
import { locale, tr } from '../i18n'
import { monthGrid, sameDay, toDateString, weekdayLabels } from './dates'
import { isDone } from './items'

/** Twelve small months; days with tasks or events are shaded by how many. */
export const YearView: React.FC<{ year: number; ctx: ViewContext; onShowMonth: (m: Date) => void }> = ({
  year,
  ctx,
  onShowMonth
}) => (
  <div className="calendar-year">
    {Array.from({ length: 12 }, (_, m) => {
      const month = new Date(year, m, 1)
      return (
        <div key={m} className="calendar-year-month">
          <button type="button" className="month-title" onClick={() => onShowMonth(month)}>
            {month.toLocaleDateString(locale(), { month: 'long' })}
          </button>
          <div className="calendar-mini-grid">
            {weekdayLabels(ctx.weekStartsOn, 'narrow').map((w, i) => (
              <span key={i} className="weekday">
                {w}
              </span>
            ))}
            {monthGrid(month, ctx.weekStartsOn).map(day => {
              const inMonth = day.getMonth() === m
              const items = inMonth ? ctx.itemsOn(day) : []
              const open = items.filter(i => !isDone(i)).length
              const level = open === 0 ? (items.length ? 'done' : '') : open === 1 ? 'l1' : open <= 3 ? 'l2' : 'l3'
              const cls = ['day', !inMonth && 'outside', sameDay(day, ctx.today) && 'today', level].filter(Boolean).join(' ')
              return (
                <button
                  key={toDateString(day)}
                  type="button"
                  className={cls}
                  disabled={!inMonth}
                  title={
                    inMonth && items.length
                      ? `${tr(`${items.length} item${items.length === 1 ? '' : 's'}`, `${items.length} 件`)}\n${items
                          .slice(0, 8)
                          .map(i => `${tr('•', '・')} ${i.title}`)
                          .join('\n')}`
                      : undefined
                  }
                  onClick={() => ctx.showDay(day)}
                >
                  {inMonth ? day.getDate() : ''}
                </button>
              )
            })}
          </div>
        </div>
      )
    })}
  </div>
)
