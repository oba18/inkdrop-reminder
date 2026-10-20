import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'

import { getEnv } from './env'
import { tr } from './i18n'
import { DUE_RE, TASK_RE, stripMarkers } from './parse'

/** ⏰ button at the end of a task line; opens the picker for that task. */
class DueButton extends WidgetType {
  constructor(readonly hasDue: boolean) {
    super()
  }

  eq(other: DueButton) {
    return other.hasDue === this.hasDue
  }

  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = `reminder-line-due-button${this.hasDue ? ' has-due' : ''}`
    el.textContent = this.hasDue ? '⏰' : '⏰+'
    el.title = this.hasDue ? tr("Change this task's due date", 'このタスクの期限を変更') : tr('Set a due date for this task', 'このタスクに期限を設定')
    el.setAttribute('aria-label', el.title)
    // mousedown, so the editor doesn't move the cursor first.
    el.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const line = view.state.doc.lineAt(view.posAtDOM(el))
      const m = TASK_RE.exec(line.text)
      getEnv().commands.dispatch(document.body, 'reminder:set-task-due' as any, {
        line: line.number,
        text: m ? stripMarkers(m[4]).trim() : undefined
      })
    })
    return el
  }

  ignoreEvent() {
    return true
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      const m = TASK_RE.exec(line.text)
      if (m) {
        const hasDue = DUE_RE.test(m[4])
        widgets.push(Decoration.widget({ widget: new DueButton(hasDue), side: 1 }).range(line.to))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(widgets)
}

const dueButtons = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view)
    }
  },
  { decorations: v => v.decorations }
)

export const editorDueButtons: Extension = dueButtons
