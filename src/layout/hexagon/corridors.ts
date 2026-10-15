import type { Wall } from '../../model/schema'
import { dedupe, dot, enterBox, reach, type Point } from '../geometry'
import { COS30, SQRT3 } from '../outline'
import { TRACK_GAP } from './spacing'
import { faceAt, VERTEX, wallFrame } from './walls'

/** An upright box seated on a wall: where it is and the wall it belongs to. */
export interface Placed {
  x: number
  y: number
  width: number
  height: number
  wall: Wall
}

/** A box's place along its wall: where its centre is and how far it reaches either side. */
export interface Span {
  u: number
  reach: number
}

/** The walls in the order they come round the hexagon: neighbours share a vertex, wall i and i + 1 the one at VERTEX[(i + 2) % 6]. */
const CYCLE: Wall[] = ['e', 'se', 'sw', 'w', 'nw', 'ne']
const NORMALS = CYCLE.map((w) => wallFrame(w).n)
/** A run along a wall stays this far from the end of either box it joins. */
const INSET = 4
const EPS = 1e-9
/** Up to this many tracks the cheapest order is searched exhaustively. */
const EXACT = 12
const mod = (x: number, m: number) => ((x % m) + m) % m

/** The straight stretch along a wall that both boxes reach, kept INSET from either end; undefined when they do not meet. */
export const overlap = (a: Span, b: Span): [number, number] | undefined => {
  const lo = Math.max(a.u - a.reach, b.u - b.reach) + INSET
  const hi = Math.min(a.u + a.reach, b.u + b.reach) - INSET
  return lo <= hi ? [lo, hi] : undefined
}

/** The wall a point faces. */
export const wallAt = (p: Point): Wall => CYCLE.reduce((best, w) => (dot(p, wallFrame(w).n) > dot(p, wallFrame(best).n) + EPS ? w : best))

/**
 * Going round from wall `from` to wall `to` the shorter way (counted in walls), the vertices passed. The domain title
 * sits in the top corner, so when both ways are as short the one clear of it is taken.
 */
export function arcBetween(from: Wall, to: Wall): { clockwise: boolean; vertices: number[] } {
  const [a, b] = [CYCLE.indexOf(from), CYCLE.indexOf(to)]
  const steps = (b - a + 6) % 6
  const walk = (clockwise: boolean) => ({
    clockwise,
    vertices: Array.from({ length: clockwise ? steps : 6 - steps }, (_, k) => ((clockwise ? a + k : a - k - 1) + 8) % 6),
  })
  if (steps < 3) return walk(true)
  if (steps > 3) return walk(false)
  return walk(!walk(true).vertices.includes(0))
}

/**
 * The corners of the hexagon of apothem `apothem` passed going from wall `from` round to wall `to`. A run over the top
 * corner ducks to `clip` below the centre line's top, where the title is not, for the width of that corner.
 */
export function around(from: Wall, to: Wall, apothem: number, clip: number): Point[] {
  const r = apothem / COS30
  const { clockwise, vertices } = arcBetween(from, to)
  return vertices.flatMap((vertex) => {
    // The side vertices lie exactly on the vertical walls, so a run up a vertical wall stays exactly vertical.
    if (vertex !== 0 || clip >= r) return [{ x: VERTEX[vertex].x === 0 ? 0 : Math.sign(VERTEX[vertex].x) * apothem, y: VERTEX[vertex].y * r }]
    const half = Math.min((r - clip) * SQRT3, apothem)
    return clockwise ? [{ x: -half, y: -clip }, { x: half, y: -clip }] : [{ x: half, y: -clip }, { x: -half, y: -clip }]
  })
}

/**
 * Where the ray from `from` along the unit vector `dir` meets the hexagon of apothem `apothem`: the way out from inside,
 * the near wall from outside. A ray that starts outside and points away takes the near side it left behind; one whose
 * line misses the hexagon stays where it is.
 */
export function hexHit(from: Point, dir: Point, apothem: number): Point {
  const crossings = NORMALS.flatMap((n) => {
    const slope = dot(dir, n)
    return Math.abs(slope) > EPS ? [{ n, t: (apothem - dot(from, n)) / slope, leaving: slope > 0 }] : []
  })
  const leaving = crossings.filter((c) => c.leaving)
  const entering = crossings.filter((c) => !c.leaving)
  if (!leaving.length) return from
  const exit = leaving.reduce((a, b) => (b.t < a.t ? b : a))
  const entry = entering.length ? entering.reduce((a, b) => (b.t > a.t ? b : a)) : undefined
  const inside = NORMALS.every((n) => dot(from, n) <= apothem + EPS)
  const hit = inside ? exit : entry && entry.t <= exit.t + EPS ? (entry.t >= -EPS ? entry : exit) : undefined
  if (!hit) return from
  // A hit on a vertical wall lies exactly on it.
  return { x: hit.n.y === 0 ? hit.n.x * apothem : from.x + dir.x * hit.t, y: from.y + dir.y * hit.t }
}

