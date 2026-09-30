import { isInwardOrSame } from './rings'
import { ONION_KINDS } from './ringedKinds'
import type { OnionFile } from './schema'

/** The rings that can be removed or moved: everything between the innermost and the outermost. */
const isMiddle = (doc: OnionFile, role: string) => {
  const index = doc.rings.findIndex((r) => r.role === role)
  return index > 0 && index < doc.rings.length - 1
}

const pruneOutward = (doc: OnionFile): { doc: OnionFile; pruned: number } => {
  const ringOf = new Map(doc.elements.map((e) => [e.id, e.ringRole]))
  const dependencies = doc.dependencies.filter((d) => isInwardOrSame(doc.rings, ringOf.get(d.fromId)!, ringOf.get(d.toId)!))
  return { doc: { ...doc, dependencies }, pruned: doc.dependencies.length - dependencies.length }
}

export const renameRing = (doc: OnionFile, role: string, name: string): OnionFile => ({ ...doc, rings: doc.rings.map((r) => (r.role === role ? { ...r, name } : r)) })

/** New rings sit just inside the outermost one; the caller reorders from there. */
export const addRing = (doc: OnionFile, role: string, name: string): OnionFile => ({ ...doc, rings: [...doc.rings.slice(0, -1), { role, name }, ...doc.rings.slice(-1)] })

/** Elements of the removed ring join the next inner one, dropping any kind that ring does not allow. Every
 * ring is inward of what it replaces, so no dependency turns outward here, but the pruning stays the one rule. */
export function removeRing(doc: OnionFile, role: string): { doc: OnionFile; into: string; moved: number; cleared: number; pruned: number } | undefined {
  if (!isMiddle(doc, role)) return undefined
  const index = doc.rings.findIndex((r) => r.role === role)
  const target = doc.rings[index - 1]
  const allowed = ONION_KINDS[target.role] ?? []
  let moved = 0
  let cleared = 0
  const elements = doc.elements.map((e) => {
    if (e.ringRole !== role) return e
    moved++
    if (e.kind && !allowed.includes(e.kind)) {
      cleared++
      return { ...e, ringRole: target.role, kind: undefined }
    }
    return { ...e, ringRole: target.role }
  })
  const { doc: next, pruned } = pruneOutward({ ...doc, rings: doc.rings.filter((r) => r.role !== role), elements })
  return { doc: next, into: target.name, moved, cleared, pruned }
}

export function moveRing(doc: OnionFile, role: string, direction: 'in' | 'out'): { doc: OnionFile; pruned: number } | undefined {
  const index = doc.rings.findIndex((r) => r.role === role)
  const to = direction === 'in' ? index - 1 : index + 1
  if (!isMiddle(doc, role) || !isMiddle(doc, doc.rings[to].role)) return undefined
  const rings = [...doc.rings]
  ;[rings[index], rings[to]] = [rings[to], rings[index]]
  return pruneOutward({ ...doc, rings })
}
