import { COLLECTIONS, PARENT_TYPES, type Adapter, type Diagram, type Side } from './schema'

export interface LinkTarget {
  targetRef: string
  patch: { portId: string } | { useCaseId: string } | { adapterId: string } | { parentId: string }
}

/** What the "Link to…" chip and the Links editor section's create form both resolve to (ADR-02): the existing
 * same-hexagon field wiring, unchanged, or a new map-level Link between a port on this hexagon and a port on
 * another. */
export type LinkChoice = ({ kind: 'field' } & LinkTarget) | { kind: 'link'; hexagonId: string; portId: string }

/** The collection an item id lives in; none for layers, the composition root or notes. */
export const collectionOf = (d: Diagram, ref: string) => COLLECTIONS.find((k) => d[k].some((i) => i.id === ref))

/** Entities and aggregates that can hold `id` without creating a cycle: never itself or anything below it. */
export function parentCandidates(domain: Diagram['domain'], id: string) {
  const below = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of domain) {
      if (i.parentId && below.has(i.parentId) && !below.has(i.id)) {
        below.add(i.id)
        grew = true
      }
    }
  }
  return domain.filter((i) => PARENT_TYPES.has(i.type) && !below.has(i.id))
}

/** The side an adapter serves: its port's, else what its endpoints say; undefined while nothing says. */
function adapterSide(d: Diagram, a: Adapter): Side | undefined {
  const port = d.ports.find((p) => p.id === a.portId)
  if (port) return port.side
  const [actors, externals] = [d.actors.some((e) => e.adapterId === a.id), d.externals.some((e) => e.adapterId === a.id)]
  return actors === externals ? undefined : actors ? 'driving' : 'driven'
}

/**
 * Everything `ref` can be linked to, with the patch that links it: the one statement of the linking rules.
 * Adapters take ports of their side, ports take use cases, actors take driving adapters, external systems take
 * driven ones, and entities or value objects take an aggregate or entity above them. The current link is left
 * out, since choosing it changes nothing; everything else (use cases, aggregates, layers) only receives links.
 */
export function linkTargets(d: Diagram, ref: string): LinkTarget[] {
  const adapter = d.adapters.find((a) => a.id === ref)
  if (adapter) {
    const side = adapterSide(d, adapter)
    return d.ports.filter((p) => (!side || p.side === side) && p.id !== adapter.portId).map((p) => ({ targetRef: p.id, patch: { portId: p.id } }))
  }
  const port = d.ports.find((p) => p.id === ref)
  if (port) return d.useCases.filter((u) => u.id !== port.useCaseId).map((u) => ({ targetRef: u.id, patch: { useCaseId: u.id } }))
  const endpoint = d.actors.find((e) => e.id === ref) ?? d.externals.find((e) => e.id === ref)
  if (endpoint) {
    const wrongSide: Side = d.actors.includes(endpoint) ? 'driven' : 'driving'
    return d.adapters
      .filter((a) => adapterSide(d, a) !== wrongSide && a.id !== endpoint.adapterId)
      .map((a) => ({ targetRef: a.id, patch: { adapterId: a.id } }))
  }
  const item = d.domain.find((i) => i.id === ref)
  if (item && (item.type === 'entity' || item.type === 'valueObject')) {
    return parentCandidates(d.domain, item.id)
      .filter((p) => p.id !== item.parentId)
      .map((p) => ({ targetRef: p.id, patch: { parentId: p.id } }))
  }
  return []
}
