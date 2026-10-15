import type { Diagram } from '../../model/schema'
import type { Box } from '../geometry'
import type { LayoutEdge, LayoutNode, LayoutText } from '../layout'
import { topAt, type Outline } from '../outline'
import { EDGE_LABEL, measure, SUBTITLE, TITLE } from '../text'
import { GAP } from './spacing'

const MARGIN = 16

/** The diagram's bounds around the outer ring, every node and edge label, then the heading tucked top-left where the ring slopes away. */
export function layoutBounds(d: Diagram, outer: Outline, nodes: LayoutNode[], edges: LayoutEdge[]): { texts: LayoutText[]; bounds: Box } {
  const extent = { left: -outer.halfWidth, right: outer.halfWidth, top: -outer.apex, bottom: outer.apex }
  const grow = (l: number, r: number, t: number, b: number) => {
    extent.left = Math.min(extent.left, l)
    extent.right = Math.max(extent.right, r)
    extent.top = Math.min(extent.top, t)
    extent.bottom = Math.max(extent.bottom, b)
  }
  for (const n of nodes) {
    grow(n.x - n.width / 2, n.x + n.width / 2, n.y - n.height / 2, n.y + n.height / 2)
  }
  for (const e of edges) {
    if (!e.label || !e.labelAt) continue
    const half = measure(e.label, EDGE_LABEL) / 2
    grow(e.labelAt.x - half, e.labelAt.x + half, e.labelAt.y - EDGE_LABEL.size, e.labelAt.y + EDGE_LABEL.size)
  }

  const texts: LayoutText[] = []
  const heading = [
    ...(d.title ? [{ key: 'title', text: d.title, style: 'title' as const, m: TITLE }] : []),
    ...(d.subtitle ? [{ key: 'subtitle', text: d.subtitle, style: 'subtitle' as const, m: SUBTITLE }] : []),
  ]
  if (heading.length) {
    const blockW = Math.max(...heading.map((t) => measure(t.text, t.m)))
    const blockH = heading.reduce((h, t) => h + t.m.size + 8, 0)
    const x = extent.left
    const clearance = Math.max(...[x, x + blockW, ...(x < 0 && x + blockW > 0 ? [0] : [])].map((px) => topAt(outer, px)))
    let ty = Math.min(extent.top, -clearance - GAP - blockH)
    for (const t of heading) {
      texts.push({ key: t.key, text: t.text, x, y: ty + t.m.size / 2, style: t.style })
      ty += t.m.size + 8
    }
    grow(x, x + blockW, texts[0].y - heading[0].m.size / 2, ty)
  }

  // Whole units, rounded outward: the map packs hexagons by their bounds, and whole numbers add up exactly.
  const [x, y] = [Math.floor(extent.left - MARGIN), Math.floor(extent.top - MARGIN)]
  return { texts, bounds: { x, y, width: Math.ceil(extent.right + MARGIN) - x, height: Math.ceil(extent.bottom + MARGIN) - y } }
}
