import { HEXAGONAL_KIND } from '../../model/kinds'
import { defaultWall, SideSchema, type Diagram, type Port, type Side, type UseCase, type Wall } from '../../model/schema'
import { reach, type Point } from '../geometry'
import type { Frame, NodeKind, Planned, WallBox } from '../layout'
import { depthAt, type Outline } from '../outline'
import { EDGE_LABEL, measure } from '../text'
import { DOMAIN_RUN, GAP, LABEL_GAP, LANE, PAD, RUN } from './spacing'
import { WALLS, wallFrame } from './walls'

/** Where a bus lane turns onto the wall normal that ends on a slanted socket's face. */
export const laneFoot = (face: Point, wall: Wall, lane: number): Point => {
  const { n } = wallFrame(wall)
  return { x: lane, y: face.y - (n.y * (face.x - lane)) / n.x }
}
/** The socket's inner face on a slanted wall of a candidate application ring. */
export const faceOf = (b: WallBox, appO: Outline): Point => {
  const { n, dir } = wallFrame(b.wall)
  return { x: n.x * (appO.halfWidth - b.height / 2) + dir.x * b.u, y: n.y * (appO.halfWidth - b.height / 2) + dir.y * b.u }
}

/**
 * From a use case to its bus lane. A stacked one leaves sideways. A seated one may sit beside the domain, so it
 * first steps (vertically) to just past the domain's top or bottom, in the free band under the stack, then across.
 * A port lying past that band picks the band on its own side, so the run never turns back; any other keeps to the
 * use case's side. One already beyond the band crosses at its own row: stepping back to the band would only double back.
 */
export const toLane = (box: { x: number; y: number; width: number; height: number; seated: boolean }, lane: number, insideApex: number, portY: number): Point[] => {
  const toward = Math.sign(lane - box.x)
  if (!box.seated) return [{ x: box.x + (toward * box.width) / 2, y: box.y }, { x: lane, y: box.y }]
  const band = insideApex + LANE
  const clearY = (Math.sign(Math.abs(portY) > band ? portY : box.y) || -1) * band
  const past = Math.sign(box.y) === Math.sign(clearY) && Math.abs(box.y) - box.height / 2 >= band
  const rowY = past ? box.y : clearY
  if (past || Math.abs(clearY - box.y) <= box.height / 2) return [{ x: box.x + (toward * box.width) / 2, y: rowY }, { x: lane, y: rowY }]
  return [{ x: box.x, y: box.y + (Math.sign(clearY - box.y) * box.height) / 2 }, { x: box.x, y: clearY }, { x: lane, y: clearY }]
}

// A hexagon can seat a use case on a wall, in that wall's sector; circles ignore it, as they ignore port walls.
export const seatWall = (u: UseCase): Wall | undefined => (u.placement && u.placement !== 'top' ? u.placement : undefined)

export interface SeatingInput {
  d: Diagram
  overview: boolean
  /** Index of the application ring in the kind's ring list. */
  appIndex: number
  /** One frame per `d.useCases` entry, in the same order. */
  useCaseFrames: Frame[]
  /** How many driven ports the domain declares: each keeps one extra lane for its dotted ownership link. */
  declaredPorts: number
  titles: { titleHeight: (i: number) => number; titleDepth: number }
  columns: { ports: Map<string, Port>; wallBoxes: WallBox[]; of: (kind: NodeKind) => Planned[]; widths: Record<Side, { socketHalf: number }> }
  frames: { portLabel: (p: Port) => Frame; labelReach: (p: Port) => number }
}

