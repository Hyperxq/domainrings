import { flowsOf } from './flow'
import { diagramOf } from './map'
import type { Diagram, HexaMap } from './schema'
import { slotScore, THREAD_SLOTS } from './threadPalette'

/** One use case's flow inside one hexagon: the colour slot it draws with and the refs of every element it touches. */
export interface Thread {
  useCaseId: string
  slot: number
  refs: ReadonlySet<string>
}

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

/**
 * The slot every use case draws with: its persisted `colour`, else the lowest slot distinct from every other use case
 * of the hexagon, filled in use case order. Every thread shares the application corridor, so any two can run side by
 * side; a wall or a box shared by only some of them is not a safe boundary. Persisted slots are never touched, so a
 * colour follows its use case when others come, go or move.
 */
export function threadSlots(d: Pick<Diagram, 'useCases'>): Map<string, number> {
  const taken = d.useCases.flatMap((u) => (u.colour === undefined ? [] : [u.colour]))
  const slots = new Map<string, number>()
  for (const u of d.useCases) {
    let slot = u.colour
    if (slot === undefined) {
      slot = lowestDistinct(taken)
      taken.push(slot)
    }
    slots.set(u.id, slot)
  }
  return slots
}

/**
 * `after`, an edit of `before` that removes or reorders use cases, with the colour written on every remaining use case
 * the edit would otherwise repaint: a colour follows its use case, never its rank.
 */
export function keepSlots<T extends Pick<Diagram, 'useCases'>>(before: Pick<Diagram, 'useCases'>, after: T): T {
  const was = threadSlots(before)
  for (let next = after; ; ) {
    const now = threadSlots(next)
    const repainted = next.useCases.filter((u) => u.colour === undefined && was.has(u.id) && now.get(u.id) !== was.get(u.id))
    if (!repainted.length) return next
    next = { ...next, useCases: next.useCases.map((u) => (repainted.includes(u) ? { ...u, colour: was.get(u.id)! } : u)) }
  }
}

/** One thread per use case of the hexagon, in its order, built from its flow: the single source of which elements belong together. */
export function threadsOf(map: HexaMap, hexId: string): Thread[] {
  const slots = threadSlots(diagramOf(map, hexId))
  return flowsOf(map, hexId).map((f) => ({ useCaseId: f.useCaseId, slot: slots.get(f.useCaseId)!, refs: new Set(f.steps.filter((s) => s.hexId === hexId).map((s) => s.id)) }))
}