/**
 * The order of tracks, outermost first, that costs the fewest crossings; `cost[i][j]` is what it costs for i to run
 * outside j. Exhaustive up to EXACT tracks, then each next track is the one that costs least against those left.
 */
export function minimiseCrossings(cost: number[][]): number[] {
  const n = cost.length
  if (n > EXACT) {
    const rest = Array.from({ length: n }, (_, k) => k)
    const order: number[] = []
    const score = (k: number) => rest.reduce((sum, j) => sum + cost[k][j] - cost[j][k], 0)
    while (rest.length) {
      const next = rest.reduce((best, k) => (score(k) < score(best) ? k : best))
      order.push(next)
      rest.splice(rest.indexOf(next), 1)
    }
    return order
  }
  const best = new Array<number>(1 << n).fill(Infinity)
  const last = new Array<number>(1 << n).fill(-1)
  best[0] = 0
  for (let placed = 0; placed < 1 << n; placed++) {
    if (best[placed] === Infinity) continue
    for (let k = 0; k < n; k++) {
      if (placed & (1 << k)) continue
      let total = best[placed]
      for (let i = 0; i < n; i++) if (placed & (1 << i)) total += cost[i][k]
      const next = placed | (1 << k)
      if (total < best[next] - EPS) {
        best[next] = total
        last[next] = k
      }
    }
  }
  const order: number[] = []
  for (let placed = (1 << n) - 1; placed; placed &= ~(1 << last[placed])) order.unshift(last[placed])
  return order
}

export interface TrackRequest {
  port: Placed
  useCase: Placed
}

export interface TrackGeometry {
  /** Apothem of the outermost track. Each next track runs TRACK_GAP further in. */
  outer: number
}

/** A box's place on a wall, without the box. */
export interface Terminal extends Span {
  wall: Wall
}

/** What a set of links asks of a corridor: how many tracks, and how many of those pass over the top corner. */
export function trackNeed(links: Array<{ from: Terminal; to: Terminal }>) {
  const apart = links.filter((l) => l.from.wall !== l.to.wall || !overlap(l.from, l.to))
  return { tracks: apart.length, overTop: apart.filter((l) => arcBetween(l.from.wall, l.to.wall).vertices.includes(0)).length }
}

/**
 * Port → use case, one path per request. A port that meets its use case square across one wall takes the short straight
 * run. Every other link hops out of the port along the wall normal onto a track of the corridor, runs round the
 * hexagon the shorter way and hops in along the use case's wall normal. Tracks sit TRACK_GAP apart, ordered to cross
 * the fewest hops; links reaching one use case enter its face in the order that keeps them from crossing.
 */
