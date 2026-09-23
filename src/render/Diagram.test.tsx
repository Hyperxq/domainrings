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

function renderSvg(map: HexaMap, extra: { focus?: string; selected?: string | null; linkTargets?: ReadonlySet<string>; hovered?: string | null } = {}) {
  const model = layoutMap(map)
  const legend = legendFor(diagramOf(map, map.hexagons[0].id))
  const { container } = render(
    <svg>
      <MapDiagram
        map={model}
        legend={legend}
        showGuides={false}
        focus={extra.focus ?? map.hexagons[0].id}
        selected={extra.selected ?? null}
        linkTargets={extra.linkTargets ?? NO_TARGETS}
        hovered={extra.hovered ?? null}
      />
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
    expect(container.querySelectorAll('[data-cue]')).toHaveLength(0)
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

/** Both hexagons carry a port with the SAME id, to prove scoping is by group, not by ref (EDIT-01.2). */
function sharedIdMap(): HexaMap {
  const base = twoHexagonMap()
  return { ...base, links: [], hexagons: base.hexagons.map((h) => ({ ...h, ports: [{ id: 'p-shared', name: h.id === 'h1' ? 'out' : 'in', side: h.id === 'h1' ? 'driven' : 'driving' }] })) }
}

describe('MapDiagram — current-hexagon scoping (FOCUS-01, CANVAS-03, EDIT-01)', () => {
  it('marks exactly the current group aria-current, with a group role and its own title as the label', () => {
    const { container } = renderSvg(twoHexagonMap(), { focus: 'h2' })
    const current = [...container.querySelectorAll('[aria-current="true"]')]
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('data-hex')).toBe('h2')
    expect(current[0].getAttribute('role')).toBe('group')
    expect(current[0].getAttribute('aria-label')).toBe('Slice B')
  })

  it('makes the non-current group a single button-like control naming what clicking it does', () => {
    const { container } = renderSvg(twoHexagonMap(), { focus: 'h2' })
    const nonCurrent = container.querySelector('[data-hex="h1"]')!
    expect(nonCurrent.getAttribute('role')).toBe('button')
    expect(nonCurrent.getAttribute('tabindex')).toBe('0')
    expect(nonCurrent.getAttribute('aria-label')).toBe('Make Slice A the current hexagon')
    expect(nonCurrent.querySelector('title')?.textContent).toBe('Slice A')
  })

  it('draws exactly one cue, inside the current group, only when the map has more than one hexagon', () => {
    const { container } = renderSvg(twoHexagonMap(), { focus: 'h2' })
    const cues = container.querySelectorAll('[data-cue]')
    expect(cues).toHaveLength(1)
    expect(cues[0].closest('[data-hex]')!.getAttribute('data-hex')).toBe('h2')
  })

  it('scopes selection and link targets to the current group, even when another hexagon shares the item id', () => {
    const { container } = renderSvg(sharedIdMap(), { focus: 'h1', selected: 'p-shared', linkTargets: new Set(['p-shared']) })
    const selected = container.querySelectorAll('.node-port[data-selected]')
    const targets = container.querySelectorAll('.node-port[data-link-target]')
    expect(selected).toHaveLength(1)
    expect(selected[0].closest('[data-hex]')!.getAttribute('data-hex')).toBe('h1')
    expect(targets).toHaveLength(1)
    expect(targets[0].closest('[data-hex]')!.getAttribute('data-hex')).toBe('h1')
  })

  it('scopes the hover attribute to the current group only', () => {
    const { container } = renderSvg(twoHexagonMap(), { focus: 'h2', hovered: 'outer' })
    const current = container.querySelector('[data-hex="h2"]')!
    const other = container.querySelector('[data-hex="h1"]')!
    expect(current.getAttribute('data-hover')).toBe('outer')
    expect(other.hasAttribute('data-hover')).toBe(false)
  })

  it('strips tabIndex and role from every node and ring inside a non-current group', () => {
    const { container } = renderSvg(twoHexagonMap(), { focus: 'h2' })
    const nonCurrentInner = container.querySelectorAll('[data-hex="h1"] .node, [data-hex="h1"] .ring')
    expect(nonCurrentInner.length).toBeGreaterThan(0)
    for (const el of nonCurrentInner) {
      expect(el.hasAttribute('tabindex')).toBe(false)
      expect(el.hasAttribute('role')).toBe(false)
    }
    const currentInner = container.querySelectorAll('[data-hex="h2"] .node, [data-hex="h2"] .ring')
    expect(currentInner.length).toBeGreaterThan(0)
    for (const el of currentInner) {
      expect(el.getAttribute('tabindex')).toBe('0')
    }
  })
})
