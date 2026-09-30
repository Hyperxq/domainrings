import { HEXAGONAL_KIND } from '../../model/kinds'
import { SideSchema, type Diagram, type Port, type Side, type UseCase, type Wall } from '../../model/schema'
import { dot, hairline, quadsOverlap, rectCorners, type Point } from '../geometry'
import type { Frame, NodeKind, Planned, WallBox } from '../layout'
import { COS30, fitRing, halfWidthAt, hexagon, type Need, type Outline } from '../outline'
import { RING_LABEL } from '../text'
import { DOMAIN_PAD, DOMAIN_RUN, GAP, LABEL_GAP, LABEL_PAD_X, OUTSIDE_GAP, PAD, RUN } from './spacing'
import { sectorApothem, wallAngle, wallFrame } from './walls'

const LABEL_LINE = RING_LABEL.size + 4
const nearest = (y: number, height: number) => Math.max(0, Math.abs(y) - height / 2)
const farthest = (y: number, height: number) => Math.abs(y) + height / 2

interface Sized {
  width: number
  height: number
}

interface WallCorner {
  u: number
  v: number
}

interface Seat {
  i: number
  wall: Wall
  frame: Sized
  u: number
  /** How far in from the wall's sockets the seat starts. */
  inset: number
  across: number
}

type Seated = Seat & { x: number; y: number }

export interface RingSolverInput {
  d: Diagram
  overview: boolean
  /** Index of the application ring in the kind's ring list. */
  appIndex: number
  titles: { titleWidth: (i: number) => number; titleHeight: (i: number) => number; titleDepth: number }
  centre: {
    boxes: { x: number; top: number; frame: Sized }[]
    serviceFrames: Sized[]
    servicesBlock: { width: number; height: number }
    bodyShift: (o: Outline) => number
  }
  columns: {
    ports: Map<string, Port>
    wallOf: (p: Port) => Wall
    planned: Planned[]
    of: (kind: NodeKind) => Planned[]
    widths: Record<Side, { socketHalf: number; adapter: number; leaf: number }>
    wallBoxes: WallBox[]
    hasSlanted: boolean
    sectored: boolean
    localCorners: (b: WallBox) => WallCorner[]
    columnCorners: (kind: NodeKind, v: (p: Planned) => number[]) => WallCorner[]
  }
  frames: { portLabel: (p: Port) => Frame; labelReach: (p: Port) => number }
  seating: {
    stack: number[]
    stackFrames: Sized[]
    useCaseFrames: Sized[]
    useCaseBlock: Sized
    useCaseOffsets: number[]
    busX: (side: Side, k: number, innerHalfWidth: number) => number
    laneX: (side: Side, k: number, innerHalfWidth: number) => number
    socketClearance: (side: Side, innerHalfWidth: number) => number
    seatWall: (u: UseCase) => Wall | undefined
    seats: () => Seat[]
    seatsAt: (appO: Outline) => Seated[]
    useCaseCentres: (appO: Outline, insideO: Outline) => number[]
    toLane: (box: { x: number; y: number; width: number; height: number; seated: boolean }, lane: number, insideApex: number, portY: number) => Point[]
    laneFoot: (face: Point, wall: Wall, lane: number) => Point
    faceOf: (b: WallBox, appO: Outline) => Point
    labelU: (b: WallBox, f: Frame) => number
    portLabels: (appO: Outline) => { x: number; y: number; frame: Sized; rotation: number | undefined }[]
  }
}

/**
 * Every ring's outline, inside-out, and how far the domain body drops below its title: each ring holds its own
 * content, fitted to the real box corners.
 */
