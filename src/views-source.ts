import type { Environment, TelescopeContext, TelescopeResult, TelescopeSourceItem } from '@inkdropapp/types'
import { TelescopeSource } from 'inkdrop'

import { tr } from './i18n'
import { setTasksViewActive, showTasks, type Mode } from './tasks-view'

const SOURCE_ID = 'reminder-views'

const VIEWS: Array<{ id: Mode | 'tasks'; icon: string; en: string; ja: string; keywords?: string }> = [
  { id: 'tasks', icon: '☑️', en: 'Tasks', ja: 'タスク', keywords: 'todo' },
  { id: 'list', icon: '📋', en: 'Task list', ja: 'リスト' },
  { id: 'kanban', icon: '🗂️', en: 'Kanban', ja: 'カンバン', keywords: 'board' },
  { id: 'matrix', icon: '🧭', en: 'Eisenhower matrix', ja: 'マトリクス', keywords: 'priority' },
  { id: 'notes', icon: '📒', en: 'Note board', ja: 'ノート ボード', keywords: 'status' },
  { id: 'gantt', icon: '📊', en: 'Gantt chart', ja: 'ガント', keywords: 'timeline' },
  { id: 'calendar', icon: '📅', en: 'Calendar', ja: 'カレンダー', keywords: 'schedule 予定' }
]

/** Inkdrop's own sources, which stay first. */
const CORE_SOURCES = ['commands', 'books', 'tags']

/**
 * Registers the views source ahead of other plugins' sources: Telescope lists
 * results by source registration order, and a note search (quick-search) would
 * otherwise bury "calendar" under every note that mentions it.
 */
export function registerViewsSource(telescope: Environment['telescope']): () => void {
  telescope.registerSource(new ViewsSource())
  const later = [...telescope.availableSources.values()].filter(s => s.id !== SOURCE_ID && !CORE_SOURCES.includes(s.id))
  for (const s of later) {
    telescope.unregisterSource(s.id)
    telescope.registerSource(s)
  }
  return () => {
    if (telescope.getSource(SOURCE_ID)) telescope.unregisterSource(SOURCE_ID)
  }
}

/**
 * Lets ⌘K jump to the Tasks views by typing their name, in English or
 * Japanese ("calendar", "カレンダー", "kanban"…). Ranked above notes.
 */
export class ViewsSource extends TelescopeSource {
  id = SOURCE_ID
  name = 'Tasks'
  description = tr('Open a Tasks view (list, Kanban, calendar…)', 'Tasks の画面を開く（リスト・カンバン・カレンダーなど）')

  getItems(context: TelescopeContext): TelescopeResult {
    // Our own matching: Telescope's fuzzy filter doesn't match Japanese.
    const words = context.query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (v: (typeof VIEWS)[number]) => {
      const hay = `${v.en} ${v.ja} ${v.keywords ?? ''} tasks`.toLowerCase()
      return words.length > 0 && words.every(w => hay.includes(w))
    }
    const options: TelescopeSourceItem[] = VIEWS.filter(matches).map(v => {
      const shown = tr(v.en, v.ja)
      return {
        id: v.id,
        source: SOURCE_ID,
        type: 'Tasks',
        // Matched against: both languages and a few synonyms; what is shown is the UI language.
        label: `${v.en} ${v.ja} ${v.keywords ?? ''} tasks`,
        displayLabel: `${v.icon} ${shown}`,
        detail: v.id === 'tasks' ? tr('The tab you used last', '最後に使ったタブ') : tr('Tasks view', 'Tasks の画面'),
        boost: 99
      }
    })
    return { options, filter: false }
  }

  apply(item: TelescopeSourceItem): boolean {
    if (item.id === 'tasks') setTasksViewActive(true)
    else showTasks(item.id as Mode)
    return true
  }
}