export function routeTracks(requests: TrackRequest[], { outer }: TrackGeometry): Point[][] {
  const links = requests.map(({ port, useCase }, index) => {
    const [pf, uf] = [wallFrame(port.wall), wallFrame(useCase.wall)]
    const portSpan = { u: dot(port, pf.dir), reach: reach(port.width, port.height, pf.dir) }
    const useSpan = { u: dot(useCase, uf.dir), reach: reach(useCase.width, useCase.height, uf.dir) }
    const window = port.wall === useCase.wall ? overlap(portSpan, useSpan) : undefined
    return { index, port, useCase, pf, uf, portSpan, useSpan, window }
  })
  const paths = new Array<Point[]>(requests.length)

  const apart = links.filter((l) => !l.window)
  const reference = outer - ((apart.length - 1) * TRACK_GAP) / 2
  const side = (2 * reference) / SQRT3
  /** A point's place round the hexagon of the reference track, clockwise from the start of the east wall. */
  const perimeter = (p: Point) => {
    const w = wallAt(p)
    return CYCLE.indexOf(w) * side + side / 2 + dot(p, wallFrame(w).dir)
  }
  const nominal = apart.map((l) => {
    const leave = faceAt(l.port, l.port.wall, -1, l.portSpan.u)
    const enter = faceAt(l.useCase, l.useCase.wall, 1, l.useSpan.u)
    const [hop, land] = [hexHit(leave, { x: -l.pf.n.x, y: -l.pf.n.y }, reference), hexHit(enter, l.uf.n, reference)]
    const [from, to] = [perimeter(hop), perimeter(land)]
    const sameWall = wallAt(hop) === wallAt(land)
    const clockwise = sameWall ? to > from : arcBetween(wallAt(hop), wallAt(land)).clockwise
    return { from, to, sameWall, clockwise }
  })
  /** Does the run of link `a` pass over position `s` on the hexagon? */
  const passes = (a: number, s: number) => {
    const { from, to, sameWall, clockwise } = nominal[a]
    if (sameWall) return s > Math.min(from, to) + EPS && s < Math.max(from, to) - EPS
    const [start, end] = clockwise ? [from, to] : [to, from]
    const x = mod(s - start, 6 * side)
    return x > EPS && x < mod(end - start, 6 * side) - EPS
  }
  // A track that runs outside another is crossed by that one's hop out of its port; one that runs inside it, by that
  // one's hop into its use case.
  const cost = apart.map((_, i) => apart.map((__, j) => (i === j ? 0 : Number(passes(i, nominal[j].from)) + Number(passes(j, nominal[i].to)))))
  const order = minimiseCrossings(cost)
  const rank = apart.map((_, i) => order.indexOf(i))

  // Where each link enters its use case. Links from the low end of the wall come in below those from the high end,
  // and a straight run in between keeps its own place, drawn in far enough from either end for the entries that need
  // the room; each side nests, so no hop meets another's run.
  const faceOf = (span: Span): [number, number] => (span.u - span.reach + INSET <= span.u + span.reach - INSET ? [span.u - span.reach + INSET, span.u + span.reach - INSET] : [span.u, span.u])
  const entry = new Map<number, number>()
  const byUseCase = new Map<Placed, { low: number[]; high: number[]; straight: number[] }>()
  const groupOf = (useCase: Placed) => {
    const group = byUseCase.get(useCase) ?? { low: [], high: [], straight: [] }
    byUseCase.set(useCase, group)
    return group
  }
  apart.forEach((l, i) => groupOf(l.useCase)[nominal[i].clockwise ? 'low' : 'high'].push(i))
  for (const l of links) {
    if (!l.window) continue
    const group = groupOf(l.useCase)
    const [lo, hi] = faceOf(l.useSpan)
    const [from, to] = [Math.max(l.window[0], lo + group.low.length * TRACK_GAP), Math.min(l.window[1], hi - group.high.length * TRACK_GAP)]
    const u = Math.min(Math.max(l.portSpan.u, l.window[0]), l.window[1])
    const at = from <= to ? Math.min(Math.max(u, from), to) : u
    group.straight.push(at)
    const face = faceAt(l.port, l.port.wall, -1, at)
    paths[l.index] = [face, enterBox(l.useCase, face, { x: -l.pf.n.x, y: -l.pf.n.y })]
  }
  for (const group of byUseCase.values()) {
    const span = apart[group.low[0] ?? group.high[0]]?.useSpan
    if (!span) continue
    const [lo, hi] = faceOf(span)
    const low = group.low.sort((a, b) => rank[b] - rank[a])
    const high = group.high.sort((a, b) => rank[a] - rank[b])
    const lay = (items: number[], from: number, to: number) =>
      items.forEach((item, k) => entry.set(item, items.length > 1 ? from + ((to - from) * k) / (items.length - 1) : (from + to) / 2))
    if (group.straight.length) {
      // Entries stay on the face: a straight run too near an end leaves the links on that side less than a gap, not past the box.
      const end = Math.max(lo, Math.min(Math.min(...group.straight) - TRACK_GAP, hi))
      lay(low, Math.max(lo, end - (low.length - 1) * TRACK_GAP), end)
      const start = Math.min(hi, Math.max(Math.max(...group.straight) + TRACK_GAP, lo))
      lay(high, start, Math.min(hi, start + (high.length - 1) * TRACK_GAP))
    } else {
      const items = [...low, ...high]
      const width = Math.min((items.length - 1) * TRACK_GAP, hi - lo)
      const centre = Math.min(Math.max(span.u, lo + width / 2), hi - width / 2)
      lay(items, centre - width / 2, centre + width / 2)
    }
  }

  const tracks = apart.map((l, i) => {
    const apothem = outer - rank[i] * TRACK_GAP
    const leave = faceAt(l.port, l.port.wall, -1, l.portSpan.u)
    const enter = faceAt(l.useCase, l.useCase.wall, 1, entry.get(i) ?? l.useSpan.u)
    const [hop, land] = [hexHit(leave, { x: -l.pf.n.x, y: -l.pf.n.y }, apothem), hexHit(enter, l.uf.n, apothem)]
    return { l, rank: rank[i], apothem, leave, enter, hop, land, walls: [wallAt(hop), wallAt(land)] as const }
  })
  for (const t of tracks) paths[t.l.index] = dedupe([t.leave, t.hop, ...around(...t.walls, t.apothem, Infinity), t.land, t.enter])
  return paths
}
