import { flowsOf } from './flow'
import { diagramOf } from './map'
import { fillSlots, mapSlots, slotsOfView } from './mapSlots'
import type { Diagram, HexaMap, Hexagon } from './schema'

/** One use case's flow inside one hexagon: the colour slot it draws with and the refs of every element it touches. */
export interface Thread {
  useCaseId: string
  slot: number
  refs: ReadonlySet<string>
}

/**
 * The slot every use case draws with: its persisted `threadSlot`, else the lowest slot distinct from every other use case,
 * filled in use case order. On a diagram from `diagramOf` that is every use case of the map, so no two hexagons repeat a
 * colour; on any other diagram, those of the diagram. Every thread shares the application corridor, so any two can run
 * side by side; a wall or a box shared by only some of them is not a safe boundary. Persisted slots are never touched, so a
 * colour follows its use case when others come, go or move.
 */
export function threadSlots(d: Pick<Diagram, 'useCases'>): Map<string, number> {
  return slotsOfView(d) ?? fillSlots([d.useCases])[0]
}

/**
 * `after`, an edit of `before` that removes or reorders use cases, with the slot written on every remaining use case
 * the edit would otherwise repaint: a colour follows its use case, never its rank.
 */
export function keepSlots(before: HexaMap, after: HexaMap): HexaMap {
  const was = mapSlots(before)
  const wasOf = new Map(before.hexagons.map((h, i) => [h.id, was[i]]))
  for (let next = after; ; ) {
    const now = mapSlots(next)
    let repainted = false
    const hexagons = next.hexagons.map((h, i) => {
      const old = wasOf.get(h.id)
      const stale = (u: Hexagon['useCases'][number]) => u.threadSlot === undefined && old?.has(u.id) === true && now[i].get(u.id) !== old.get(u.id)
      if (!h.useCases.some(stale)) return h
      repainted = true
      return { ...h, useCases: h.useCases.map((u) => (stale(u) ? { ...u, threadSlot: old!.get(u.id)! } : u)) }
    })
    if (!repainted) return next
    next = { ...next, hexagons }
  }
}

/** One thread per use case of the hexagon, in its order, built from its flow: the single source of which elements belong together. */
export function threadsOf(map: HexaMap, hexId: string): Thread[] {
  const slots = threadSlots(diagramOf(map, hexId))
  return flowsOf(map, hexId).map((f) => ({ useCaseId: f.useCaseId, slot: slots.get(f.useCaseId)!, refs: new Set(f.steps.filter((s) => s.hexId === hexId).map((s) => s.id)) }))
}
