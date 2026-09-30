import { collectionOf } from './links'
import { diagramOf } from './map'
import type { Diagram, HexaMap, Linkable } from './schema'

/** What a selection depends on: its element ids per hexagon, and the map links the dependency crosses. */
export interface Chain {
  elements: Map<string, Set<string>>
  links: Set<string>
}

/** The one thing `ref` depends on inside its hexagon: endpoint → adapter → port → use case, entity → its parent. */
function inward(d: Diagram, ref: string): string | undefined {
  const owner = collectionOf(d, ref)
  const item: Linkable | undefined = owner && d[owner].find((i) => i.id === ref)
  return item?.adapterId ?? item?.portId ?? item?.useCaseId ?? item?.parentId
}

/**
 * The dependency chain of `ref` in hexagon `hexId`, following the dependency rule toward the core and never
 * outward. Reaching a driven port it crosses each map link to the driving port at its other end and carries on
 * from there. A use case asks the whole domain, so an expanded hexagon reaches all of it; a hexagon that is not
 * in `expanded` shows nothing past its ports, so its chain ends at the port. `undefined` when `ref` is not an
 * element of the hexagon (a layer, the composition root).
 */
export function dependencyChain(map: HexaMap, hexId: string, ref: string, expanded: ReadonlySet<string>): Chain | undefined {
  if (!collectionOf(diagramOf(map, hexId), ref)) return undefined
  const chain: Chain = { elements: new Map(), links: new Set() }
  const add = (hex: string, id: string) => chain.elements.set(hex, (chain.elements.get(hex) ?? new Set()).add(id))

  const follow = (hex: string, from: string) => {
    const d = diagramOf(map, hex)
    for (let at: string | undefined = from; at; at = inward(d, at)) {
      add(hex, at)
      for (const link of map.links) {
        if (link.from.hexagonId !== hex || link.from.portId !== at) continue
        chain.links.add(link.id)
        follow(link.to.hexagonId, link.to.portId)
      }
      if (!expanded.has(hex)) return
      if (collectionOf(d, at) === 'useCases') for (const item of d.domain) add(hex, item.id)
    }
  }
  follow(hexId, ref)
  return chain
}
