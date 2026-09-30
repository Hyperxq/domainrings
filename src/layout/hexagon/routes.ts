import { HEXAGONAL_KIND } from '../../model/kinds'
import { SideSchema, type Diagram, type Side, type Wall } from '../../model/schema'
import { dedupe, dot, enterBox, reach, type Point } from '../geometry'
import type { LayoutEdge, LayoutNode } from '../layout'
import { COS30, halfWidthAt, type Outline } from '../outline'
import { EDGE_LABEL, measure } from '../text'
import { COLUMN_GAP, LANE, OUTSIDE_GAP } from './spacing'
import { SLANTED_WALLS, VERTEX, wallFrame } from './walls'

/** The composition trunk hugs the outer hexagon this far out. */
const TRUNK_GAP = OUTSIDE_GAP / 2

/**
 * Lane ranks (0 = innermost) for links that leave at row `from` and arrive at row `to`, chosen so no link's
 * vertical run crosses another link's horizontal runs; clashing constraints fall back to input order.
 */
function laneOrder(spans: Array<[number, number]>): number[] {
  const within = (y: number, [a, b]: [number, number]) => Math.min(a, b) < y && y < Math.max(a, b)
  // outside[i]: links that must run further out than link i.
  const outside = spans.map((si, i) =>
    new Set(spans.flatMap((sj, j) => (i !== j && within(si[0], sj) ? [j] : []))),
  )
  spans.forEach((si, i) => spans.forEach((sj, j) => i !== j && within(si[1], sj) && outside[j].add(i)))
  const order: number[] = []
  while (order.length < spans.length) {
    const free = spans.findIndex((_, i) => !order.includes(i) && spans.every((_, j) => order.includes(j) || !outside[j].has(i)))
    order.push(free >= 0 ? free : spans.findIndex((_, i) => !order.includes(i)))
  }
  return spans.map((_, i) => order.indexOf(i))
}

/** How the use cases sit in the application ring, as far as their runs to the sockets need. */
export interface RouteSeating {
  /** Indices into `d.useCases` of the use cases stacked under the application title. */
  stack: number[]
  /** Width of the stacked use cases' widest box. */
  blockWidth: number
  laneX: (side: Side, k: number, innerHalfWidth: number) => number
  toLane: (box: { x: number; y: number; width: number; height: number; seated: boolean }, lane: number, insideApex: number, portY: number) => Point[]
  laneFoot: (face: Point, wall: Wall, lane: number) => Point
}

export interface RouteInput {
  d: Diagram
  overview: boolean
  nodes: LayoutNode[]
  edgePlan: Array<[string, string, string?]>
  app: Outline
  insideApp: Outline
  domain: Outline
  outer: Outline
  seating: RouteSeating
}

