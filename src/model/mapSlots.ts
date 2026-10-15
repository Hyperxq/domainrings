import type { Diagram, HexaMap, UseCase } from './schema'
import { slotScore, THREAD_SLOTS } from './threadPalette'

/** The lowest slot distinct from every slot in `taken`; when none is, the one that clears them best. */
function lowestDistinct(taken: number[]): number {
  let best = 0
  let bestScore = -1
  for (let slot = 0; slot < THREAD_SLOTS; slot++) {
    const score = Math.min(...taken.map((t) => slotScore(slot, t)), Infinity)
    if (score >= 1) return slot
    if (score > bestScore) [best, bestScore] = [slot, score]
  }
  return best
}

/** Each use case's slot: its persisted one, else the lowest distinct from every other use case across all `groups`, filled in order. */
export function fillSlots(groups: Pick<UseCase, 'id' | 'threadSlot'>[][]): Map<string, number>[] {
  const taken = groups.flatMap((g) => g.flatMap((u) => (u.threadSlot === undefined ? [] : [u.threadSlot])))
  return groups.map((g) =>
    new Map(
      g.map((u) => {
        let slot = u.threadSlot
        if (slot === undefined) {
          slot = lowestDistinct(taken)
          taken.push(slot)
        }
        return [u.id, slot]
      }),
    ),
  )
}

const ofMap = new WeakMap<HexaMap, Map<string, number>[]>()
const ofDiagram = new WeakMap<Diagram, Map<string, number>>()

/** The slots of every hexagon of `map`, in hexagon order, distinct map-wide. */
export function mapSlots(map: HexaMap): Map<string, number>[] {
  let slots = ofMap.get(map)
  if (!slots) ofMap.set(map, (slots = fillSlots(map.hexagons.map((h) => h.useCases))))
  return slots
}

/** Remembers that `diagram` is the view of one hexagon of a map, so `slotsOfView` reads its map-wide slots. */
export function viewOf(map: HexaMap, hexId: string, diagram: Diagram): Diagram {
  ofDiagram.set(diagram, mapSlots(map)[map.hexagons.findIndex((h) => h.id === hexId)])
  return diagram
}

export const slotsOfView = (d: Pick<Diagram, 'useCases'>): Map<string, number> | undefined => ofDiagram.get(d as Diagram)
