import React, { useCallback, useEffect, useMemo, useState } from 'react'

import type { ViewContext } from './context'
import { lang, locale, tr } from '../i18n'
import {
  DAY_MS,
  addDays,
  addMonths,
  monthGrid,
  parseLocal,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateString,
  toTimeString,
  monthTitle,
  weekdayLabels
} from './dates'
import type { TaskItem as SourceItem } from '../scheduler'
import { errorMessage, getConfig, getEnv, type ViewKind } from './env'
import { isSourceShown, useCalendarSources, type CalendarSource } from './external'
import { compareItems, externalToItem, taskToItem, type CalItem } from './items'
import { MonthView } from './month-view'
import { calendarTasks, openTask, rescheduleTask, setTaskDone, type DayTime, type Due } from './tasks'
import { TimeGrid } from './time-grid'
import { YearView } from './year-view'

/* ---- remembered UI state ---- */

const UI_KEY = 'inkdrop-reminder:calendar:ui'

interface UiState {
  view: ViewKind
  sidebar: boolean
  showTasks: boolean
  showDone: boolean
  /** Ids of external calendar sources turned off in the sidebar */
  hiddenSources: string[]
}

function loadUi(): UiState {
  const base: UiState = { view: 'month', sidebar: true, showTasks: true, showDone: false, hiddenSources: [] }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }
  } catch {
    return base
  }
}

function saveUi(s: UiState) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(s))
  } catch {
    // Not remembered.
  }
}

/* ---- the calendar ---- */

function rangeOf(view: ViewKind, date: Date, weekStartsOn: 0 | 1): { from: Date; to: Date } {
  switch (view) {
    case 'year':
      return { from: new Date(date.getFullYear(), 0, 1), to: new Date(date.getFullYear() + 1, 0, 1) }
    case 'month': {
      const grid = monthGrid(date, weekStartsOn)
      return { from: grid[0], to: addDays(grid[41], 1) }
    }
    case 'week': {
      const from = startOfWeek(date, weekStartsOn)
      return { from, to: addDays(from, 7) }
    }
    default:
      return { from: startOfDay(date), to: addDays(startOfDay(date), 1) }
  }
}

function step(view: ViewKind, date: Date, dir: 1 | -1): Date {
  switch (view) {
    case 'year':
      return new Date(date.getFullYear() + dir, date.getMonth(), 1)
    case 'month':
      return addMonths(startOfMonth(date), dir)
    case 'week':
      return addDays(date, 7 * dir)
    default:
      return addDays(date, dir)
  }
}

function title(view: ViewKind, date: Date, weekStartsOn: 0 | 1): string {
  const y = date.getFullYear()
  switch (view) {
    case 'year':
      return tr(String(y), `${y}年`)
    case 'month':
      return monthTitle(date)
    case 'week': {
      const a = startOfWeek(date, weekStartsOn)
      const b = addDays(a, 6)
      if (a.getMonth() === b.getMonth()) return monthTitle(a)
      const month = (d: Date) => d.toLocaleDateString(locale(), { month: lang() === 'ja' ? 'numeric' : 'short' })
      if (a.getFullYear() === b.getFullYear())
        return tr(`${month(a)} – ${month(b)} ${y}`, `${a.getFullYear()}年${month(a)} – ${month(b)}`)
      return `${monthTitle(a)} – ${monthTitle(b)}`
    }
    default:
      return date.toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  }
}

const VIEWS: Array<{ value: ViewKind; label: string; key: string }> = [
  { value: 'day', get label() { return tr('Day', '日') }, key: 'D' },
  { value: 'week', get label() { return tr('Week', '週') }, key: 'W' },
  { value: 'month', get label() { return tr('Month', '月') }, key: 'M' },
  { value: 'year', get label() { return tr('Year', '年') }, key: 'Y' }
]