/** How the use cases sit in the application ring: stacked under its title, or seated on a wall, each with the bus lane its runs take to the sockets. */
export function seatUseCases({ d, overview, appIndex, useCaseFrames, declaredPorts, titles: { titleHeight, titleDepth }, columns: { ports, wallBoxes, of, widths }, frames: { portLabel, labelReach } }: SeatingInput) {
  const { labels } = HEXAGONAL_KIND
  /** Indices into d.useCases of the use cases stacked under the application title. */
  const stack = d.useCases.flatMap((u, i) => (seatWall(u) ? [] : [i]))
  const stackFrames = stack.map((i) => useCaseFrames[i])
  const useCaseBlock = {
    width: Math.max(0, ...stackFrames.map((f) => f.width)),
    height: stackFrames.reduce((h, f) => h + f.height, 0) + GAP * Math.max(0, stackFrames.length - 1),
  }

  // Use-case buses: one vertical lane per use case and side, between the inner ring and the sockets. The top
  // use case takes the outermost lane so no exit crosses another bus, and the exit run fits the lane's verb.
  const laneVerb: Record<Side, string> = { driving: labels.runs, driven: labels.uses }
  const busX = (side: Side, k: number, innerHalfWidth: number) =>
    // The driven side also keeps one lane per declared port, for the dotted ownership links.
    Math.max(innerHalfWidth + LANE * (1 + (side === 'driven' ? declaredPorts : 0)), useCaseBlock.width / 2 + measure(laneVerb[side], EDGE_LABEL) + 2 * LANE) +
    LANE * (useCaseFrames.length - 1 - k)
  /** The bus lane's x: the driving lanes run left of the centre, the driven ones right. */
  const laneX = (side: Side, k: number, innerHalfWidth: number) => (side === 'driving' ? -1 : 1) * busX(side, k, innerHalfWidth)
  const socketClearance = (side: Side, innerHalfWidth: number) =>
    useCaseFrames.length && !overview ? busX(side, 0, innerHalfWidth) + RUN : 0
  const useCaseOffsets = stackFrames.map((_, j) => stackFrames.slice(0, j).reduce((o, f) => o + f.height + GAP, 0))

  /** Centres of the stacked use cases under the application title, in stack order (see placement below). */
  const useCaseCentres = (appO: Outline, insideO: Outline) => {
    const titleBottom = titleDepth + titleHeight(appIndex)
    const depth = Math.max(
      titleBottom + GAP,
      ...stackFrames.flatMap((f, j) => [
        depthAt(appO, useCaseBlock.width / 2 + PAD) - useCaseOffsets[j],
        // Bus corners only exist in Detailed, as in the solver: on a circle they would sink the stack into the domain.
        ...(overview ? [] : SideSchema.options.map((s) => depthAt(appO, busX(s, stack[j], insideO.halfWidth) + PAD) - useCaseOffsets[j] - f.height / 2)),
      ]),
    )
    // A run meets an upper slanted wall square, rising as it goes, so its row cannot sit above the lane foot. The
    // feet stay put as the ring grows, so when they lie below the room above the domain no ring can seat the stack
    // under them: the stack then keeps the depth it would have without them, and those runs still double back.
    const belowFeet = overview
      ? -Infinity
      : Math.max(
          -Infinity,
          ...stackFrames.flatMap((f, j) =>
            wallBoxes
              .filter((b) => b.kind === 'port' && wallFrame(b.wall).n.y < 0 && ports.get(b.ref)!.useCaseId === d.useCases[stack[j]].id)
              .map((b) => laneFoot(faceOf(b, appO), b.wall, laneX(b.side, stack[j], insideO.halfWidth)).y + appO.apex - useCaseOffsets[j] - f.height / 2),
          ),
        )
    const lowest = appO.apex - insideO.apex - DOMAIN_RUN - useCaseBlock.height
    let y = -appO.apex + (belowFeet <= lowest ? Math.max(depth, belowFeet) : depth)
    return stackFrames.map((f) => {
      const centre = y + f.height / 2
      y += f.height + GAP
      return centre
    })
  }
  /**
   * Use cases seated on a wall, in wall coordinates: stacked along it like ports, the run centred on the ports they
   * serve on that wall, and set in past the wall's sockets (and their overview names) by the room an arrow needs.
   */
  const seats = () =>
    WALLS.flatMap((wall) => {
      const here = d.useCases.flatMap((u, i) => (seatWall(u) === wall ? [i] : []))
      if (!here.length) return []
      const { n, dir } = wallFrame(wall)
      // The wall's sockets: where each sits along the wall, and how far in it (and its name) reaches.
      const sockets = [
        ...wallBoxes
          .filter((b) => b.kind === 'port' && b.wall === wall)
          .map((b) => ({ port: ports.get(b.ref)!, u: b.u, inward: b.height / 2 + (overview ? LABEL_GAP + portLabel(ports.get(b.ref)!).height : 0) })),
        ...of('port')
          .filter((p) => defaultWall(p.side) === wall)
          .map((p) => ({ port: ports.get(p.ref)!, u: p.y * dir.y, inward: widths[p.side].socketHalf + labelReach(ports.get(p.ref)!) })),
      ]
      const inset = Math.max(0, ...sockets.map((s) => s.inward)) + (overview ? GAP : DOMAIN_RUN)
      const socketsAlong = sockets.map((s) => s.u).sort((a, b) => a - b)
      const items = here
        .map((i) => {
          const f = useCaseFrames[i]
          const own = sockets.find((s) => s.port.useCaseId === d.useCases[i].id)?.u
          const along = reach(f.width, f.height, dir)
          // Another use case's run to a socket on this wall passes through any seat level with that socket, at every
          // ring size, so a seat with no socket of its own here steps past them along the wall.
          let want = own ?? 0
          if (own === undefined) {
            for (const u of socketsAlong) if (Math.abs(u - want) < along + GAP) want = u + along + GAP
          }
          return { i, wall, frame: f, want, along, across: reach(f.width, f.height, n) }
        })
        .sort((a, b) => a.want - b.want)
      let end = -Infinity
      const packed = items.map((it) => {
        const u = Math.max(it.want, end + it.along)
        end = u + it.along + GAP
        return { ...it, u, inset }
      })
      const shift = packed.reduce((t, it) => t + it.want - it.u, 0) / packed.length
      return packed.map((it) => ({ ...it, u: it.u + shift }))
    })
  /** Seated use cases for a candidate application ring, centred in the plane. */
  const seatsAt = (appO: Outline) =>
    seats().map((s) => {
      const { n, dir } = wallFrame(s.wall)
      const depth = appO.halfWidth - s.inset - s.across
      return { ...s, x: n.x * depth + dir.x * s.u, y: n.y * depth + dir.y * s.u }
    })

  return { stack, stackFrames, useCaseBlock, useCaseOffsets, busX, laneX, socketClearance, useCaseCentres, seats, seatsAt }
}
