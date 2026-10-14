import { defaultWall, type Diagram, type Port, type Side, type Wall } from '../../model/schema'
import { reach, type Point } from '../geometry'
import type { Outline } from '../outline'
import type { BoxFrames, Frame } from './boxFrames'
import type { BoxPlan, WallBox } from './columns'
import { DOMAIN_RUN, GAP, LABEL_GAP, LANE, RUN } from './spacing'
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
 * From a use case to its bus lane. A use case may sit beside the domain, so it first steps (vertically) to just past
 * the domain's top or bottom, then across. A port lying past that band picks the band on its own side, so the run
 * never turns back; any other keeps to the use case's side. One already beyond the band crosses at its own row
 * (or level with where the lane ends, when that lies within the box): stepping back to the band would only double back.
 * `portY` is where the lane ends.
 */
export const toLane = (box: { x: number; y: number; width: number; height: number }, lane: number, insideApex: number, portY: number): Point[] => {
  const toward = Math.sign(lane - box.x)
  const band = insideApex + LANE
  const clearY = (Math.sign(Math.abs(portY) > band ? portY : box.y) || -1) * band
  const past = Math.sign(box.y) === Math.sign(clearY) && Math.abs(box.y) - box.height / 2 >= band
  // Level with where the lane ends, the run leaves straight across rather than nudging up or down by a few units first.
  const level = past && Math.abs(portY - box.y) <= box.height / 2 - 4
  const rowY = level ? portY : past ? box.y : clearY
  if (past || Math.abs(clearY - box.y) <= box.height / 2) return [{ x: box.x + (toward * box.width) / 2, y: rowY }, { x: lane, y: rowY }]
  return [{ x: box.x, y: box.y + (Math.sign(clearY - box.y) * box.height) / 2 }, { x: box.x, y: clearY }, { x: lane, y: clearY }]
}

/**
 * The wall each use case sits on, parallel to `d.useCases`. An explicit wall wins. Otherwise the wall holding most of
 * its ports; a tie goes to the wall of a driving port, then to the first wall in order. With no ports, the least
 * occupied wall (counting the use cases already seated there), again first in order.
 */
export const seatWalls = (d: Diagram, wallOf: (p: Port) => Wall): Wall[] => {
  const explicit = d.useCases.map((u) => (u.placement && u.placement !== 'top' ? u.placement : undefined))
  const load = new Map(WALLS.map((w) => [w, explicit.filter((e) => e === w).length]))
  return d.useCases.map((u, i) => {
    const mine = d.ports.filter((p) => p.useCaseId === u.id)
    const score = (w: Wall) => (mine.length ? mine.filter((p) => wallOf(p) === w).length : -load.get(w)!)
    const best = Math.max(...WALLS.map(score))
    const tied = WALLS.filter((w) => score(w) === best)
    if (explicit[i]) return explicit[i]
    const wall = tied.find((w) => mine.some((p) => p.side === 'driving' && wallOf(p) === w)) ?? tied[0]
    load.set(wall, load.get(wall)! + 1)
    return wall
  })
}

export interface SeatingInput {
  d: Diagram
  overview: boolean
  /** One frame per `d.useCases` entry, in the same order. */
  useCaseFrames: Frame[]
  /** How many driven ports the domain declares: each keeps one extra lane for its dotted ownership link. */
  declaredPorts: number
  plan: BoxPlan
  frames: BoxFrames
}

/** How the use cases sit in the application ring: each seated on a wall, with the bus lane its runs take to the sockets. */
export function seatUseCases({ d, overview, useCaseFrames, declaredPorts, plan, frames }: SeatingInput) {
  const { wallBoxes, of, widths, ports, wallOf } = plan
  const { portLabel, labelReach } = frames
  const walls = seatWalls(d, wallOf)

  // Use-case buses: one vertical lane per use case and side, between the inner ring and the sockets. The first
  // use case takes the outermost lane so no exit crosses another bus. The lane next to the domain stays free for a
  // question that steps along the domain wall.
  const busX = (side: Side, k: number, innerHalfWidth: number) =>
    // The driven side also keeps one lane per declared port, for the dotted ownership links.
    innerHalfWidth + LANE * (2 + (side === 'driven' ? declaredPorts : 0)) + LANE * (useCaseFrames.length - 1 - k)
  /** The bus lane's x: the driving lanes run left of the centre, the driven ones right. */
  const laneX = (side: Side, k: number, innerHalfWidth: number) => (side === 'driving' ? -1 : 1) * busX(side, k, innerHalfWidth)
  const socketClearance = (side: Side, innerHalfWidth: number) =>
    useCaseFrames.length && !overview ? busX(side, 0, innerHalfWidth) + RUN : 0
  /**
   * Use cases seated on a wall, in wall coordinates: stacked along it like ports, the run centred on the ports they
   * serve on that wall, and set in past the wall's sockets (and their overview names) by the room an arrow needs.
   */
  const seats = () =>
    WALLS.flatMap((wall) => {
      const here = d.useCases.flatMap((_, i) => (walls[i] === wall ? [i] : []))
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

  return { walls, busX, laneX, socketClearance, seats, seatsAt }
}

export type UseCaseSeating = ReturnType<typeof seatUseCases>
