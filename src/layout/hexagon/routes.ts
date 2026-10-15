import { SideSchema, type Side, type Wall } from '../../model/schema'
import { dedupe, dot, enterBox, reach, type Point } from '../geometry'
import type { LayoutEdge, LayoutNode } from '../layout'
import { COS30, SQRT3 } from '../outline'
import { EDGE_LABEL, measure } from '../text'
import { corridorHalf, MARGIN } from './bands'
import { onWall, travel } from './corridors'
import type { Layer, Pair } from './elements'
import { LANE, OUTSIDE_GAP, TRACK_GAP } from './spacing'
import { VERTEX, wallFrame } from './walls'

const T30 = 1 / SQRT3
/** A run shorter than this is taken for the same line. */
const SAME = 0.5

/** A box as the router sees it: its wall, layer and place along the wall, before any ring has a size. */
export interface Terminal {
  wall: Wall
  layer: Layer
  u: number
  width: number
  height: number
  /** Where its centre lies along the wall normal when no ring sets it (a card in the domain model, the domain itself). */
  depth?: number
}

/** One connection between two terminals, the lateral offset it keeps on each, and the corridor it runs in if it needs one. */
export interface Hop {
  pair: Pair
  a: Terminal
  b: Terminal
  la: number
  lb: number
  /** The corridor between the layers it joins, counted from the innermost. */
  corridor: number
  run: boolean
}

/**
 * Every pair as a hop. Threads touching one box enter it side by side, TRACK_GAP apart in thread order, and keep that
 * offset on whichever face they use, so a thread meets its box at the same point coming in and going out. A hop needs a
 * track only when its ends are not already on one line along the wall normal.
 */
export function planHops(pairs: Pair[], terminals: ReadonlyMap<string, Terminal>, rank: (owner: string) => number, core: number): Hop[] {
  const touching = new Map<string, string[]>()
  for (const p of pairs)
    for (const key of [p.from, p.to]) if (terminals.has(key)) touching.set(key, [...new Set([...(touching.get(key) ?? []), p.owner])].sort((x, y) => rank(x) - rank(y)))
  const lateral = (key: string, owner: string) => {
    const owners = touching.get(key)!
    return (owners.indexOf(owner) - (owners.length - 1) / 2) * TRACK_GAP
  }
  return pairs.map((pair) => {
    const a = terminals.get(pair.from)!
    const la = lateral(pair.from, pair.owner)
    // The domain itself has no box: the arrow runs in along its own line to the region's wall, or as near as the wall reaches.
    const limit = core * T30 - LANE
    const b = pair.to === 'domain' ? { wall: a.wall, layer: 0 as Layer, u: Math.max(-limit, Math.min(limit, a.u + la)), width: 0, height: 0, depth: core } : terminals.get(pair.to)!
    const lb = pair.to === 'domain' ? 0 : lateral(pair.to, pair.owner)
    const run = a.wall !== b.wall || Math.abs(a.u + la - (b.u + lb)) > SAME
    return { pair, a, b, la, lb, corridor: Math.min(a.layer, b.layer), run }
  })
}

/** The threads that have a run in each corridor, in thread order. */
export function trackOwners(hops: Hop[], rank: (owner: string) => number): string[][] {
  return [0, 1, 2, 3].map((c) => [...new Set(hops.filter((h) => h.run && h.corridor === c).map((h) => h.pair.owner))].sort((x, y) => rank(x) - rank(y)))
}

export interface RouteInput {
  hops: Hop[]
  /** The wall apothems, innermost first: the domain model, domain, application, infrastructure, external systems. */
  radii: number[]
  owners: string[][]
  nodes: LayoutNode[]
  composition: LayoutNode | undefined
}

/** The corridor's centre line: halfway through its band. */
export const corridorCentre = (radii: number[], corridor: number) => (radii[corridor] + radii[corridor + 1]) / 2

/**
 * Every edge of the diagram. A hop leaves its box square to the wall, at the box's lateral offset, runs along the
 * hexagon of its track (the thread's own, spread evenly about the middle of the band) the shorter way round, and
 * enters the next box square to its wall.
 */
