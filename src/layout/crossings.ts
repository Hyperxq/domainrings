import type { Point } from './geometry'

/** One dependency/endpoint arrow's own two endpoints, plus the refs it connects — reused from
 * `OnionEdgeLayout`/`CleanEdgeLayout` (structurally compatible, no import needed) so the same counter measures
 * both kinds. Crossings are counted against the straight from→to chord, not the cosmetic curved path Detailed
 * view bows it into (`render/RingedNodes.tsx`'s `edgePath`) — the bow is a small, deterministic offset off the
 * same chord, so it never changes which PAIRS of edges cross, only how sharply the crossing reads on screen. */
export interface CrossingEdge {
  fromRef: string
  toRef: string
  from: Point
  to: Point
}

/** Twice the signed area of triangle p→q→r; its sign is the turn direction (CCW/CW), 0 collinear — the classic
 * building block (CLRS) for a robust segment-intersection test without dividing by zero on vertical/parallel lines. */
function orientation(p: Point, q: Point, r: Point): -1 | 0 | 1 {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
  if (Math.abs(val) < 1e-9) return 0
  return val > 0 ? 1 : -1
}

/** True when `q` lies on the (already known collinear) segment `p`–`r`'s own bounding box. */
function onSegment(p: Point, q: Point, r: Point): boolean {
  const eps = 1e-9
  return Math.min(p.x, r.x) - eps <= q.x && q.x <= Math.max(p.x, r.x) + eps && Math.min(p.y, r.y) - eps <= q.y && q.y <= Math.max(p.y, r.y) + eps
}

/** True when segment p1–q1 properly crosses p2–q2 (including a touching/collinear overlap) — the standard
 * orientation-based test; two segments that only meet at a shared vertex (handled by the caller, which never
 * calls this for edges sharing a ref) are the one case this deliberately does not need to special-case. */
function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2)
  const o2 = orientation(p1, q1, q2)
  const o3 = orientation(p2, q2, p1)
  const o4 = orientation(p2, q2, q1)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, q2, q1)) return true
  if (o3 === 0 && onSegment(p2, p1, q2)) return true
  if (o4 === 0 && onSegment(p2, q1, q2)) return true
  return false
}

/** The number of edge PAIRS that visibly cross — the "measure, don't guess" number Decision 3's crossing
 * minimisation is judged against. Two edges sharing an element/endpoint ref never count as crossing (they meet
 * at a real node, not an incidental overlap); everything else is a straight-line intersection test between their
 * own chords. O(n²) in the edge count, which is fine at diagram scale (tens of edges, never thousands). */
export function countCrossings(edges: readonly CrossingEdge[]): number {
  let crossings = 0
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = [edges[i], edges[j]]
      const sharesEndpoint = a.fromRef === b.fromRef || a.fromRef === b.toRef || a.toRef === b.fromRef || a.toRef === b.toRef
      if (sharesEndpoint) continue
      if (segmentsIntersect(a.from, a.to, b.from, b.to)) crossings++
    }
  }
  return crossings
}
