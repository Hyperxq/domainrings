import type { Diagram, Port, Wall } from '../../model/schema'
import { reach } from '../geometry'
import type { Frame } from './boxFrames'
import type { ChainSlot } from './chains'
import { GAP } from './spacing'
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
  /** One frame per `d.useCases` entry, in the same order. */
  useCaseFrames: Frame[]
  /** Where every port sits, for ordering the use cases of a wall by their own ports. */
  slots: ChainSlot[]
  wallOf: (p: Port) => Wall
}

/** A use case seated on its wall: its place along it, 0 being the middle of the wall. */
export interface Seat {
  /** Index into `d.useCases`. */
  i: number
  wall: Wall
  u: number
  frame: Frame
}

/**
 * How the use cases sit on the domain wall: each on its wall, stacked along it ordered by where its own port sits and the
 * run centred on the wall.
 */
export function seatUseCases({ d, useCaseFrames, slots, wallOf }: SeatingInput) {
  const walls = seatWalls(d, wallOf)
  const seats: Seat[] = WALLS.flatMap((wall) => {
    const here = d.useCases.flatMap((_, i) => (walls[i] === wall ? [i] : []))
    if (!here.length) return []
    const { dir } = wallFrame(wall)
    const items = here
      .map((i) => {
        const frame = useCaseFrames[i]
        const own = slots.find((s) => s.kind === 'port' && s.wall === wall && d.ports.find((p) => p.id === s.ref)?.useCaseId === d.useCases[i].id)?.u ?? 0
        return { i, wall, frame, own, along: reach(frame.width, frame.height, dir) }
      })
      .sort((a, b) => a.own - b.own)
    let end = 0
    const packed = items.map((it) => {
      const u = end + it.along
      end = u + it.along + GAP
      return { i: it.i, wall, frame: it.frame, u }
    })
    return packed.map((it) => ({ ...it, u: it.u - (end - GAP) / 2 }))
  })
  return { walls, seats }
}

export type UseCaseSeating = ReturnType<typeof seatUseCases>
