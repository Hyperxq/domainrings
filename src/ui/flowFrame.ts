import { unionBox } from '../layout/geometry'
import { hexagonBounds, withGuides } from '../layout/lattice'
import type { MapHexagonLayout } from '../layout/map'
import { flowChain, flowOf } from '../model/flow'
import type { HexaMap } from '../model/schema'

/** What an image export keeps for a flow frame: the hexagons holding the flow's steps, the map links joining two
 * of them, and the box around them. `undefined` when the owner has no such use case. */
export function flowFrame(map: HexaMap, ownerId: string, useCaseId: string, hexagons: MapHexagonLayout[], guides: boolean) {
  const owner = map.hexagons.find((h) => h.id === ownerId)
  if (!owner?.useCases.some((u) => u.id === useCaseId)) return undefined
  const { elements, links } = flowChain(map, flowOf(map, ownerId, useCaseId))
  const framed = hexagons.filter((h) => elements.has(h.id))
  return { only: new Set(framed.map((h) => h.id)), links, bounds: withGuides(unionBox(framed.map(hexagonBounds)), framed, guides) }
}
