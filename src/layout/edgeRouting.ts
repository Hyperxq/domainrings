import type { Point } from './geometry'
import { ringElementRadius } from './ringOutlines'
import { titleHalfSpan, TITLE_ARC_PAD, TITLE_LINE } from './ringedMetrics'
import { measure, RING_LABEL, RING_SUBTITLE } from './text'

/** How far a Detailed-view arrow bows off its own chord, as a fraction of the chord's length. */
const DEFAULT_BOW = 0.18
/** Signed multiples of `DEFAULT_BOW` tried, in preference order, when the default bow crosses a curved label. */
const BOW_CANDIDATES = [1, -1, 2, -2]
const SAMPLES = 48

/** The quadratic's control point for an arrow bowed `bow` of its own chord length. The bow moves PERPENDICULAR to
 * the chord, on the side facing away from the origin at `bow > 0`: a chord collinear with the centre has its own
 * "away from the origin" direction running PARALLEL to it, where nudging the control point would leave the curve
 * exactly straight. */
export function edgeControl(from: Point, to: Point, bow = DEFAULT_BOW): Point {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const chord = Math.hypot(to.x - from.x, to.y - from.y)
  const perp = chord > 1e-6 ? { x: -(to.y - from.y) / chord, y: (to.x - from.x) / chord } : { x: 0, y: 0 }
  const centreDist = Math.hypot(mid.x, mid.y)
  const outward = centreDist > 1e-6 ? { x: mid.x / centreDist, y: mid.y / centreDist } : perp
  const side = Math.sign(perp.x * outward.x + perp.y * outward.y) || 1
  return { x: mid.x + perp.x * side * chord * bow, y: mid.y + perp.y * side * chord * bow }
}

/** A curved label's painted region, as `arcLabelFootprintBox` sizes it: `radius ± TITLE_LINE/2` over `centerAngle
 * ± halfSpan`. */
interface LabelArc {
  radius: number
  centerAngle: number
  halfSpan: number
}

/** Every ring title (always at the top) and, for Clean, every sector name — laid out at the SAME radius and reach
 * `render/Diagram.tsx`/`render/CleanDiagram.tsx` paint them at. */
export function labelArcs(
  rings: readonly { title: string; apex: number }[],
  sectors: readonly { ringIndex: number; name: string; startAngle: number; endAngle: number }[],
): LabelArc[] {
  const radiusOf = (i: number) => ringElementRadius(rings[i], rings[i - 1])
  const titles = rings.map((ring, i) => ({
    radius: radiusOf(i),
    centerAngle: -Math.PI / 2,
    halfSpan: titleHalfSpan(measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD, radiusOf(i)),
  }))
  const names = sectors.filter((s) => s.ringIndex >= 0 && s.ringIndex < rings.length).map((s) => {
    const radius = radiusOf(s.ringIndex)
    const wedgeHalfSpan = Math.max(0, (s.endAngle - s.startAngle) / 2 - TITLE_ARC_PAD / Math.max(radius, 1))
    return {
      radius,
      centerAngle: (s.startAngle + s.endAngle) / 2,
      halfSpan: Math.min(wedgeHalfSpan, titleHalfSpan(measure(s.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD, radius)),
    }
  })
  return [...titles, ...names]
}

const insideArc = (p: Point, arc: LabelArc): boolean => {
  if (Math.abs(Math.hypot(p.x, p.y) - arc.radius) > TITLE_LINE / 2) return false
  const d = Math.atan2(Math.sin(Math.atan2(p.y, p.x) - arc.centerAngle), Math.cos(Math.atan2(p.y, p.x) - arc.centerAngle))
  return Math.abs(d) <= arc.halfSpan
}

/** How many of the curve's samples fall on a curved label. */
export function labelCrossings(edge: { from: Point; to: Point }, control: Point, arcs: readonly LabelArc[]): number {
  let n = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const u = 1 - t
    const p = { x: u * u * edge.from.x + 2 * u * t * control.x + t * t * edge.to.x, y: u * u * edge.from.y + 2 * u * t * control.y + t * t * edge.to.y }
    if (arcs.some((arc) => insideArc(p, arc))) n++
  }
  return n
}

/** Each arrow's own control point, bowed just enough (`BOW_CANDIDATES`) to keep its curve off every ring title and
 * sector name — the halo keeps a crossing readable, but it is still text an arrow runs across. An arrow no
 * candidate fully clears keeps whichever crosses the least, the default bow winning any tie. */
export function routeEdgesAroundLabels<E extends { from: Point; to: Point }>(
  edges: readonly E[],
  rings: readonly { title: string; apex: number }[],
  sectors: readonly { ringIndex: number; name: string; startAngle: number; endAngle: number }[] = [],
): (E & { control: Point })[] {
  const arcs = labelArcs(rings, sectors)
  return edges.map((edge) => {
    const crossings = (control: Point) => labelCrossings(edge, control, arcs)
    const candidates = BOW_CANDIDATES.map((k) => edgeControl(edge.from, edge.to, DEFAULT_BOW * k))
    const control = candidates.reduce((best, c) => (crossings(c) < crossings(best) ? c : best))
    return { ...edge, control }
  })
}
