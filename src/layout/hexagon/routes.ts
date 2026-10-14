import { SideSchema, type Diagram, type Side, type Wall } from '../../model/schema'
import { dedupe, dot, enterBox, reach, type Point } from '../geometry'
import type { LayoutEdge, LayoutNode } from '../layout'
import { COS30, SQRT3, type Outline } from '../outline'
import { EDGE_LABEL, measure } from '../text'
import type { BoxPlan } from './columns'
import { GAP, LANE, OUTSIDE_GAP } from './spacing'
import { faceAt, laneFoot, toLane, type UseCaseSeating } from './useCaseSeating'
import { SLANTED_WALLS, VERTEX, wallFrame } from './walls'

/** The composition trunk hugs the outer hexagon this far out. */
const TRUNK_GAP = OUTSIDE_GAP / 2

/** The walls in the order they come round the hexagon: neighbours share a vertex, wall i and i + 1 the one at VERTEX[(i + 2) % 6]. */
const WALL_CYCLE: Wall[] = ['e', 'se', 'sw', 'w', 'nw', 'ne']
/**
 * The corners of a hexagon of circumradius `r` passed going from wall `from` round to wall `to` the shorter way. The
 * domain title sits in the top corner, so a run over it ducks to `underTitle` below the top, for the width of that corner.
 */
const around = (from: Wall, to: Wall, r: number, underTitle: number): Point[] => {
  const [a, b] = [WALL_CYCLE.indexOf(from), WALL_CYCLE.indexOf(to)]
  const clockwise = (b - a + 6) % 6
  const [steps, sign] = clockwise <= 3 ? [clockwise, 1] : [6 - clockwise, -1]
  return Array.from({ length: steps }, (_, k) => ((sign > 0 ? a + k : a - k - 1) + 8) % 6).flatMap((vertex) => {
    if (vertex !== 0) return [{ x: VERTEX[vertex].x * r, y: VERTEX[vertex].y * r }]
    const half = (r - underTitle) * SQRT3
    return sign > 0 ? [{ x: -half, y: -underTitle }, { x: half, y: -underTitle }] : [{ x: half, y: -underTitle }, { x: -half, y: -underTitle }]
  })
}

export interface RouteInput {
  d: Diagram
  overview: boolean
  nodes: LayoutNode[]
  /** The composition root node, when one is drawn. */
  composition: LayoutNode | undefined
  plan: BoxPlan
  insideApp: Outline
  /** The domain model region inside `insideApp`, and the face of it each domain root sits on. */
  region: Outline
  faces: ReadonlyMap<string, Wall>
  outer: Outline
  seating: UseCaseSeating
}

