import { describe, expect, it } from 'vitest'
import { cellCentre, hexagonBounds, layoutMap, MAP_GAP } from './map'
import { layoutDiagram, type LayoutMode } from './layout'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from '../model/example'
import type { Diagram, HexaMap } from '../model/schema'
import { twoHexagonMap } from '../test/fixtures'

const CORPUS: Array<[string, Diagram]> = [
  ['the seeded example', EXAMPLE_DIAGRAM],
  ['the stress diagram', STRESS_DIAGRAM],
  ...RETIRED_SEEDS.map((seed, i): [string, Diagram] => [`retired seed v${i + 1}`, seed]),
]
const MODES: LayoutMode[] = ['detailed', 'overview']

describe('layoutMap — one-hexagon equivalence (MIG-05)', () => {
  for (const mode of MODES) {
    for (const [label, diagram] of CORPUS) {
      it(`matches layoutDiagram for ${label} in ${mode} mode`, () => {
        const map = toMap(diagram)
        const result = layoutMap(map, { mode })
        const expected = layoutDiagram(diagram, { mode })
        expect(result.hexagons).toHaveLength(1)
        expect(result.hexagons[0].model).toStrictEqual(expected)
        expect(result.hexagons[0].centre).toStrictEqual({ x: 0, y: 0 })
        expect(result.bounds).toStrictEqual(expected.bounds)
        expect(result.title).toBeUndefined()
        expect(result.links).toEqual([])
      })
    }
  }
})

describe('layoutMap — multi-hexagon placement (CANVAS-01, CANVAS-02)', () => {
  it('places two hexagons on a row without overlapping shifted bounds', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.hexagons).toHaveLength(2)
    const [a, b] = result.hexagons
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
    expect(b.centre.x).toBeGreaterThan(0)
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxA.right).toBeLessThan(boxB.left)
  })

  it('renders a map title only when there is more than one hexagon', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.title).toMatchObject({ text: 'Two slices, one link', style: 'title' })
  })

  it('never overlaps two lopsided hexagons — one whose content reaches far right, the other far left (CANVAS-01.1)', () => {
    // h1's driven external stretches its content to the RIGHT of its own centre; h2's driving actor stretches
    // its content to the LEFT of its own centre — the exact combination a uniform pitch (based on width alone)
    // cannot space correctly, since it ignores which side each hexagon's extent actually falls on.
    const map: HexaMap = {
      version: 2,
      kind: 'hexagonal',
      title: 'Lopsided pair',
      contexts: [{ id: 'c1' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: 'Right heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drv', name: 'drv', side: 'driven' }],
          adapters: [{ id: 'a1', name: 'Adapter', portId: 'p-drv' }],
          actors: [],
          externals: [{ id: 'e1', name: 'A Very Long External System Name That Extends Far To The Right', adapterId: 'a1' }],
        },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: 'Left heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drg', name: 'drg', side: 'driving' }],
          adapters: [{ id: 'a2', name: 'Adapter', portId: 'p-drg' }],
          actors: [{ id: 'ac1', name: 'A Very Long Actor Name That Extends Far To The Left', adapterId: 'a2' }],
          externals: [],
        },
      ],
      links: [],
    }

    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxB.left - boxA.right).toBeGreaterThanOrEqual(MAP_GAP)
  })

  it('draws the link as one segment between the from port and the to port', () => {
    const map = twoHexagonMap()
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const outNode = a.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-out')!
    const inNode = b.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-in')!
    expect(result.links).toEqual([
      {
        id: 'l1',
        points: [
          { x: outNode.x + a.centre.x, y: outNode.y + a.centre.y },
          { x: inNode.x + b.centre.x, y: inNode.y + b.centre.y },
        ],
      },
    ])
  })
})

describe('layoutMap — honeycomb lattice placement (ADR-01)', () => {
  const twoCellColumn = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two on a column',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'North', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 0, r: 1 }, title: 'South', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
    links: [],
  })

  it('places {0,0}/{0,1} at cellCentre(cell, pitch), pitch from the map’s own max extents + MAP_GAP', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    // Both hexagons share the same (empty) content, so either model's bounds already are the map's max extents.
    const left = -a.model.bounds.x
    const right = a.model.bounds.x + a.model.bounds.width
    const top = -a.model.bounds.y
    const bottom = a.model.bounds.y + a.model.bounds.height
    const pitch = { x: left + right + MAP_GAP, y: top + bottom + MAP_GAP }
    expect(a.centre).toStrictEqual(cellCentre({ q: 0, r: 0 }, pitch))
    expect(b.centre).toStrictEqual(cellCentre({ q: 0, r: 1 }, pitch))
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
  })

  it('keeps the two boxes disjoint by at least MAP_GAP', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    expect(boxB.y - (boxA.y + boxA.height)).toBeGreaterThanOrEqual(MAP_GAP)
  })
})
