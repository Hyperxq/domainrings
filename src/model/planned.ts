import { withoutAggregates } from './aggregateIds'
import { pruneLinks } from './map'
import { keepSlots } from './threads'
import { COLLECTIONS, REFERENCES, type CollectionKey, type HexaMap, type Hexagon, type Linkable } from './schema'

const isPlanned = (item: { status?: string }) => item.status === 'planned'

/** The ref of every planned element of a diagram, for the renderer to mark. */
export function plannedOf(doc: Partial<Pick<Hexagon, CollectionKey>>): ReadonlySet<string> {
  const refs = new Set<string>()
  for (const key of COLLECTIONS) for (const item of doc[key] ?? []) if (isPlanned(item)) refs.add(item.id)
  return refs
}

export const withoutPlannedUseCases = <T extends { status?: string }>(useCases: T[], hide: boolean): T[] => (hide ? useCases.filter((u) => !isPlanned(u)) : useCases)

/** Whether anything in the map is planned — a hexagon, an element or a link. */
export const hasPlanned = (map: HexaMap): boolean => map.links.some(isPlanned) || map.hexagons.some((h) => isPlanned(h) || plannedOf(h).size > 0)

function builtElements(hexagon: Hexagon): Hexagon {
  let next = hexagon
  for (const key of COLLECTIONS) {
    if (hexagon[key].some(isPlanned)) next = { ...next, [key]: hexagon[key].filter((item) => !isPlanned(item)) }
  }
  for (const [owner, field, target] of REFERENCES) {
    const gone = new Set(hexagon[target].filter(isPlanned).map((item) => item.id))
    if (gone.size === 0) continue
    const items: Linkable[] = next[owner]
    const cleared = items.map((item) => {
      const ref = item[field]
      if (ref === undefined || !gone.has(ref)) return item
      const { [field]: _removed, ...rest } = item
      return rest
    })
    next = { ...next, [owner]: cleared }
  }
  const plannedDomain = new Set(hexagon.domain.filter(isPlanned).map((item) => item.id))
  return plannedDomain.size ? { ...next, useCases: withoutAggregates(next.useCases, plannedDomain) } : next
}

/**
 * The map as it reads once what is still planned is set aside: planned elements go and the built ones that pointed
 * at them lose that reference (no cascade — they stay), planned hexagons go except `keepHexId`, and a link goes when
 * it is planned or an end lost its hexagon or port; an end that only lost its adapter keeps the link without it.
 */
export function withoutPlanned(map: HexaMap, keepHexId: string): HexaMap {
  const hexagons = map.hexagons.filter((h) => h.id === keepHexId || !isPlanned(h)).map(builtElements)
  const standing = new Set(hexagons.map((h) => h.id))
  const links = map.links.filter((l) => !isPlanned(l) && standing.has(l.from.hexagonId) && standing.has(l.to.hexagonId))
  if (links.length === map.links.length && hexagons.length === map.hexagons.length && hexagons.every((h, i) => h === map.hexagons[i])) return map
  // Setting planned elements aside must not repaint the built use cases.
  return keepSlots(map, hexagons.reduce((acc, h) => pruneLinks(acc, h.id).map, { ...map, hexagons, links }))
}
