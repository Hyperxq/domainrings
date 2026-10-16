import type { CSSProperties } from 'react'
import type { LayoutNode, ThreadMark } from '../layout/layout'
import { DOT_INSET, DOT_RADIUS, DOT_STEP, MAX_DOTS, NOTE_CLEAR } from '../layout/hexagon/spacing'

export { MAX_DOTS }
const MORE_FONT = 10
/** The dots sit this far down from the top edge, level with a card's header. */
const DOT_DROP = 12

/** The thread colour as a custom property: the palette defines `--thread-<slot>` per theme. */
export const threadStyle = (slot: number) => ({ '--thread': `var(--thread-${slot})` }) as CSSProperties

export function dotsOf(threads: readonly ThreadMark[]) {
  return { shown: threads.slice(0, MAX_DOTS), more: Math.max(0, threads.length - MAX_DOTS) }
}

/** One dot per thread through a box, inside its top-right corner, the first nearest it and left of any note marker. */
export function ThreadDots({ node, noted = false }: { node: LayoutNode; noted?: boolean }) {
  const { shown, more } = dotsOf(node.threads ?? [])
  const at = (i: number) => node.x + node.width / 2 - DOT_INSET - (noted ? NOTE_CLEAR : 0) - i * DOT_STEP
  const y = node.y - node.height / 2 + DOT_DROP
  return (
    <>
      {shown.map((t, i) => (
        <circle key={t.id} className="thread-dot" data-thread={t.id} aria-hidden="true" cx={at(i)} cy={y} r={DOT_RADIUS} style={threadStyle(t.slot)} />
      ))}
      {more > 0 && (
        <text className="thread-more" aria-hidden="true" x={at(shown.length) + DOT_RADIUS} y={y} fontSize={MORE_FONT} textAnchor="end">
          +{more}
        </text>
      )}
    </>
  )
}