/** Every edge of the diagram: each planned import, the use cases' asks into the domain and the composition trunks. */
export function routeEdges({ d, overview, nodes, composition, plan, insideApp, region, faces, outer, seating }: RouteInput): LayoutEdge[] {
  const { edgePlan } = plan
  const { laneX } = seating
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const faceX = (n: LayoutNode, towardX: number) => n.x + (Math.sign(towardX - n.x) * n.width) / 2

  /** Side-by-side boxes: one straight run where their heights overlap, otherwise a Z with a mid-gap elbow. */
  const horizontal = (a: LayoutNode, b: LayoutNode): Point[] => {
    const ax = faceX(a, b.x)
    const bx = faceX(b, a.x)
    const low = Math.max(a.y - a.height / 2, b.y - b.height / 2) + 4
    const high = Math.min(a.y + a.height / 2, b.y + b.height / 2) - 4
    if (low <= high) {
      const y = Math.min(Math.max(a.y, low), high)
      return [{ x: ax, y }, { x: bx, y }]
    }
    const mx = (ax + bx) / 2
    return [{ x: ax, y: a.y }, { x: mx, y: a.y }, { x: mx, y: b.y }, { x: bx, y: b.y }]
  }

  /** The x of the bus lane a use case takes to this socket's side. */
  const laneOf = (useCase: LayoutNode, socket: LayoutNode) =>
    laneX(socket.side ?? 'driven', d.useCases.findIndex((u) => `useCase:${u.id}` === useCase.key), insideApp.halfWidth)
  /** Use case → bus → socket: sideways out of the use case, down its lane, then straight into the socket. */
  const busRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const lane = laneOf(useCase, socket)
    return dedupe([...toLane(useCase, lane, insideApp.apex, socket.y), { x: lane, y: socket.y }, { x: socket.x - (Math.sign(lane) * socket.width) / 2, y: socket.y }])
  }

  const slantedWall = (n: LayoutNode) => (n.wall && SLANTED_WALLS.has(n.wall) ? n.wall : undefined)
  /**
   * Slanted walls: socket, adapter and endpoint connect along the wall normal, on the outer box's lane or the nearest
   * lane both boxes share, so each run is perpendicular to the wall and every box stays upright. Boxes that share no
   * lane (a port with several adapters) fall back to axis-aligned runs.
   */
  const alongNormal = (a: LayoutNode, b: LayoutNode): Point[] => {
    const wall = slantedWall(a) ?? slantedWall(b)!
    const { n, dir } = wallFrame(wall)
    const [outerBox, innerBox] = dot(a, n) > dot(b, n) ? [a, b] : [b, a]
    const [outerU, innerU] = [dot(outerBox, dir), dot(innerBox, dir)]
    const [outerR, innerR] = [reach(outerBox.width, outerBox.height, dir), reach(innerBox.width, innerBox.height, dir)]
    const lo = Math.max(outerU - outerR, innerU - innerR) + 4
    const hi = Math.min(outerU + outerR, innerU + innerR) - 4
    if (lo > hi) return horizontal(a, b)
    const u = Math.min(Math.max(outerU, lo), hi)
    const exit = faceAt(outerBox, wall, -1, u)
    const entry = faceAt(innerBox, wall, 1, u)
    return a === outerBox ? [exit, entry] : [entry, exit]
  }

  /** Use case → bus → slanted socket: out of the use case, along its lane, then along the wall normal. */
  const slantedBusRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const lane = laneOf(useCase, socket)
    const { dir } = wallFrame(socket.wall!)
    const q = faceAt(socket, socket.wall!, -1, dot(socket, dir))
    const foot = laneFoot(q, socket.wall!, lane)
    return dedupe([...toLane(useCase, lane, insideApp.apex, foot.y), foot, q])
  }

  /** A use case seated on its port's wall meets the socket straight along the wall normal, where the two overlap. */
  const directRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] | undefined => {
    if (!useCase.wall || useCase.wall !== socket.wall) return undefined
    const { n, dir } = wallFrame(socket.wall)
    const [su, sa, uu, ua] = [dot(socket, dir), reach(socket.width, socket.height, dir), dot(useCase, dir), reach(useCase.width, useCase.height, dir)]
    const lo = Math.max(su - sa, uu - ua) + 4
    const hi = Math.min(su + sa, uu + ua) - 4
    if (lo > hi) return undefined
    const face = faceAt(socket, socket.wall, -1, Math.min(Math.max(su, lo), hi))
    return [enterBox(useCase, face, { x: -n.x, y: -n.y }), face]
  }

  const labelled = new Set<string>()
  const edges: LayoutEdge[] = edgePlan.map(([fromKey, toKey, label]) => {
    const a = byKey.get(fromKey)!
    const b = byKey.get(toKey)!
    const useCase = [a, b].find((n) => n.kind === 'useCase')
    const socket = [a, b].find((n) => n.kind === 'port')
    const straight = useCase && socket ? directRoute(useCase, socket) : undefined
    const route = useCase && socket ? (straight ?? (slantedWall(socket) ? slantedBusRoute(useCase, socket) : busRoute(useCase, socket))) : undefined
    const direct = slantedWall(a) || slantedWall(b) ? alongNormal(a, b) : horizontal(a, b)
    const points = route ? (a === useCase ? route : [...route].reverse()) : direct
    const edge: LayoutEdge = { key: `${fromKey}->${toKey}`, kind: 'import', points }
    // Every edge of a lane shares its exit run, so the verb is written once, flat above that run.
    if (label && straight) {
      // Written flat beside the short run, clear of it along the wall.
      const { dir } = wallFrame(socket!.wall!)
      const mid = { x: (straight[0].x + straight[1].x) / 2, y: (straight[0].y + straight[1].y) / 2 }
      const off = reach(measure(label, EDGE_LABEL), EDGE_LABEL.size + 4, dir) + 4
      edge.label = label
      edge.labelAt = { x: mid.x + dir.x * off, y: mid.y + dir.y * off }
      return edge
    }
    const lane = `${useCase?.key}:${socket?.side}`
    if (label && route && !labelled.has(lane)) {
      labelled.add(lane)
      edge.label = label
      // Over the leg that crosses to the lane: every bus route ends lane head, lane foot, socket.
      const from = Math.max(0, route.length - 4)
      const [a, b] = route.slice(from, from + 2)
      edge.labelAt = { x: (a.x + b.x) / 2, y: a.y - 10 }
    }
    return edge
  })

  /** The point at `depth` along a wall's normal and `u` along the wall. */
  const onWall = (wall: Wall, depth: number, u: number) => {
    const { n, dir } = wallFrame(wall)
    return { x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }
  }
  // Use cases arriving at one card each keep a lane of their own across its face.
  const arrivals = new Map<string, string[]>()
  for (const u of d.useCases) for (const id of new Set(u.aggregateIds)) if (byKey.get(`aggregate:${id}`)) arrivals.set(id, [...(arrivals.get(id) ?? []), u.id])
  /**
   * Use case → card: straight along the wall normal where the two overlap on one wall; otherwise in to the corridor
   * halfway through the domain ring, round it to the card's wall, and straight in along that wall's normal.
   */
  const toCard = (useCase: LayoutNode, card: LayoutNode, offset: number): Point[] => {
    // Every route's first run is straight in along the use case's wall normal; its second point is where that run crosses the domain ring.
    const enter = (u: number) => [faceAt(useCase, from, -1, u), onWall(from, insideApp.halfWidth, u)]
    const [from, to] = [useCase.wall!, faces.get(card.ref)!]
    const [{ dir }, { dir: cardDir }] = [wallFrame(from), wallFrame(to)]
    const [cu, ca] = [dot(card, cardDir), reach(card.width, card.height, cardDir)]
    const [uu, ua] = [dot(useCase, dir), reach(useCase.width, useCase.height, dir)]
    const lane = (lo: number, hi: number) => Math.min(Math.max(cu + offset, lo), hi)
    if (from === to) {
      const [lo, hi] = [Math.max(cu - ca, uu - ua) + 4, Math.min(cu + ca, uu + ua) - 4]
      if (lo <= hi) return [...enter(lane(lo, hi)), faceAt(card, to, 1, lane(lo, hi))]
    }
    const depth = (insideApp.halfWidth + region.halfWidth) / 2
    const u = lane(cu - ca + 4, cu + ca - 4)
    return dedupe([...enter(uu), onWall(from, depth, uu), ...around(from, to, depth / COS30, region.apex + GAP / 2), onWall(to, depth, u), faceAt(card, to, 1, u)])
  }

  // A use case asks the aggregates it names, each at its card, and otherwise along its sector's bisector: in along
  // the wall normal, square onto the domain's matching wall. Level with that wall it runs straight; past its end it
  // steps along the wall first, just outside the domain.
  for (const node of overview ? [] : nodes.filter((n) => n.kind === 'useCase' && n.wall)) {
    const named = [...new Set(d.useCases.find((u) => u.id === node.ref)!.aggregateIds)].filter((id) => byKey.has(`aggregate:${id}`))
    if (named.length) {
      for (const id of named) {
        const lanes = arrivals.get(id)!
        const offset = (lanes.indexOf(node.ref) - (lanes.length - 1) / 2) * LANE
        edges.push({ key: `${node.key}->aggregate:${id}`, kind: 'import', points: toCard(node, byKey.get(`aggregate:${id}`)!, offset), intoDomain: 1 })
      }
      continue
    }
    const { n, dir } = wallFrame(node.wall!)
    const at = (depth: number, u: number) => ({ x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u })
    const half = insideApp.apex / 2 - LANE
    const [uu, ua] = [dot(node, dir), reach(node.width, node.height, dir)]
    const [lo, hi] = [Math.max(uu - ua + 4, -half), Math.min(uu + ua - 4, half)]
    const u = Math.min(Math.max(uu, lo), hi)
    const target = at(insideApp.halfWidth, lo <= hi ? u : Math.sign(uu) * half)
    const points =
      lo <= hi
        ? [enterBox(node, target, n), target]
        : [enterBox(node, at(insideApp.halfWidth, uu), n), at(insideApp.halfWidth + LANE, uu), at(insideApp.halfWidth + LANE, Math.sign(uu) * half), target]
    edges.push({ key: `${node.key}->domain`, kind: 'import', points })
  }

  if (composition) {
    // One trunk per side hugging the outer ring, just inside the endpoints. Each branch runs in along its wall's
    // normal to the adapter's outer face, a quarter of the box off the endpoint arrow, so it meets no box.
    const r = outer.apex + TRUNK_GAP / COS30
    const vertex = (k: number) => ({ x: r * VERTEX[k].x, y: r * VERTEX[k].y })
    const rootTop = { x: 0, y: composition.y - composition.height / 2 }
    const walls: Record<Side, Wall[]> = { driving: ['sw', 'w', 'nw'], driven: ['se', 'e', 'ne'] }
    const vertices: Record<Side, number[]> = { driving: [3, 4, 5, 0], driven: [3, 2, 1, 0] }
    for (const side of SideSchema.options) {
      const adapters = nodes.filter((n) => n.kind === 'adapter' && n.side === side && n.wall)
      if (!adapters.length) continue
      const reachWall = Math.max(...adapters.map((a) => walls[side].indexOf(a.wall!)))
      edges.push({
        key: `composition->trunk:${side}`,
        kind: 'wiring',
        points: dedupe([rootTop, ...vertices[side].slice(0, reachWall + 2).map(vertex)]),
      })
      for (const a of adapters) {
        const { n, dir } = wallFrame(a.wall!)
        const lateral = reach(a.width, a.height, dir) / 2
        const onLane = { x: a.x + dir.x * lateral, y: a.y + dir.y * lateral }
        const trunkDepth = outer.halfWidth + TRUNK_GAP
        const start = { x: onLane.x + n.x * (trunkDepth - dot(onLane, n)), y: onLane.y + n.y * (trunkDepth - dot(onLane, n)) }
        edges.push({ key: `composition->${a.key}`, kind: 'wiring', points: [start, enterBox(a, start, { x: -n.x, y: -n.y })] })
      }
    }
  }
  return edges
}
