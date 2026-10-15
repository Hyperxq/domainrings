import { defaultWall, type Diagram, type Port, type Wall } from '../../model/schema'
import { reach } from '../geometry'
import type { Outline } from '../outline'
import type { BoxFrames, Frame } from './boxFrames'
import type { BoxPlan } from './columns'
import { COS30 } from '../outline'
import { trackNeed } from './corridors'
import { DOMAIN_RUN, GAP, RUN, TRACK_GAP } from './spacing'
import { WALLS, wallFrame } from './walls'

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
  plan: BoxPlan
  frames: BoxFrames
  /** What a ring title and the room above it take under the application ring's top corner. */
  titleRoom: number
}

/**
 * How the use cases sit in the application ring: each seated on a wall, set in past its wall's sockets by the room an
 * arrow needs. With links to run round the application corridor, the seats keep clear of it: the same room on every
 * wall, since the corridor is one hexagon.
 */
export function seatUseCases({ d, overview, useCaseFrames, plan, frames, titleRoom }: SeatingInput) {
  const { wallBoxes, of, widths, ports, wallOf, inwardOf } = plan
  const { labelReach } = frames
  const walls = seatWalls(d, wallOf)

  /** A wall's sockets: where each sits along the wall, how far it reaches along it, and how far in it (and its overview name) reaches. */
  const socketsOn = (wall: Wall) => {
    const { dir } = wallFrame(wall)
    return [
      ...wallBoxes
        .filter((b) => b.kind === 'port' && b.wall === wall)
        .map((b) => ({ port: ports.get(b.ref)!, u: b.u, along: reach(b.width, b.height, dir), inward: inwardOf(b) })),
      ...of('port')
        .filter((p) => defaultWall(p.side) === wall)
        .map((p) => ({ port: ports.get(p.ref)!, u: p.y * dir.y, along: p.height / 2, inward: widths[p.side].socketHalf + labelReach(ports.get(p.ref)!) })),
    ]
  }

  /**
   * Use cases seated on a wall, in wall coordinates: stacked along it like ports, the run centred on the ports they
   * serve on that wall.
   */
  const placed = WALLS.flatMap((wall) => {
    const here = d.useCases.flatMap((_, i) => (walls[i] === wall ? [i] : []))
    if (!here.length) return []
    const { n, dir } = wallFrame(wall)
    const sockets = socketsOn(wall)
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
        return { i, wall, frame: f, want, along, across: reach(f.width, f.height, n), inward: Math.max(0, ...sockets.map((s) => s.inward)) }
      })
      .sort((a, b) => a.want - b.want)
    let end = -Infinity
    const packed = items.map((it) => {
      const u = Math.max(it.want, end + it.along)
      end = u + it.along + GAP
      return { ...it, u }
    })
    const shift = packed.reduce((t, it) => t + it.want - it.u, 0) / packed.length
    return packed.map((it) => ({ ...it, u: it.u + shift }))
  })

  // Every port reaching a use case seated elsewhere, or beside it but out of line, runs round the corridor.
  const corridor = trackNeed(
    overview
      ? []
      : WALLS.flatMap((wall) =>
          socketsOn(wall).flatMap((s) => {
            const seat = placed.find((p) => d.useCases[p.i].id === s.port.useCaseId)
            return seat ? [{ from: { wall, u: s.u, reach: s.along }, to: { wall: seat.wall, u: seat.u, reach: seat.along } }] : []
          }),
        ),
  )
  const inward = Math.max(0, ...WALLS.flatMap((wall) => socketsOn(wall).map((s) => s.inward)))
  // From the ring wall in to the outermost track: past the sockets, a straight run for the arrow head that lands on a port
  // as well as on a use case and, for tracks over the top corner, far enough in that the corner lies below the ring's title.
  const clearance = inward + RUN + (corridor.overTop ? Math.max(0, titleRoom * COS30 - inward - RUN) : 0)
  const seats = () =>
    placed.map((s) => ({ ...s, inset: corridor.tracks ? clearance + RUN + (corridor.tracks - 1) * TRACK_GAP : s.inward + (overview ? GAP : DOMAIN_RUN) }))
  /** Seated use cases for a candidate application ring, centred in the plane. */
  const seatsAt = (appO: Outline) =>
    seats().map((s) => {
      const { n, dir } = wallFrame(s.wall)
      const depth = appO.halfWidth - s.inset - s.across
      return { ...s, x: n.x * depth + dir.x * s.u, y: n.y * depth + dir.y * s.u }
    })

  return { walls, corridor: { ...corridor, outerAt: (apothem: number) => apothem - clearance }, seats, seatsAt }
}

export type UseCaseSeating = ReturnType<typeof seatUseCases>
