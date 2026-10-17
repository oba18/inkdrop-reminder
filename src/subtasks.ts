import type { TaskItem } from './scheduler'

/** A task with the subtasks shown under it */
export interface TaskNode {
  item: TaskItem
  children: TaskNode[]
}

const keyOf = (noteId: string, line: number) => `${noteId}:${line}`

/** Finds a note's task by line, among every indexed task. */
export type TaskLookup = (noteId: string, line: number) => TaskItem | undefined

export function makeLookup(all: TaskItem[]): TaskLookup {
  const map = new Map<string, TaskItem>()
  for (const t of all) if (t.kind === 'task') map.set(keyOf(t.noteId, t.task.line), t)
  return (noteId, line) => map.get(keyOf(noteId, line))
}

/**
 * Puts each task under its parent when the parent is among `items` too, in
 * note order; the rest stay at the top level in the order given. A subtask
 * whose parent isn't shown (filtered out) is a top-level node of its own.
 */
export function nest(items: TaskItem[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>()
  for (const item of items) {
    if (item.kind === 'task') nodes.set(keyOf(item.noteId, item.task.line), { item, children: [] })
  }
  const roots: TaskNode[] = []
  for (const item of items) {
    const node = item.kind === 'task' ? nodes.get(keyOf(item.noteId, item.task.line))! : { item, children: [] }
    const parent =
      item.kind === 'task' && item.task.parent !== null ? nodes.get(keyOf(item.noteId, item.task.parent)) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const byLine = (a: TaskNode, b: TaskNode) => a.item.task.line - b.item.task.line
  for (const node of nodes.values()) node.children.sort(byLine)
  return roots
}

/** Depth-first rows of a tree, skipping the subtasks of collapsed tasks */
export function flatten(
  roots: TaskNode[],
  collapsed: Set<string>,
  keyFn: (t: TaskItem) => string
): Array<{ node: TaskNode; depth: number }> {
  const rows: Array<{ node: TaskNode; depth: number }> = []
  const walk = (nodes: TaskNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth })
      if (!collapsed.has(keyFn(node.item))) walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return rows
}

/** Direct subtasks of a task, from the full index (whatever is filtered out) */
export function subtasksOf(item: TaskItem, lookup: TaskLookup): TaskItem[] {
  if (item.kind !== 'task') return []
  return item.task.children.flatMap(line => lookup(item.noteId, line) ?? [])
}

/** The parent task of a subtask, from the full index */
export function parentOf(item: TaskItem, lookup: TaskLookup): TaskItem | undefined {
  return item.kind === 'task' && item.task.parent !== null ? lookup(item.noteId, item.task.parent) : undefined
}
