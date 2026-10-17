import { getConfig } from './env'
import { DUE_RE, REMIND_RE, dueDate, formatDueLabel, parseDueInfo } from './parse'

const MARKER_RE = new RegExp(
  `(${DUE_RE.source})(?:\\s*(${REMIND_RE.source}))?|(${REMIND_RE.source})`,
  'g'
)

interface MdNode {
  type: string
  value?: string
  checked?: boolean | null
  children?: MdNode[]
  data?: Record<string, any>
  position?: { start: { line: number } }
}

interface Ctx {
  checked: boolean | null | undefined
  /** 1-based source line of the enclosing task item */
  taskLine?: number
  hasBadge?: boolean
}

/** Clicking these in the preview opens the picker (see `index.ts`). */
function target(ctx: Ctx): Record<string, string | number> {
  return ctx.taskLine ? { dataReminderLine: ctx.taskLine } : { dataReminderNote: 1 }
}

function badge(raw: string, ctx: Ctx): MdNode {
  const due = parseDueInfo(raw)
  if (!due) return { type: 'text', value: '' } // a stray 🔔 without ⏰ is hidden
  const { defaultTime, defaultRemindMinutes } = getConfig()
  const at = dueDate(due, defaultTime)
  const overdue = !ctx.checked && at.getTime() < Date.now()
  const label = formatDueLabel(due, defaultTime, defaultRemindMinutes)
  const classes = ['reminder-due-badge', overdue && 'overdue', ctx.checked && 'done']
  ctx.hasBadge = true
  return {
    type: 'reminderDue',
    data: {
      hName: 'span',
      hProperties: {
        className: classes.filter(Boolean),
        title: `${raw.trim()}（クリックで変更）`,
        ...target(ctx)
      },
      hChildren: [
        {
          type: 'text',
          value: `⏰ ${label}`
        }
      ]
    }
  }
}

function addButton(line: number): MdNode {
  return {
    type: 'reminderAdd',
    data: {
      hName: 'span',
      hProperties: { className: ['reminder-preview-add'], title: '期限を設定', dataReminderLine: line },
      hChildren: [{ type: 'text', value: '⏰+' }]
    }
  }
}

function transform(node: MdNode, ctx: Ctx) {
  if (!node.children) return
  const isTask = node.type === 'listItem' && typeof node.checked === 'boolean'
  const next: Ctx =
    node.type === 'listItem'
      ? { checked: node.checked, taskLine: isTask ? node.position?.start.line : undefined }
      : ctx
  const out: MdNode[] = []
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value?.match(/[⏰🔔]/u)) {
      transform(child, next)
      out.push(child)
      continue
    }
    const value = child.value
    let last = 0
    for (const m of value.matchAll(MARKER_RE)) {
      if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
      out.push(badge(m[0], next))
      last = m.index + m[0].length
    }
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  }
  node.children = out
  // A task without a due date gets a ⏰+ button after its text.
  if (isTask && next.taskLine && !next.hasBadge) {
    const para = node.children.find(c => c.type === 'paragraph')
    if (para?.children) para.children.push(addButton(next.taskLine))
  }
}

/** Renders `⏰…` / `🔔…` markers in the preview as a compact due-date badge. */
export function remarkDue() {
  return (tree: MdNode) => transform(tree, { checked: undefined })
}
