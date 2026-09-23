import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MapDiagram } from './Diagram'
import { layoutMap } from '../layout/map'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { legendFor } from '../layout/legend'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'

const NO_TARGETS = new Set<string>()

function renderSvg(map: HexaMap) {
  const model = layoutMap(map)
  const legend = legendFor(diagramOf(map, map.hexagons[0].id))
  const { container } = render(
    <svg>
      <MapDiagram map={model} legend={legend} showGuides={false} selected={null} linkTargets={NO_TARGETS} />
    </svg>,
  )
  return { container, model }
}

describe('MapDiagram — one hexagon (MIG-05.2 equivalence)', () => {
  it('renders the same element counts as the underlying model, one defs, one legend, no map chrome', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const { container, model } = renderSvg(map)
    const hexModel = model.hexagons[0].model
    const edgePaths = hexModel.edges.reduce((n, e) => n + (e.insideTo !== undefined ? 2 : 1), 0)
    expect(container.querySelectorAll('.ring')).toHaveLength(hexModel.rings.length)
    expect(container.querySelectorAll('.node')).toHaveLength(hexModel.nodes.length)
    expect(container.querySelectorAll('.edge')).toHaveLength(edgePaths)
    expect(container.querySelectorAll('defs')).toHaveLength(1)
    expect(container.querySelectorAll('[data-legend]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-hex]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-map-title]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-map-link]')).toHaveLength(0)
  })
})

/** One context, cells {0,0}/{1,0}: h1's driven port links to h2's driving port. */
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

describe('MapDiagram — two hexagons (CANVAS-01, CANVAS-02)', () => {
  it('renders one defs, one legend, one group per hexagon and one link line', () => {
    const { container } = renderSvg(twoHexagonMap())
    expect(container.querySelectorAll('defs')).toHaveLength(1)
    expect(container.querySelectorAll('[data-legend]')).toHaveLength(1)
    const groups = container.querySelectorAll('[data-hex]')
    expect(groups).toHaveLength(2)
    expect([...groups].map((g) => g.getAttribute('data-hex'))).toEqual(['h1', 'h2'])
    expect(container.querySelectorAll('[data-map-link]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-map-title]')).toHaveLength(1)
  })

  it('gives every hexagon group its own translate transform matching its centre', () => {
    const { container, model } = renderSvg(twoHexagonMap())
    const groups = [...container.querySelectorAll('[data-hex]')]
    model.hexagons.forEach((hex, i) => {
      expect(groups[i].getAttribute('transform')).toBe(`translate(${hex.centre.x} ${hex.centre.y})`)
    })
  })

  it('keeps unique (data-hex, data-ref) pairs identifying each port across hexagons', () => {
    const { container } = renderSvg(twoHexagonMap())
    const pairs = [...container.querySelectorAll('[data-hex]')].flatMap((g) => {
      const hexId = g.getAttribute('data-hex')
      return [...g.querySelectorAll('.node-port[data-ref]')].map((n) => `${hexId}:${n.getAttribute('data-ref')}`)
    })
    expect(pairs).toEqual(['h1:p-out', 'h2:p-in'])
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})
