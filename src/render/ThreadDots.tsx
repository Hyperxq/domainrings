import type { CSSProperties } from 'react'
import type { LayoutNode, ThreadMark } from '../layout/layout'

/** More threads than this on one box collapse into a "+N" count. */
export const MAX_DOTS = 4
const DOT_RADIUS = 3
const DOT_STEP = 10
/** How far the first dot sits in from the box's left edge. */
const DOT_INSET = 9
const MORE_FONT = 9

/** The thread colour as a custom property: the palette defines `--thread-<slot>` per theme. */
export const threadStyle = (slot: number) => ({ '--thread': `var(--thread-${slot})` }) as CSSProperties

export function dotsOf(threads: readonly ThreadMark[]) {
  return { shown: threads.slice(0, MAX_DOTS), more: Math.max(0, threads.length - MAX_DOTS) }
}

/** One dot per thread through a box, along its top edge: clear of the text, and of the note marker in the right corner. */
export function ThreadDots({ node }: { node: LayoutNode }) {
  const { shown, more } = dotsOf(node.threads ?? [])
  const left = node.x - node.width / 2 + DOT_INSET
  const y = node.y - node.height / 2
  return (
    <>
      {shown.map((t, i) => (
        <circle key={t.id} className="thread-dot" data-thread={t.id} aria-hidden="true" cx={left + i * DOT_STEP} cy={y} r={DOT_RADIUS} style={threadStyle(t.slot)} />
      ))}
      {more > 0 && (
        <text className="thread-more" aria-hidden="true" x={left + shown.length * DOT_STEP - DOT_RADIUS} y={y} fontSize={MORE_FONT}>
          +{more}
        </text>
      )}
    </>
  )
}
