import type { Point } from '../layout/geometry'

/** How far from a corner its curve starts along each run. */
const RADIUS = 12
/** Runs closer than this are one point; a corner flatter than this is no corner. */
const SAME = 0.5
const STRAIGHT = 0.02

const fixed = (v: number) => String(Math.round(v * 100) / 100)

/**
 * The polyline with each corner rounded by a quadratic curve through it, starting RADIUS back along each run (half the
 * run at most), so a route reads as one continuous stroke.
 */
export function roundedPath(points: Point[]): string {
  const p: Point[] = []
  for (const q of points) {
    const last = p[p.length - 1]
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > SAME) p.push(q)
  }
  if (!p.length) return ''
  let d = `M${fixed(p[0].x)} ${fixed(p[0].y)}`
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]]
    const [v1, v2] = [{ x: a.x - b.x, y: a.y - b.y }, { x: c.x - b.x, y: c.y - b.y }]
    const [l1, l2] = [Math.hypot(v1.x, v1.y), Math.hypot(v2.x, v2.y)]
    if (Math.abs(v1.x * v2.y - v1.y * v2.x) / (l1 * l2) < STRAIGHT) {
      d += ` L${fixed(b.x)} ${fixed(b.y)}`
      continue
    }
    const r = Math.min(RADIUS, l1 / 2, l2 / 2)
    d += ` L${fixed(b.x + (v1.x / l1) * r)} ${fixed(b.y + (v1.y / l1) * r)} Q${fixed(b.x)} ${fixed(b.y)} ${fixed(b.x + (v2.x / l2) * r)} ${fixed(b.y + (v2.y / l2) * r)}`
  }
  const end = p[p.length - 1]
  return `${d} L${fixed(end.x)} ${fixed(end.y)}`
}
