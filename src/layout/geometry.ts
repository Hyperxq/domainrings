export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
/** Half the extent of an upright w×h box along a unit vector. */
export const reach = (w: number, h: number, v: Point) => (w / 2) * Math.abs(v.x) + (h / 2) * Math.abs(v.y)

export function rectCorners(cx: number, cy: number, w: number, h: number, rotation = 0): Point[] {
  const a = (rotation * Math.PI) / 180
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const [ox, oy] = [(sx * w) / 2, (sy * h) / 2]
    return { x: cx + ox * Math.cos(a) - oy * Math.sin(a), y: cy + ox * Math.sin(a) + oy * Math.cos(a) }
  })
}

/** Separating-axis test for convex quads; touching does not count. */
export function quadsOverlap(a: Point[], b: Point[]) {
  const axes = [a, b].flatMap((q) => [{ x: q[1].x - q[0].x, y: q[1].y - q[0].y }, { x: q[3].x - q[0].x, y: q[3].y - q[0].y }])
  return axes.every((axis) => {
    const [pa, pb] = [a.map((p) => dot(p, axis)), b.map((p) => dot(p, axis))]
    return Math.min(...pa) < Math.max(...pb) - 1e-6 && Math.min(...pb) < Math.max(...pa) - 1e-6
  })
}

/** Where a ray from `from` along `v` first enters an upright box (slab method); `from` itself if it never does. */
export function enterBox(box: { x: number; y: number; width: number; height: number }, from: Point, v: Point): Point {
  let [t0, t1] = [-Infinity, Infinity]
  for (const [o, d, lo, hi] of [
    [from.x, v.x, box.x - box.width / 2, box.x + box.width / 2],
    [from.y, v.y, box.y - box.height / 2, box.y + box.height / 2],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return from
      continue
    }
    const [a, b] = [(lo - o) / d, (hi - o) / d].sort((p, q) => p - q)
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
  }
  return t0 <= t1 && t1 >= 0 ? { x: from.x + v.x * Math.max(0, t0), y: from.y + v.y * Math.max(0, t0) } : from
}

export const dedupe = (points: Point[]) => points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)

/** A segment as a hairline quad, so the same separating-axis test covers runs and boxes. */
export const hairline = (a: Point, b: Point): Point[] => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const [nx, ny] = [(-(b.y - a.y) / len) * 0.5, ((b.x - a.x) / len) * 0.5]
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]
}

export function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.width))
  const y1 = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
