import { collectionOf } from './links'
import { diagramOf } from './map'
import { COLLECTIONS, type Diagram, type HexaMap, type Linkable } from './schema'

/** What a selection depends on, or what depends on it: its element ids per hexagon, and the map links the chain crosses. */
export interface Chain {
  elements: Map<string, Set<string>>
  links: Set<string>
}

export type ChainDirection = 'dependencies' | 'dependents'

/** The one thing an item depends on inside its hexagon: endpoint → adapter → port → use case, entity → its parent. */
const inwardOf = (item: Linkable) => item.adapterId ?? item.portId ?? item.useCaseId ?? item.parentId

function inward(d: Diagram, ref: string): string | undefined {
  const owner = collectionOf(d, ref)
  const item: Linkable | undefined = owner && d[owner].find((i) => i.id === ref)
  return item && inwardOf(item)
}

/** What depends on `ref` inside its hexagon: the items that point at it, and, for a domain item, every use case. */
function outward(d: Diagram, ref: string): string[] {
  const pointing = COLLECTIONS.flatMap((k): Linkable[] => d[k]).filter((i) => inwardOf(i) === ref)
  return [...pointing.map((i) => i.id), ...(collectionOf(d, ref) === 'domain' ? d.useCases.map((u) => u.id) : [])]
}

/**
 * The dependency chain of `ref` in hexagon `hexId`, following the dependency rule toward the core and never
 * outward. Reaching a driven port it crosses each map link to the driving port at its other end and carries on
 * from there. A use case asks the whole domain, so an expanded hexagon reaches all of it; a hexagon that is not
 * in `expanded` shows nothing past its ports, so its chain ends at the port. `undefined` when `ref` is not an
 * element of the hexagon (a layer, the composition root).
 *
 * With `dependents` the same walk runs the other way: from the domain out to the use cases, their ports, adapters
 * and endpoints, and from a driving port backwards across each link to the caller's driven port.
 */
export function dependencyChain(map: HexaMap, hexId: string, ref: string, expanded: ReadonlySet<string>, direction: ChainDirection = 'dependencies'): Chain | undefined {
  if (!collectionOf(diagramOf(map, hexId), ref)) return undefined
  const reverse = direction === 'dependents'
  const chain: Chain = { elements: new Map(), links: new Set() }

  const follow = (hex: string, at: string) => {
    // Already in the chain means already followed, which also ends any cycle.
    if (chain.elements.get(hex)?.has(at)) return
    chain.elements.set(hex, (chain.elements.get(hex) ?? new Set()).add(at))
    for (const link of map.links) {
      const [near, far] = reverse ? [link.to, link.from] : [link.from, link.to]
      if (near.hexagonId !== hex || near.portId !== at) continue
      chain.links.add(link.id)
      follow(far.hexagonId, far.portId)
    }
    if (!expanded.has(hex)) return
    const d = diagramOf(map, hex)
    const next = reverse ? outward(d, at) : [inward(d, at), ...(collectionOf(d, at) === 'useCases' ? d.domain.map((i) => i.id) : [])]
    for (const id of next) if (id) follow(hex, id)
  }
  follow(hexId, ref)
  return chain
}