/** Every edge of the diagram: each planned import, the use cases' asks into the domain, the domain's port declarations and the composition trunks. */
export function routeEdges({ d, overview, nodes, edgePlan, app, insideApp, domain, outer, seating: { stack, blockWidth, laneX, toLane, laneFoot } }: RouteInput): LayoutEdge[] {
  const { labels } = HEXAGONAL_KIND
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

  /** Use case → bus → socket: sideways out of the use case, down its lane, then straight into the socket. */
  /** Use case to the head of its bus lane for this socket's side (see toLane). */
  const laneHead = (useCase: LayoutNode, socket: LayoutNode) => {
    const side = socket.side ?? 'driven'
    const lane = laneX(side, d.useCases.findIndex((u) => `useCase:${u.id}` === useCase.key), insideApp.halfWidth)
    return toLane({ ...useCase, seated: !!useCase.wall }, lane, insideApp.apex, socket.y)
  }
  const busRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const head = laneHead(useCase, socket)
    const lane = head.at(-1)!.x
    return [...head, { x: lane, y: socket.y }, { x: socket.x - (Math.sign(lane) * socket.width) / 2, y: socket.y }]
  }

  const slantedWall = (n: LayoutNode) => (n.wall && SLANTED_WALLS.has(n.wall) ? n.wall : undefined)
  /** A point on a socket's inner (−1) or outer (+1) face, at lane u along its wall. */
  const socketFace = (socket: LayoutNode, face: 1 | -1, u: number) => {
    const { n, dir } = wallFrame(socket.wall!)
    const depth = app.halfWidth + (face * socket.height) / 2
    return { x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }
  }

  /**
   * Slanted walls: socket, adapter and endpoint connect along the wall normal, on the lane of the outer box of the
   * pair, so each run is perpendicular to the wall and every box stays upright.
   */
  const alongNormal = (a: LayoutNode, b: LayoutNode): Point[] => {
    const wall = slantedWall(a) ?? slantedWall(b)!
    const { n, dir } = wallFrame(wall)
    const [outerBox, innerBox] = dot(a, n) > dot(b, n) ? [a, b] : [b, a]
    const back = { x: -n.x, y: -n.y }
    const exit = enterBox(outerBox, { x: outerBox.x + back.x * 1e4, y: outerBox.y + back.y * 1e4 }, n)
    const entry = innerBox.kind === 'port' ? socketFace(innerBox, 1, dot(outerBox, dir)) : enterBox(innerBox, exit, back)
    return a === outerBox ? [exit, entry] : [entry, exit]
  }

  /** Use case → bus → slanted socket: out of the use case, along its lane, then along the wall normal. */
  const slantedBusRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] => {
    const head = laneHead(useCase, socket)
    const lane = head.at(-1)!.x
    const { dir } = wallFrame(socket.wall!)
    const q = socketFace(socket, -1, dot(socket, dir))
    return [...head, laneFoot(q, socket.wall!, lane), q]
  }

  /** A use case seated on its port's wall meets the socket straight along the wall normal, where the two overlap. */
  const directRoute = (useCase: LayoutNode, socket: LayoutNode): Point[] | undefined => {
    if (!useCase.wall || useCase.wall !== socket.wall) return undefined
    const { n, dir } = wallFrame(socket.wall)
    const [length, thickness] = SLANTED_WALLS.has(socket.wall) ? [socket.width, socket.height] : [socket.height, socket.width]
    const [su, uu, ua] = [dot(socket, dir), dot(useCase, dir), reach(useCase.width, useCase.height, dir)]
    const lo = Math.max(su - length / 2, uu - ua) + 4
    const hi = Math.min(su + length / 2, uu + ua) - 4
    if (lo > hi) return undefined
    const u = Math.min(Math.max(su, lo), hi)
    const depth = dot(socket, n) - thickness / 2
    const face = { x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }
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
      const [a, b] = route.slice(-4, -2)
      edge.labelAt = { x: (a.x + b.x) / 2, y: a.y - 10 }
    }
    return edge
  })

  // Use case → domain: the lowest use case drops straight onto the top of the ring it asks; use cases stacked
  // above it leave sideways, run down beside the stack and merge into that same final run.
  const useCaseNodes = stack.map((i) => byKey.get(`useCase:${d.useCases[i].id}`)!)
  const lowest = useCaseNodes.at(-1)
  if (lowest && !overview) {
    const target = { x: 0, y: -insideApp.apex }
    const start = lowest.y + lowest.height / 2
    const merge = (start + target.y) / 2
    const beside = -(blockWidth / 2 + LANE)
    for (const u of useCaseNodes) {
      const exitY = u.y + u.height / 4
      const edge: LayoutEdge = {
        key: `${u.key}->domain`,
        kind: 'import',
        points:
          u === lowest
            ? [{ x: 0, y: start }, target]
            : [{ x: u.x - u.width / 2, y: exitY }, { x: beside, y: exitY }, { x: beside, y: merge }, { x: 0, y: merge }, target],
      }
      if (u === lowest) {
        edge.label = labels.asks
        edge.labelAt = { x: -8 - measure(labels.asks, EDGE_LABEL) / 2, y: (start + target.y) / 2 }
      }
      edges.push(edge)
    }
  }

  // A seated use case asks along its sector's bisector: in along the wall normal, square onto the domain's matching
  // wall. Level with that wall it runs straight; past its end it steps along the wall first, just outside the domain.
  for (const node of overview ? [] : nodes.filter((n) => n.kind === 'useCase' && n.wall)) {
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

  // Ownership: each driven port declared in the domain links to its socket. Each link gets its own lane between
  // the domain and the bus, and meets the socket a quarter-height below the use-case branch so the two never merge.
  // A declaration in the left column first drops to its row boundary, so it passes between right-column names.
  const declarations = nodes.filter((n) => n.kind === 'portDecl')
  const twoColumns = declarations.some((n) => n.x < 0) && declarations.some((n) => n.x > 0)
  const columnGap = Math.max(-Infinity, ...declarations.filter((n) => n.x < 0).map((n) => n.x + n.width / 2)) + COLUMN_GAP / 2
  const links = declarations.map((declaration) => {
    const socket = byKey.get(`port:${declaration.ref}`)!
    const detour = twoColumns && declaration.x < 0
    const start = { x: declaration.x + declaration.width / 2, y: declaration.y }
    const exitY = detour ? declaration.y + declaration.height / 2 : declaration.y
    const head = detour ? [start, { x: columnGap, y: start.y }, { x: columnGap, y: exitY }] : [start]
    // A slanted socket is met along its wall normal, a quarter of its length off-centre (clear of the use-case run).
    const face = slantedWall(socket) ? socketFace(socket, -1, dot(socket, wallFrame(socket.wall!).dir) + socket.width / 4) : undefined
    return { declaration, socket, head, face, from: exitY, to: face ? face.y : socket.y + socket.height / 4 }
  })
  const ranks = laneOrder(links.map((l) => [l.from, l.to]))
  const isInsideDomain = (p: Point) => Math.abs(p.x) <= halfWidthAt(domain, p.y) && Math.abs(p.y) <= domain.apex
  links.forEach(({ declaration, socket, head, face, from, to }, i) => {
    const lane = insideApp.halfWidth + LANE * (ranks[i] + 1)
    const tail = face
      ? (() => {
          const { n } = wallFrame(socket.wall!)
          const reach = (face.x - lane) / n.x
          return [{ x: lane, y: face.y - n.y * reach }, face]
        })()
      : [{ x: lane, y: to }, { x: socket.x - socket.width / 2, y: to }]
    const points = dedupe([...head, { x: lane, y: from }, ...tail])
    // Insert the point where the path leaves the domain fill, found by bisecting the segment that crosses it.
    const crossing = points.findIndex((p, k) => k > 0 && isInsideDomain(points[k - 1]) && !isInsideDomain(p))
    let insideTo: number | undefined
    if (crossing > 0) {
      const [a, b] = [points[crossing - 1], points[crossing]]
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      let [lo, hi] = [0, 1]
      for (let n = 0; n < 50; n++) {
        const mid = (lo + hi) / 2
        if (isInsideDomain(at(mid))) lo = mid
        else hi = mid
      }
      points.splice(crossing, 0, at(lo))
      insideTo = crossing
    }
    edges.push({ key: `${declaration.key}->${socket.key}`, kind: 'declares', points, insideTo })
  })

  if (d.composition && !overview) {
    const root = byKey.get('composition')!
    // One trunk per side hugging the outer ring, just inside the endpoints. Each branch runs in along its wall's
    // normal to the adapter's outer face, a quarter of the box off the endpoint arrow, so it meets no box.
    const r = outer.apex + TRUNK_GAP / COS30
    const vertex = (k: number) => ({ x: r * VERTEX[k].x, y: r * VERTEX[k].y })
    const rootTop = { x: 0, y: root.y - root.height / 2 }
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
