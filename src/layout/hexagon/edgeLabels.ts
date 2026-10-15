import { hairline, quadsOverlap, rectCorners, reach, type Box, type Point } from '../geometry'
import type { LayoutEdge } from '../layout'
import { EDGE_LABEL, measure } from '../text'

/** Room between a label and the run it names. */
const CLEAR = 3
/** Room kept between two labels along the page, so neighbouring runs never read as one line of text. */
const SPREAD = 10
const LABEL_HEIGHT = EDGE_LABEL.size + 4
/** Where along the free stretch of a segment a label is tried, as fractions of it: the middle first, then spread out from it. */
const STRETCH = [0.5, 0.2, 0.8, 0, 1]

interface Segment {
  a: Point
  b: Point
  box: Box
}

const boxOf = (a: Point, b: Point): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) })
const meets = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
const quad = (b: Box) => rectCorners(b.x + b.width / 2, b.y + b.height / 2, b.width, b.height)

/**
 * Writes each labelled edge's text flat beside one segment of its own run: the longest corridor stretch first, then
 * the hops that join it to its boxes. A candidate is refused when it overlaps an obstacle, a segment of any edge or
 * another label (kept `SPREAD` clear along the page); a run with no room left keeps its `label` and gets no `labelAt`,
 * and the renderer shows it as a hover title instead. A segment shorter than the text is never tried.
 */
export function placeEdgeLabels(edges: LayoutEdge[], obstacles: Box[]): void {
  const segments = edges.flatMap((edge) => edge.points.slice(1).map((b, i): Segment => ({ a: edge.points[i], b, box: boxOf(edge.points[i], b) })))
  const taken: Box[] = []
  const free = (rect: Box) => {
    const wide = { ...rect, x: rect.x - SPREAD, width: rect.width + 2 * SPREAD }
    if (taken.some((t) => meets(wide, t)) || obstacles.some((o) => meets(rect, o))) return false
    const around = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 }
    return !segments.some((s) => meets(around, { x: s.box.x - 1, y: s.box.y - 1, width: s.box.width + 2, height: s.box.height + 2 }) && quadsOverlap(quad(rect), hairline(s.a, s.b)))
  }

  for (const edge of edges) {
    if (!edge.label) continue
    const width = measure(edge.label, EDGE_LABEL)
    const runs = edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b, len: Math.hypot(b.x - edge.points[i].x, b.y - edge.points[i].y), hop: i === 0 || i === edge.points.length - 2 }))
    const longest = (hop: boolean) => runs.filter((r) => r.hop === hop).sort((p, q) => q.len - p.len)
    const order = edge.points.length > 2 ? [...longest(false), ...longest(true)] : runs
    search: for (const { a, b, len } of order) {
      if (len === 0) continue
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
      const extent = width * Math.abs(d.x) + LABEL_HEIGHT * Math.abs(d.y)
      if (len < extent) continue
      const n = { x: -d.y, y: d.x }
      // Above a run, or to the right of an upright one, before the other side.
      const lean = n.y < -1e-9 || (Math.abs(n.y) <= 1e-9 && n.x > 0) ? 1 : -1
      const off = reach(width, LABEL_HEIGHT, n) + CLEAR
      for (const f of STRETCH)
        for (const side of [lean, -lean]) {
          const s = extent / 2 + (len - extent) * f
          const at = { x: a.x + d.x * s + n.x * side * off, y: a.y + d.y * s + n.y * side * off }
          const rect = { x: at.x - width / 2, y: at.y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT }
          if (!free(rect)) continue
          edge.labelAt = at
          taken.push(rect)
          break search
        }
    }
  }
}
