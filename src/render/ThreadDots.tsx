import type { CSSProperties } from 'react'
import type { LayoutNode, ThreadMark } from '../layout/layout'

/** More threads than this on one box collapse into a "+N" count. */
export const MAX_DOTS = 4
const DOT_RADIUS = 4
const DOT_STEP = 11
/** How far the first dot sits in from the box's left edge. */
const DOT_INSET = 10
const MORE_FONT = 10
/** A card's dots sit this far down from its top edge, level with its header. */
const CARD_DOT_DROP = 12

/** The thread colour as a custom property: the palette defines `--thread-<slot>` per theme. */
export const threadStyle = (slot: number) => ({ '--thread': `var(--thread-${slot})` }) as CSSProperties

export function dotsOf(threads: readonly ThreadMark[]) {
  return { shown: threads.slice(0, MAX_DOTS), more: Math.max(0, threads.length - MAX_DOTS) }
}

/** One dot per thread through a box, along its top edge: clear of the text, and of the note marker in the right corner. A card's sit inside its top-right corner, the first nearest it. */
export function ThreadDots({ node }: { node: LayoutNode }) {
  const { shown, more } = dotsOf(node.threads ?? [])
  const card = node.kind === 'aggregate'
  const at = (i: number) => (card ? node.x + node.width / 2 - DOT_INSET - i * DOT_STEP : node.x - node.width / 2 + DOT_INSET + i * DOT_STEP)
  const y = node.y - node.height / 2 + (card ? CARD_DOT_DROP : 0)
  return (
    <>
      {shown.map((t, i) => (
        <circle key={t.id} className="thread-dot" data-thread={t.id} aria-hidden="true" cx={at(i)} cy={y} r={DOT_RADIUS} style={threadStyle(t.slot)} />
      ))}
      {more > 0 && (
        <text className="thread-more" aria-hidden="true" x={at(shown.length) + (card ? DOT_RADIUS : -DOT_RADIUS)} y={y} fontSize={MORE_FONT} textAnchor={card ? 'end' : undefined}>
          +{more}
        </text>
      )}
    </>
  )
}
