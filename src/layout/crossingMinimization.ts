import { arcAngles } from '../model/rings'

/** One angular range a set of element refs is spread across (REQ-07/REQ-08's own spacing rule) — a whole ring
 * for Onion, or a single sector's own wedge for Clean (Decision 4: reordering only ever happens WITHIN a group,
 * never across one, since an element must stay on the ring/sector its data already assigns it to). */
export interface CrossingGroup {
  key: string
  refs: readonly string[]
  startAngle: number
  endAngle: number
}

const DEFAULT_PASSES = 4

/** `fromId`/`toId` pairs (Onion's/Clean's own dependency shape) turned into a symmetric adjacency lookup — a
 * dependency has a direction (REQ-04/REQ-06), but Decision 3 cares only about "connected", not which way. */
export function neighborLookup(dependencies: readonly { fromId: string; toId: string }[]): (ref: string) => readonly string[] {
  const map = new Map<string, string[]>()
  const add = (a: string, b: string) => {
    const list = map.get(a)
    if (list) list.push(b)
    else map.set(a, [b])
  }
  for (const dep of dependencies) {
    add(dep.fromId, dep.toId)
    add(dep.toId, dep.fromId)
  }
  return (ref) => map.get(ref) ?? []
}

function circularMean(angles: readonly number[]): number {
  const sx = angles.reduce((s, a) => s + Math.cos(a), 0)
  const sy = angles.reduce((s, a) => s + Math.sin(a), 0)
  return Math.atan2(sy, sx)
}

/** Rewraps `angle` into `[from, from + 2π)` — a raw circular mean always comes back in `(-π, π]`, which sorts
 * incorrectly against a group whose own range doesn't start at `-π` (Onion's full ring starts at `-π/2`; a Clean
 * sector starts wherever its own wedge begins). */
function normalizeInto(angle: number, from: number): number {
  const twoPi = 2 * Math.PI
  return from + (((angle - from) % twoPi) + twoPi) % twoPi
}

/** Barycentric crossing minimisation (Decision 3): a fixed number of sweeps, each moving every element toward
 * the mean angle of the OTHER elements it depends on or is depended on by (`neighborsOf`) — wherever those sit,
 * even in a different group, since every group's own angle range shares one absolute polar coordinate system, so
 * a plain circular mean compares directly across them. An element with no dependency neighbours keeps its
 * current angle as its own key, so it holds its relative position instead of drifting arbitrarily. Deterministic:
 * `passes` is fixed and ties break by original index, never by object identity or iteration-order happenstance —
 * the same document always yields the same order. Returns each group's own refs, reordered. */
export function minimizeCrossings(groups: readonly CrossingGroup[], neighborsOf: (ref: string) => readonly string[], passes = DEFAULT_PASSES): Map<string, string[]> {
  const order = new Map<string, string[]>(groups.map((g) => [g.key, [...g.refs]]))
  const angleOf = new Map<string, number>()

  const assign = (g: CrossingGroup) => {
    const refs = order.get(g.key)!
    const angles = arcAngles(refs.length, g.startAngle, g.endAngle)
    refs.forEach((ref, i) => angleOf.set(ref, angles[i]))
  }
  for (const g of groups) assign(g)

  for (let pass = 0; pass < passes; pass++) {
    for (const g of groups) {
      const refs = order.get(g.key)!
      if (refs.length < 2) continue
      const keyed = refs.map((ref, i) => {
        const neighborAngles = neighborsOf(ref)
          .map((n) => angleOf.get(n))
          .filter((a): a is number => a !== undefined)
        const target = neighborAngles.length ? circularMean(neighborAngles) : angleOf.get(ref)!
        return { ref, key: normalizeInto(target, g.startAngle), i }
      })
      keyed.sort((a, b) => a.key - b.key || a.i - b.i)
      order.set(
        g.key,
        keyed.map((k) => k.ref),
      )
      assign(g)
    }
  }
  return order
}