export function solveRings({ d, overview, appIndex, titles: { titleWidth, titleHeight, titleDepth }, centre, columns: { ports, wallOf, planned, of, widths, wallBoxes, hasSlanted, sectored, localCorners, columnCorners }, frames: { portLabel, labelReach }, seating: { stack, stackFrames, useCaseFrames, useCaseBlock, useCaseOffsets, busX, laneX, socketClearance, seatWall, seats, seatsAt, useCaseCentres, toLane, laneFoot, faceOf, labelU, portLabels } }: RingSolverInput): { outlines: Outline[]; domainShift: number } {
  const config = HEXAGONAL_KIND
  const { bodyShift, serviceFrames, servicesBlock } = centre
  const last = config.rings.length - 1
  let domainShift = 0
  const boxQuad = (b: { x: number; y: number; frame: Sized }) => rectCorners(b.x, b.y, b.frame.width, b.frame.height)

  /**
   * For a candidate application ring: does a slanted-wall socket, an overview port name or a seated use case touch
   * the stacked use cases or the title (sectors keep each wall's own content apart); or does a use-case run
   * (bus lane, branch or wall-normal run) meet a slanted socket or seated use case it does not serve, or a seated use
   * case's exit cross the stack or the domain? The upper walls lean in exactly where the buses come down from the
   * use cases, so this is what usually sizes the ring once they are used.
   */
  const appClashes = (appO: Outline, insideO: Outline) => {
    const slantedSocket = wallBoxes
      .filter((b) => b.kind === 'port')
      .map((b) => {
        const { n, dir } = wallFrame(b.wall)
        const centre = { x: n.x * appO.halfWidth + dir.x * b.u, y: n.y * appO.halfWidth + dir.y * b.u }
        const face = faceOf(b, appO)
        return { ref: b.ref, side: b.side, wall: b.wall, face, quad: rectCorners(centre.x, centre.y, b.width, b.height, wallAngle(b.wall)) }
      })
    const centres = useCaseCentres(appO, insideO)
    const stacked = stack.map((i, j) => ({ x: 0, y: centres[j], frame: useCaseFrames[i] }))
    const seated = seatsAt(appO)
    const others = [rectCorners(0, -appO.apex + titleDepth + titleHeight(appIndex) / 2, titleWidth(appIndex), titleHeight(appIndex)), ...stacked.map(boxQuad)]
    const labels = portLabels(appO).map((l) => rectCorners(l.x, l.y, l.frame.width, l.frame.height, l.rotation))
    const seatQuads = seated.map(boxQuad)
    if ([...slantedSocket.map((s) => s.quad), ...labels, ...seatQuads].some((q) => others.some((o) => quadsOverlap(q, o)))) return true
    if (overview) return false
    // Every use-case run, tagged with the port and use case it serves.
    const runs: { ref: string; useCase: number; quad: Point[] }[] = []
    for (const port of d.ports) {
      const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
      if (k < 0) continue
      const seat = seated.find((s) => s.i === k)
      if (seat && seat.wall === wallOf(port)) continue
      const from = seat ?? stacked[stack.indexOf(k)]
      const sign = port.side === 'driving' ? -1 : 1
      const lane = laneX(port.side, k, insideO.halfWidth)
      const slanted = slantedSocket.find((s) => s.ref === port.id)
      const socket = planned.find((p) => p.key === `port:${port.id}`)
      const portY = slanted?.face.y ?? socket?.y
      if (portY === undefined) continue
      const head = toLane({ x: from.x, y: from.y, width: from.frame.width, height: from.frame.height, seated: !!seat }, lane, insideO.apex, portY)
      head.slice(1).forEach((q, j) => runs.push({ ref: port.id, useCase: k, quad: hairline(head[j], q) }))
      const laneTop = head.at(-1)!.y
      if (slanted) {
        const foot = laneFoot(slanted.face, slanted.wall, lane)
        runs.push({ ref: port.id, useCase: k, quad: hairline({ x: lane, y: laneTop }, foot) }, { ref: port.id, useCase: k, quad: hairline(foot, slanted.face) })
      } else {
        const inner = sign * (appO.halfWidth - widths[port.side].socketHalf)
        runs.push(
          { ref: port.id, useCase: k, quad: hairline({ x: lane, y: laneTop }, { x: lane, y: portY }) },
          { ref: port.id, useCase: k, quad: hairline({ x: lane, y: portY }, { x: inner, y: portY }) },
        )
      }
    }
    if (slantedSocket.some((s) => runs.some((r) => r.ref !== s.ref && quadsOverlap(s.quad, r.quad)))) return true
    const boxes = [...seated.map((s) => ({ i: s.i, quad: boxQuad(s) })), ...stacked.map((b, j) => ({ i: stack[j], quad: boxQuad(b) }))]
    return boxes.some((b) => runs.some((r) => r.useCase !== b.i && quadsOverlap(b.quad, r.quad)))
  }

  // 4. Rings, inside-out: each one holds its own content, fitted to the real box corners. The stack above the
  // inner ring (use cases, then the title) is absolute here; titles move up under the top vertex afterwards.
  const outlines: Outline[] = []

  for (let i = last; i >= 0; i--) {
    const role = config.rings[i].role
    const inner = outlines[i + 1]
    if (role === 'domain') {
      // The block hangs titleDepth under the apex, so its corners move with the radius; the width at a fixed
      // depth under the apex only grows with r, which makes the smallest fitting radius a binary search.
      const outline = (r: number) => hexagon(r)
      const fits = (o: Outline) => {
        const top = -o.apex + titleDepth
        const shift = bodyShift(o)
        const boxes = [
          { x: titleWidth(i) / 2 + LABEL_PAD_X, from: 0, to: titleHeight(i) },
          ...centre.boxes.map((r) => ({ x: Math.abs(r.x) + r.frame.width / 2 + DOMAIN_PAD, from: r.top + shift, to: r.top + shift + r.frame.height })),
        ]
        // The title stays in the upper half even when the domain is empty, so it never floats mid-ring.
        const titleUp = top + titleHeight(i) <= -LABEL_LINE / 2
        // A body shifted onto the slope touches it exactly; the tolerance keeps that tangency from failing on rounding.
        return titleUp && boxes.every((b) => [top + b.from, top + b.to].every((y) => Math.abs(y) <= o.apex + 1e-6 && halfWidthAt(o, y) >= b.x - 1e-6))
      }
      let [lo, hi] = [1, 64]
      while (!fits(outline(hi))) hi *= 2
      for (let n = 0; n < 50; n++) {
        const mid = (lo + hi) / 2
        if (fits(outline(mid))) hi = mid
        else lo = mid
      }
      outlines[i] = outline(hi)
      domainShift = bodyShift(outlines[i])
      continue
    }
    const side: Need[] = []
    const vertical: Need[] = []
    let stackTop = inner.apex
    if (role === 'domainServices' && serviceFrames.length) {
      stackTop += GAP + servicesBlock.height
      vertical.push({ x: servicesBlock.width / 2 + PAD, y: stackTop })
    }
    if (role === 'application') {
      for (const p of of('port')) {
        const clear = Math.max(halfWidthAt(inner, nearest(p.y, p.height)) + GAP, socketClearance(p.side, inner.halfWidth))
        side.push({ x: clear + widths[p.side].socketHalf + labelReach(ports.get(p.ref)!), y: farthest(p.y, p.height) })
      }
      if (stack.length) {
        const blockTop = inner.apex + (overview ? GAP : DOMAIN_RUN) + useCaseBlock.height
        vertical.push({ x: useCaseBlock.width / 2 + PAD, y: blockTop })
        if (!overview) {
          stackFrames.forEach((f, j) => {
            const centre = blockTop - useCaseOffsets[j] - f.height / 2
            for (const s of SideSchema.options) vertical.push({ x: busX(s, stack[j], inner.halfWidth) + PAD, y: centre })
          })
        }
        stackTop = blockTop
      }
    }
    vertical.push({ x: 0, y: stackTop + GAP + titleHeight(i) + titleDepth })
    if (role === 'adapters') {
      for (const p of of('adapter')) {
        const w = widths[p.side]
        side.push({ x: halfWidthAt(inner, p.y) + w.socketHalf + GAP + w.adapter + PAD, y: farthest(p.y, p.height) })
      }
    }
    let minApothem = 0
    if (role === 'application') {
      for (const b of wallBoxes.filter((b) => !b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      for (const b of wallBoxes.filter((b) => b.kind === 'port')) {
        const label = portLabel(ports.get(b.ref)!)
        const labelDepth = overview ? LABEL_GAP + label.height : 0
        minApothem = Math.max(minApothem, inner.halfWidth + GAP + b.height / 2 + labelDepth)
        if (overview) {
          for (const u of [labelU(b, label) - label.width / 2, labelU(b, label) + label.width / 2]) {
            for (const v of [-(b.height / 2 + LABEL_GAP), -(b.height / 2 + labelDepth)]) minApothem = Math.max(minApothem, sectorApothem(u, v))
          }
        }
        const port = d.ports.find((p) => p.id === b.ref)!
        const k = d.useCases.findIndex((u) => u.id === port.useCaseId)
        if (k >= 0 && !overview && seatWall(d.useCases[k]) !== b.wall) {
          // The run from the bus lane to the socket, along the wall normal, keeps at least RUN.
          const { n, dir } = wallFrame(b.wall)
          const bus = laneX(b.side, k, inner.halfWidth)
          minApothem = Math.max(minApothem, (bus + RUN * n.x - b.u * dir.x) / n.x + b.height / 2)
        }
      }
      for (const s of seats()) {
        // Clear of the domain by the room its question needs, and inside its sector like every wall box.
        minApothem = Math.max(minApothem, inner.halfWidth + (overview ? GAP : DOMAIN_RUN) + s.inset + 2 * s.across)
        const { n, dir } = wallFrame(s.wall)
        for (const c of rectCorners(0, 0, s.frame.width, s.frame.height)) {
          minApothem = Math.max(minApothem, sectorApothem(s.u + dot(c, dir), -(s.inset + s.across) + dot(c, n)))
        }
      }
      if (sectored) {
        const socketSpan = (p: Planned) => [-widths[p.side].socketHalf - labelReach(ports.get(p.ref)!), widths[p.side].socketHalf]
        for (const c of columnCorners('port', socketSpan)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
        for (const c of columnCorners('adapter', (p) => [widths[p.side].socketHalf + GAP])) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      }
    }
    if (role === 'adapters') {
      const appApothem = inner.halfWidth
      for (const b of wallBoxes.filter((b) => b.kind === 'adapter')) for (const c of localCorners(b)) minApothem = Math.max(minApothem, appApothem + c.v + PAD)
      for (const b of wallBoxes.filter((b) => b.outer)) for (const c of localCorners(b)) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
      if (hasSlanted) for (const c of columnCorners('actor', () => [OUTSIDE_GAP]).concat(columnCorners('external', () => [OUTSIDE_GAP]))) minApothem = Math.max(minApothem, sectorApothem(c.u, c.v))
    }
    let fitted = fitRing(inner, side, vertical, minApothem)
    // Sockets on the upper walls, and overview port names, lean in toward the use cases and the title: grow until
    // none of them touch.
    if (role === 'application' && (hasSlanted || overview || stack.length < d.useCases.length)) {
      for (let guard = 0; guard < 400 && appClashes(fitted, inner); guard++) fitted = hexagon(fitted.apex * 1.01)
    }
    // The title must fit titleDepth under the top: the hexagon's slope is wide enough by construction, so only
    // its straight width can bind.
    const w = titleWidth(i) / 2 + LABEL_PAD_X
    outlines[i] = hexagon(Math.max(fitted.apex, w / COS30))
  }
  return { outlines, domainShift }
}