/** The Tasks view's calendar tab: tasks with a due date, as filtered by the Tasks view. */
export const CalendarPanel: React.FC<{ items: SourceItem[]; leave: (noteId: string) => void }> = ({ items, leave }) => {
  const env = getEnv()
  const cfg = getConfig()
  const { weekStartsOn } = cfg
  const [ui, setUiState] = useState<UiState>(loadUi)
  const [date, setDate] = useState(() => startOfDay(new Date()))
  const [today, setToday] = useState(() => startOfDay(new Date()))
  const tasks = useMemo(() => calendarTasks(items), [items])
  const sources = useCalendarSources()

  const setUi = (patch: Partial<UiState>) =>
    setUiState(s => {
      const next = { ...s, ...patch }
      saveUi(next)
      return next
    })

  const range = useMemo(() => rangeOf(ui.view, date, weekStartsOn), [ui.view, date, weekStartsOn])

  // Midnight rollover.
  useEffect(() => {
    const timer = setInterval(() => {
      const t = startOfDay(new Date())
      setToday(prev => (prev.getTime() === t.getTime() ? prev : t))
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  // Google Calendar-style keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
      const k = e.key.toLowerCase()
      const views: Record<string, ViewKind> = { d: 'day', w: 'week', m: 'month', y: 'year' }
      if (views[k]) setUi({ view: views[k] })
      else if (k === 't') setDate(startOfDay(new Date()))
      else if (k === 'j' || k === 'n' || e.key === 'ArrowRight') setDate(d => step(ui.view, d, 1))
      else if (k === 'k' || k === 'p' || e.key === 'ArrowLeft') setDate(d => step(ui.view, d, -1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ui.view])

  /* ---- items on screen, by day ---- */

  const byDay = useMemo(() => {
    const items: CalItem[] = []
    if (ui.showTasks) for (const t of tasks) if (ui.showDone || !t.checked) items.push(taskToItem(t))
    for (const source of sources) {
      if (!isSourceShown(source, ui.hiddenSources)) continue
      for (const ev of source.getEvents()) {
        const item = externalToItem(ev, source)
        if (item) items.push(item)
      }
    }
    const map = new Map<string, CalItem[]>()
    const from = range.from.getTime()
    const to = range.to.getTime()
    for (const item of items) {
      if (item.end.getTime() <= from || item.start.getTime() >= to) continue
      // Every day the item covers (end is exclusive), clipped to the range.
      const first = Math.max(item.start.getTime(), from)
      const last = Math.max(first, Math.min(item.end.getTime() - 1, to - 1))
      for (let d = startOfDay(new Date(first)); d.getTime() <= last; d = addDays(d, 1)) {
        const key = toDateString(d)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(item)
      }
    }
    for (const list of map.values()) list.sort(compareItems)
    return map
  }, [tasks, sources, ui.showTasks, ui.showDone, ui.hiddenSources, range.from.getTime(), range.to.getTime()])

  /* ---- actions ---- */

  const report = (what: string) => (err: unknown) => {
    console.error(`[reminder] calendar: ${what}:`, err)
    env.notifications.addError(what, { detail: errorMessage(err), dismissable: true })
  }

  const move = useCallback((item: CalItem, start: Date, allDay: boolean) => {
    if (!item.task) return
    const due = item.task.due
    let next: Due
    if (due.start) {
      // A period moves as a whole, by days, keeping its times.
      const shift = Math.round((startOfDay(start).getTime() - startOfDay(item.start).getTime()) / DAY_MS)
      const by = (d: DayTime): DayTime => ({ date: toDateString(addDays(parseLocal(d.date), shift)), time: d.time })
      next = { ...by(due), start: by(due.start) }
    } else {
      next = { date: toDateString(start), time: allDay ? null : toTimeString(start), start: null }
    }
    rescheduleTask(item.task, next).catch(report(tr("Couldn't change the task's date", 'タスクの日付を変更できませんでした')))
  }, [])

  const ctx: ViewContext = {
    today,
    weekStartsOn,
    itemsOn: day => byDay.get(toDateString(day)) ?? [],
    open: item => {
      if (!item.task) return
      leave(item.task.source.noteId)
      openTask(item.task).catch(report(tr("Couldn't open the note", 'ノートを開けませんでした')))
    },
    toggleDone: item => {
      if (!item.task) return
      setTaskDone(item.task, !item.task.checked).catch(report(tr("Couldn't update the task", 'タスクを更新できませんでした')))
    },
    move,
    showDay: day => {
      setDate(startOfDay(day))
      setUi({ view: 'day' })
    }
  }

  const days =
    ui.view === 'week'
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date, weekStartsOn), i))
      : [startOfDay(date)]

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button type="button" className="icon-button" title={tr('Toggle sidebar', 'サイドバーの表示を切り替え')} onClick={() => setUi({ sidebar: !ui.sidebar })}>
          ☰
        </button>
        <button type="button" className="today-button" title={tr('Today (T)', '今日 (T)')} onClick={() => setDate(startOfDay(new Date()))}>
          {tr('Today', '今日')}
        </button>
        <button type="button" className="icon-button" title={tr('Previous (K)', '前へ (K)')} onClick={() => setDate(d => step(ui.view, d, -1))}>
          ‹
        </button>
        <button type="button" className="icon-button" title={tr('Next (J)', '次へ (J)')} onClick={() => setDate(d => step(ui.view, d, 1))}>
          ›
        </button>
        <h1>{title(ui.view, date, weekStartsOn)}</h1>
        <span className="spacer" />
        <div className="calendar-view-switch">
          {VIEWS.map(v => (
            <button
              key={v.value}
              type="button"
              className={ui.view === v.value ? 'active' : ''}
              title={`${v.label} (${v.key})`}
              onClick={() => setUi({ view: v.value })}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="calendar-main">
        {ui.sidebar && (
          <Sidebar
            date={date}
            today={today}
            weekStartsOn={weekStartsOn}
            ui={ui}
            setUi={setUi}
            onPick={d => setDate(startOfDay(d))}
            sources={sources}
          />
        )}
        <div className="calendar-content">
          {ui.view === 'month' && <MonthView month={date} ctx={ctx} />}
          {(ui.view === 'week' || ui.view === 'day') && <TimeGrid days={days} ctx={ctx} />}
          {ui.view === 'year' && (
            <YearView
              year={date.getFullYear()}
              ctx={ctx}
              onShowMonth={m => {
                setDate(m)
                setUi({ view: 'month' })
              }}
            />
          )}
        </div>
      </div>

    </div>
  )
}

/* ---- sidebar: mini month + what to show ---- */

/** Sources by sidebar heading, in registration order. */
function groupSources(sources: CalendarSource[]): Array<[string, CalendarSource[]]> {
  const groups = new Map<string, CalendarSource[]>()
  for (const s of sources) {
    const key = s.group || tr('Other calendars', '他のカレンダー')
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  return [...groups]
}

const Sidebar: React.FC<{
  date: Date
  today: Date
  weekStartsOn: 0 | 1
  ui: UiState
  setUi: (patch: Partial<UiState>) => void
  onPick: (d: Date) => void
  sources: CalendarSource[]
}> = ({ date, today, weekStartsOn, ui, setUi, onPick, sources }) => {
  const [month, setMonth] = useState(() => startOfMonth(date))

  useEffect(() => {
    setMonth(startOfMonth(date))
  }, [date.getFullYear(), date.getMonth()])

  return (
    <aside className="calendar-sidebar">
      <div className="calendar-mini">
        <div className="calendar-mini-header">
          <span>{monthTitle(month)}</span>
          <button type="button" onClick={() => setMonth(m => addMonths(m, -1))}>
            ‹
          </button>
          <button type="button" onClick={() => setMonth(m => addMonths(m, 1))}>
            ›
          </button>
        </div>
        <div className="calendar-mini-grid">
          {weekdayLabels(weekStartsOn, 'narrow').map((w, i) => (
            <span key={i} className="weekday">
              {w}
            </span>
          ))}
          {monthGrid(month, weekStartsOn).map(d => (
            <button
              key={toDateString(d)}
              type="button"
              className={[
                'day',
                d.getMonth() !== month.getMonth() && 'outside',
                sameDay(d, today) && 'today',
                sameDay(d, date) && 'selected'
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
      </div>

      <section className="calendar-list">
        <h3>Inkdrop</h3>
        <label className="calendar-list-item" style={{ '--item-color': 'var(--calendar-task-color)' } as React.CSSProperties}>
          <input type="checkbox" checked={ui.showTasks} onChange={e => setUi({ showTasks: e.target.checked })} />
          <span className="box" />
          <span className="name">{tr('Tasks with due dates', '期限付きのタスク')}</span>
        </label>
        <label className="calendar-list-item sub" style={{ '--item-color': 'var(--calendar-task-color)' } as React.CSSProperties}>
          <input type="checkbox" checked={ui.showDone} disabled={!ui.showTasks} onChange={e => setUi({ showDone: e.target.checked })} />
          <span className="box" />
          <span className="name">{tr('Show completed tasks', '完了したタスクも表示')}</span>
        </label>
      </section>

      {groupSources(sources).map(([group, list]) => (
        <section key={group} className="calendar-list">
          <h3>{group}</h3>
          {list.map(s => (
            <label
              key={s.id}
              className="calendar-list-item"
              style={{ '--item-color': s.color ?? 'var(--color-blue-500, #4285f4)' } as React.CSSProperties}
            >
              <input
                type="checkbox"
                checked={isSourceShown(s, ui.hiddenSources)}
                onChange={e => {
                  const on = e.target.checked
                  if (s.setActive) s.setActive(on)
                  else
                    setUi({
                      hiddenSources: on ? ui.hiddenSources.filter(id => id !== s.id) : [...ui.hiddenSources, s.id]
                    })
                }}
              />
              <span className="box" />
              <span className="name" title={s.name}>
                {s.name}
              </span>
            </label>
          ))}
        </section>
      ))}

    </aside>
  )
}