export function routeEdges({ hops, radii, owners, nodes, composition }: RouteInput): LayoutEdge[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const centreOf = (t: Terminal) => onWall(t.wall, t.depth ?? radii[t.layer], t.u)
  /** Where a line along the wall normal at lateral `l` meets the face of the box looking `sign` (-1 in, +1 out). */
  const face = (t: Terminal, l: number, sign: 1 | -1): Point => {
    const { n, dir } = wallFrame(t.wall)
    const c = centreOf(t)
    const through = Math.min(Math.abs(n.x) > 1e-9 ? t.width / 2 / Math.abs(n.x) : Infinity, Math.abs(n.y) > 1e-9 ? t.height / 2 / Math.abs(n.y) : Infinity)
    return { x: c.x + dir.x * l + n.x * sign * through, y: c.y + dir.y * l + n.y * sign * through }
  }

  const labelled = new Set<string>()
  const edges = hops.map(({ pair, a, b, la, lb, corridor, run }): LayoutEdge => {
    const start = face(a, la, b.layer < a.layer ? -1 : 1)
    const end = face(b, lb, a.layer < b.layer ? -1 : 1)
    let points: Point[]
    if (run) {
      const index = owners[corridor].indexOf(pair.owner)
      const at = corridorCentre(radii, corridor) + (index - (owners[corridor].length - 1) / 2) * TRACK_GAP
      points = dedupe([start, ...travel(a.wall, a.u + la, b.wall, b.u + lb, at), end])
    } else {
      points = [start, face(b, a.u + la - b.u, a.layer < b.layer ? -1 : 1)]
    }
    const edge: LayoutEdge = { key: pair.key, kind: 'import', from: pair.fromRef, ...(pair.toRef ? { to: pair.toRef } : {}), points, ...(b.layer === 0 ? { intoDomain: 0 } : {}) }
    if (!pair.label) return edge
    edge.label = pair.label
    const port = a.layer === 2 ? a : b
    if (points.length === 2) {
      // Written flat beside the short run, clear of it along the wall.
      const { dir } = wallFrame(port.wall)
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      const off = reach(measure(pair.label, EDGE_LABEL), EDGE_LABEL.size + 4, dir) + 4
      edge.labelAt = { x: mid.x + dir.x * off, y: mid.y + dir.y * off }
      return edge
    }
    // The verb is written once per use case and side, flat beside the longest stretch of the first run.
    const lane = `${pair.owner}:${byKey.get(a.layer === 2 ? pair.from : pair.to)!.side}`
    if (labelled.has(lane)) {
      delete edge.label
      return edge
    }
    labelled.add(lane)
    const [from, to] = points.slice(1).map((q, i) => [points[i], q]).reduce((longest, seg) => (Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y) > Math.hypot(longest[1].x - longest[0].x, longest[1].y - longest[0].y) ? seg : longest))
    const len = Math.hypot(to.x - from.x, to.y - from.y)
    const toward = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len }
    const side = toward.y > 1e-9 || (Math.abs(toward.y) <= 1e-9 && toward.x < 0) ? -1 : 1
    const off = reach(measure(pair.label, EDGE_LABEL), EDGE_LABEL.size + 4, toward) + 4
    edge.labelAt = { x: (from.x + to.x) / 2 + side * toward.x * off, y: (from.y + to.y) / 2 + side * toward.y * off }
    return edge
  })
  const leavesOf = new Map<string, string[]>()
  for (const { pair, a, b } of hops) {
    const ends = a.layer === 3 && b.layer === 4 ? { adapter: pair.from, leaf: pair.to } : a.layer === 4 && b.layer === 3 ? { adapter: pair.to, leaf: pair.from } : undefined
    if (ends) leavesOf.set(ends.adapter, [...(leavesOf.get(ends.adapter) ?? []), ends.leaf])
  }
  if (composition) edges.push(...wiring(nodes, composition, radii, owners, leavesOf))
  return edges
}

/** The composition trunk hugs the external systems this far out. */
const TRUNK_GAP = OUTSIDE_GAP / 2

/**
 * One trunk per side hugging the outermost wall, just outside the endpoints. Each branch runs in along its wall's
 * normal to the adapter's outer face. An adapter with endpoints is reached past the end of its chain, then along the
 * free margin outside the external corridor, then in at the adapter's own end, so no branch crosses an endpoint.
 */
function wiring(nodes: LayoutNode[], composition: LayoutNode, radii: number[], owners: string[][], leavesOf: ReadonlyMap<string, string[]>): LayoutEdge[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const edges: LayoutEdge[] = []
  const farthest = Math.max(radii[4], ...nodes.filter((n) => n.wall && (n.kind === 'actor' || n.kind === 'external')).map((n) => dot(n, wallFrame(n.wall!).n) + reach(n.width, n.height, wallFrame(n.wall!).n)))
  const trunkDepth = farthest + TRUNK_GAP
  const r = trunkDepth / COS30
  const vertex = (k: number) => ({ x: r * VERTEX[k].x, y: r * VERTEX[k].y })
  const rootTop = { x: 0, y: composition.y - composition.height / 2 }
  const walls: Record<Side, Wall[]> = { driving: ['sw', 'w', 'nw'], driven: ['se', 'e', 'ne'] }
  const vertices: Record<Side, number[]> = { driving: [3, 4, 5, 0], driven: [3, 2, 1, 0] }
  const margin = corridorCentre(radii, 3) + corridorHalf(owners[3].length) + MARGIN / 2
  for (const side of SideSchema.options) {
    const adapters = nodes.filter((n) => n.kind === 'adapter' && n.side === side && n.wall)
    if (!adapters.length) continue
    const reachWall = Math.max(...adapters.map((a) => walls[side].indexOf(a.wall!)))
    edges.push({ key: `composition->trunk:${side}`, kind: 'wiring', points: dedupe([rootTop, ...vertices[side].slice(0, reachWall + 2).map(vertex)]) })
    for (const a of adapters) {
      const { n, dir } = wallFrame(a.wall!)
      const [u, half] = [dot(a, dir), reach(a.width, a.height, dir)]
      const leaves = (leavesOf.get(a.key) ?? []).map((k) => byKey.get(k)!)
      const end = Math.max(u + half, ...leaves.map((l) => dot(l, dir) + reach(l.width, l.height, dir)))
      const lane = u + half - 6
      const mouth = enterBox(a, onWall(a.wall!, dot(a, n) + reach(a.width, a.height, n) + 1, lane), { x: -n.x, y: -n.y })
      const points = leaves.length
        ? [onWall(a.wall!, trunkDepth, end + 7), onWall(a.wall!, margin, end + 7), onWall(a.wall!, margin, lane), mouth]
        : [onWall(a.wall!, trunkDepth, lane), mouth]
      edges.push({ key: `composition->${a.key}`, kind: 'wiring', points })
    }
  }
  return edges
}
