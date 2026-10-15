import { flowsOf } from './flow'
import { toMap } from './hexa'
import { diagramOf } from './map'
import { defaultWall, type Diagram, type HexaMap, type Wall } from './schema'
import { slotScore, THREAD_SLOTS } from './threadPalette'

/** One use case's flow inside one hexagon: the colour slot it draws with and the refs of every element it touches. */
export interface Thread {
  useCaseId: string
  slot: number
  refs: ReadonlySet<string>
}

/** The use cases that cannot share a colour: they seat or wire on one wall, or draw through one box. */
function conflicts(d: Diagram): Map<string, Set<string>> {
  const walls = new Map<string, Set<Wall | undefined>>(d.useCases.map((u) => [u.id, new Set([u.placement === 'top' ? undefined : u.placement])]))
  for (const p of d.ports) if (p.useCaseId) walls.get(p.useCaseId)?.add(p.wall ?? defaultWall(p.side))
  const users = new Map<string, Set<string>>()
  const map = toMap(d)
  for (const { useCaseId, steps } of flowsOf(map, map.hexagons[0].id))
    for (const { hexId, id } of steps) if (hexId === map.hexagons[0].id) users.set(id, (users.get(id) ?? new Set()).add(useCaseId))
  const out = new Map(d.useCases.map((u) => [u.id, new Set<string>()]))
  const link = (a: string, b: string) => {
    if (a === b) return
    out.get(a)!.add(b)
    out.get(b)!.add(a)
  }
  d.useCases.forEach((a, i) => {
    for (const b of d.useCases.slice(i + 1)) if ([...walls.get(a.id)!].some((w) => w && walls.get(b.id)!.has(w))) link(a.id, b.id)
  })
  for (const ids of users.values()) for (const a of ids) for (const b of ids) link(a, b)
  return out
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
 * The slot every use case draws with: its persisted `colour`, else the lowest slot distinct from the slots of the use
 * cases it conflicts with, filled in use case order. Persisted slots are never touched, so a colour follows its use
 * case when others come, go or move.
 */
export function threadSlots(d: Diagram): Map<string, number> {
  const slots = new Map(d.useCases.flatMap((u) => (u.colour === undefined ? [] : [[u.id, u.colour] as const])))
  const clashes = conflicts(d)
  for (const u of d.useCases) {
    if (slots.has(u.id)) continue
    slots.set(u.id, lowestDistinct([...clashes.get(u.id)!].flatMap((id) => slots.get(id) ?? [])))
  }
  return slots
}

/** One thread per use case of the hexagon, in its order, built from its flow: the single source of which elements belong together. */
export function threadsOf(map: HexaMap, hexId: string): Thread[] {
  const slots = threadSlots(diagramOf(map, hexId))
  return flowsOf(map, hexId).map((f) => ({ useCaseId: f.useCaseId, slot: slots.get(f.useCaseId)!, refs: new Set(f.steps.filter((s) => s.hexId === hexId).map((s) => s.id)) }))
}
