import { unionBox, type Box } from '../layout/geometry'
import { hexagonBounds } from '../layout/lattice'
import type { MapLayout } from '../layout/map'
import { CHIP_LABEL, measure } from '../layout/text'
import { flowChain, flowOf } from '../model/flow'
import type { HexaMap } from '../model/schema'

/** What an image export keeps for a flow frame: the hexagons holding the flow's steps, the map links joining two
 * of them, the contexts whose hexagons are all framed, and the box around all of it. `undefined` when the owner
 * has no such use case. */
export function flowFrame(map: HexaMap, ownerId: string, useCaseId: string, { hexagons, contexts }: Pick<MapLayout, 'hexagons' | 'contexts'>) {
  const owner = map.hexagons.find((h) => h.id === ownerId)
  if (!owner?.useCases.some((u) => u.id === useCaseId)) return undefined
  const { elements, links } = flowChain(map, flowOf(map, ownerId, useCaseId))
  const framed = hexagons.filter((h) => elements.has(h.id))
  // A hull cut by the frame, or drawn around hexagons that are not in it, would mislead; only whole ones stay.
  const whole = contexts.filter((c) => {
    const members = hexagons.filter((h) => h.contextId === c.id)
    return members.length > 0 && members.every((h) => elements.has(h.id))
  })
  const hullBoxes = whole.map((c): Box => {
    const points = c.loops.flat()
    const [x0, x1] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))]
    const [y0, y1] = [Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y))]
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  })
  const chipBoxes = whole.map((c): Box => {
    const width = measure(c.label, { size: c.size, em: CHIP_LABEL.em, tracking: CHIP_LABEL.tracking })
    return { x: c.chip.x - width / 2, y: c.chip.y - c.size, width, height: c.size * 1.25 }
  })
  const own = unionBox(framed.map(hexagonBounds))
  return {
    only: new Set(framed.map((h) => h.id)),
    links,
    contexts: new Set(whole.map((c) => c.id)),
    bounds: unionBox([own, ...hullBoxes, ...chipBoxes]),
  }
}
