import { describe, expect, it } from 'vitest'
import { layoutMap } from './map'
import { layoutDiagram, type LayoutMode } from './layout'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from '../model/example'
import type { Diagram, HexaMap } from '../model/schema'

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

/** One context, cells {0,0}/{1,0}: h1's driven port links to h2's driving port — the shape of the shipped example. */
function twoHexagonMap(): HexaMap {
  return {
    version: 2,
    kind: 'hexagonal',
    title: 'Two slices, one link',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Slice A', domain: [], useCases: [], ports: [{ id: 'p-out', name: 'out', side: 'driven' }], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'Slice B', domain: [], useCases: [], ports: [{ id: 'p-in', name: 'in', side: 'driving' }], adapters: [], actors: [], externals: [] },
    ],
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }],
  }
}

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
