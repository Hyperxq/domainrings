import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, EXAMPLES, STRESS_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import type { HexaMap } from '../model/schema'
import type { Box } from './geometry'
import { hexagonBounds, withGuides } from './lattice'
import type { LayoutMode } from './layout'
import { layoutMap, type MapHexagonLayout } from './map'

const MODES: LayoutMode[] = ['detailed', 'overview']

const maps: [string, HexaMap][] = [
  ['the default diagram', toMap(EXAMPLE_DIAGRAM)],
  ['the stress diagram', toMap(STRESS_DIAGRAM)],
  ...EXAMPLES.filter((e) => e.map.kind === 'hexagonal').map((e) => [e.id, e.map as HexaMap] as [string, HexaMap]),
]

const EPS = 1e-6
const inside = (box: Box, frame: Box) =>
  box.x >= frame.x - EPS && box.y >= frame.y - EPS && box.x + box.width <= frame.x + frame.width + EPS && box.y + box.height <= frame.y + frame.height + EPS

/** Every drawn guide shape of a full hexagon, on the map: the spokes and the corridor hexagons' extents. */
function guideBoxes({ model, centre }: MapHexagonLayout): Box[] {
  const spokes = model.guides.flatMap((g) => [g.from, g.to]).map((p) => ({ x: p.x + centre.x, y: p.y + centre.y, width: 0, height: 0 }))
  const corridors = model.corridors.map((c) => ({ x: centre.x - c.halfWidth, y: centre.y - c.apex, width: 2 * c.halfWidth, height: 2 * c.apex }))
  return [...spokes, ...corridors]
}

describe('the export frame holds the corridor guides', () => {
  for (const [name, map] of maps) {
    for (const mode of MODES) {
      it(`${name}, ${mode}: every guide fits when they are shown, and the frame is untouched when they are not`, () => {
        const layout = layoutMap(map, { mode })
        const hexagons = layout.hexagons.filter((h) => !h.compact)
        expect(withGuides(layout.bounds, hexagons, false)).toEqual(layout.bounds)
        const frame = withGuides(layout.bounds, hexagons, true)
        for (const h of hexagons) for (const g of guideBoxes(h)) expect(inside(g, frame)).toBe(true)
        expect(frame).not.toEqual(layout.bounds)
        for (const h of hexagons) {
          expect(withGuides(hexagonBounds(h), [h], false)).toEqual(hexagonBounds(h))
          for (const g of guideBoxes(h)) expect(inside(g, withGuides(hexagonBounds(h), [h], true))).toBe(true)
        }
      })
    }
  }
})

describe('withGuides', () => {
  it('does not depend on how many corridors a hexagon has, or their order', () => {
    const [h] = layoutMap(toMap(STRESS_DIAGRAM), { mode: 'detailed' }).hexagons
    const bounds = hexagonBounds(h)
    expect(withGuides(bounds, [{ ...h, model: { ...h.model, corridors: [] } }], true)).toEqual(bounds)
    expect(withGuides(bounds, [{ ...h, model: { ...h.model, corridors: [...h.model.corridors].reverse() } }], true)).toEqual(withGuides(bounds, [h], true))
  })
})
