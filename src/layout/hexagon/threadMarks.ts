import type { Thread } from '../../model/threads'
import type { LayoutEdge, LayoutNode, ThreadMark } from '../layout'

// The boxes of a flow (a card carries its root's dots, not the name and rows inside it); labels and the composition root belong to no thread.
const DOTTED = new Set<LayoutNode['kind']>(['actor', 'adapter', 'port', 'useCase', 'external', 'aggregate'])

/**
 * Tags each box with the threads that touch it and each edge with the one thread it belongs to. An edge belongs to a
 * thread when both its ends do (a use case's ask into the domain, when its start does); one shared by several threads
 * stays neutral, since no colour could speak for all of them.
 */
export function markThreads(nodes: LayoutNode[], edges: LayoutEdge[], threads: readonly Thread[]) {
  const mark = (t: Thread): ThreadMark => ({ id: t.useCaseId, slot: t.slot })
  for (const node of nodes) {
    const marks = DOTTED.has(node.kind) ? threads.filter((t) => t.refs.has(node.ref)).map(mark) : []
    if (marks.length) node.threads = marks
  }
  for (const edge of edges) {
    if (edge.from === undefined) continue
    const own = threads.filter((t) => t.refs.has(edge.from!) && (edge.to === undefined || t.refs.has(edge.to)))
    if (own.length === 1) edge.thread = mark(own[0])
  }
}
