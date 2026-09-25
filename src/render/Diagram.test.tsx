import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MapDiagram } from './Diagram'
import { layoutMap } from '../layout/map'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { legendFor } from '../layout/legend'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { twoHexagonMap } from '../test/fixtures'

const NO_TARGETS = new Set<string>()
const NO_CROSS_TARGETS = new Map<string, ReadonlySet<string>>()

function renderSvg(
  map: HexaMap,
  extra: {
    focus?: string
    selected?: string | null
    linkTargets?: ReadonlySet<string>
    crossLinkTargets?: ReadonlyMap<string, ReadonlySet<string>>
    hovered?: string | null
  } = {},
) {
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
        crossLinkTargets={extra.crossLinkTargets ?? NO_CROSS_TARGETS}
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

  it('draws the map link with a visible stroke, on the canvas and in the exported markup (CANVAS-02)', async () => {
    const { container } = renderSvg(twoHexagonMap())
    const line = container.querySelector('[data-map-link]')!
    expect(line.classList.contains('map-link')).toBe(true)

    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    const rule = /\.map-link\s*\{[^}]*stroke:\s*[^;}]+[;}]/
    expect(css).toMatch(rule)
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

/** twoHexagonMap with its two hexagons split across contexts and the link tagged with a pattern — the minimum
 * shape that makes the pattern label eligible (REQ-LNK-06.1). */
function twoContextLinkedMap(): HexaMap {
  const base = twoHexagonMap()
  return {
    ...base,
    contexts: [{ id: 'c1' }, { id: 'c2' }],
    hexagons: base.hexagons.map((h, i) => (i === 1 ? { ...h, contextId: 'c2' } : h)),
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' }, pattern: 'acl' }],
  }
}

describe('MapDiagram — routed link path and pattern label (REQ-LNK-05, REQ-LNK-06)', () => {
  it('draws the map link as a <path>, not a <line>, following the routed polyline', () => {
    const { container, model } = renderSvg(twoHexagonMap())
    expect(container.querySelectorAll('line[data-map-link]')).toHaveLength(0)
    const path = container.querySelector('path[data-map-link]')!
    const points = model.links[0].points
    expect(path.getAttribute('d')).toMatch(new RegExp(`^M${points[0].x} ${points[0].y}`))
    expect(path.getAttribute('d')).toMatch(new RegExp(`L${points.at(-1)!.x} ${points.at(-1)!.y}$`))
    expect(path.classList.contains('map-link')).toBe(true)
    expect(path.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders no pattern label when the link carries none', () => {
    const { container } = renderSvg(twoHexagonMap())
    expect(container.querySelectorAll('[data-link-pattern]')).toHaveLength(0)
  })

  it('renders exactly one pattern label, at the layout’s labelAt, when the link is pattern-tagged', () => {
    const { container, model } = renderSvg(twoContextLinkedMap())
    const labels = container.querySelectorAll('[data-link-pattern]')
    expect(labels).toHaveLength(1)
    const labelAt = model.links[0].labelAt!
    expect(labels[0].getAttribute('x')).toBe(String(labelAt.x))
    expect(labels[0].getAttribute('y')).toBe(String(labelAt.y))
    expect(labels[0].textContent).toBe('acl')
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

/** twoHexagonMap plus a second, unlisted port on h2 (to tell a marked target apart from an unmarked one on the
 * SAME non-current hexagon) and a third hexagon h3 that never appears in crossLinkTargets at all. */
function crossTargetMap(): HexaMap {
  const base = twoHexagonMap()
  const h2 = { ...base.hexagons[1], ports: [...base.hexagons[1].ports, { id: 'p-in2', name: 'in2', side: 'driving' as const }] }
  const h3: HexaMap['hexagons'][number] = {
    id: 'h3',
    contextId: 'c1',
    cell: { q: -1, r: 0 },
    title: 'Slice C',
    domain: [],
    useCases: [],
    ports: [{ id: 'p-c', name: 'c', side: 'driving' }],
    adapters: [],
    actors: [],
    externals: [],
  }
  return { ...base, hexagons: [base.hexagons[0], h2, h3] }
}

describe('MapDiagram — cross-hexagon link targets (decision 7387)', () => {
  it('marks a non-current hexagon’s valid target port, leaves an unlisted port on the same hexagon and a hexagon absent from the map unmarked', () => {
    const { container } = renderSvg(crossTargetMap(), { crossLinkTargets: new Map([['h2', new Set(['p-in'])]]) })
    const marked = container.querySelectorAll('.node-port[data-link-target]')
    expect(marked).toHaveLength(1)
    expect(marked[0].closest('[data-hex]')!.getAttribute('data-hex')).toBe('h2')
    expect(marked[0].getAttribute('data-ref')).toBe('p-in')
    const h2Other = container.querySelector('[data-hex="h2"] [data-ref="p-in2"]')!
    expect(h2Other.hasAttribute('data-link-target')).toBe(false)
    const h3Port = container.querySelector('[data-hex="h3"] [data-ref="p-c"]')!
    expect(h3Port.hasAttribute('data-link-target')).toBe(false)
  })

  it('marks nothing when no cross-hexagon targets are given (outside link mode)', () => {
    const { container } = renderSvg(crossTargetMap())
    expect(container.querySelectorAll('[data-link-target]')).toHaveLength(0)
  })
})

/** Two hexagons in one context (h1, h2 — matches twoHexagonMap) plus a third in a second context. */
function threeHexTwoContextMap(): HexaMap {
  const base = twoHexagonMap()
  return {
    ...base,
    contexts: [...base.contexts, { id: 'c2' }],
    hexagons: [
      ...base.hexagons,
      { id: 'h3', contextId: 'c2', cell: { q: 0, r: 1 }, title: 'Slice C', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
  }
}

describe('MapDiagram — context hulls and chips (CB-01, CB-02, CB-05)', () => {
  it('draws no hull or chip below two contexts (CB-01.1, CB-01.4)', () => {
    const { container } = renderSvg(twoHexagonMap())
    expect(container.querySelectorAll('[data-hull]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-chip]')).toHaveLength(0)
  })

  it('draws exactly one hull and one chip per context, from two contexts up (CB-01.2)', () => {
    const map = threeHexTwoContextMap()
    const { container, model } = renderSvg(map)
    expect(model.contexts).toHaveLength(2)
    const hulls = container.querySelectorAll('[data-hull]')
    const chips = container.querySelectorAll('[data-chip]')
    expect(hulls).toHaveLength(2)
    expect(chips).toHaveLength(2)
    expect([...hulls].map((h) => h.getAttribute('data-hull')).sort()).toEqual(['c1', 'c2'])
    expect([...chips].map((h) => h.getAttribute('data-chip')).sort()).toEqual(['c1', 'c2'])
  })

  it('paints hulls before every hexagon group, and chips after the hexagon groups and the map links', () => {
    const { container } = renderSvg(threeHexTwoContextMap())
    const svg = container.querySelector('svg')!
    const order = [...svg.querySelectorAll('*')]
    const firstHexGroup = svg.querySelector('[data-hex]')!
    const lastLink = [...svg.querySelectorAll('[data-map-link]')].at(-1)!
    const lastHull = [...svg.querySelectorAll('[data-hull]')].at(-1)!
    const firstChip = svg.querySelector('[data-chip]')!
    expect(order.indexOf(lastHull)).toBeLessThan(order.indexOf(firstHexGroup))
    expect(order.indexOf(firstChip)).toBeGreaterThan(order.indexOf(lastLink))
  })

  it('marks the hulls group inert (aria-hidden) and each hull evenodd; each chip is inert and shows its label', () => {
    const { container, model } = renderSvg(threeHexTwoContextMap())
    expect(container.querySelector('[data-hulls]')!.getAttribute('aria-hidden')).toBe('true')
    for (const hull of container.querySelectorAll('[data-hull]')) {
      expect(hull.getAttribute('fill-rule')).toBe('evenodd')
    }
    for (const context of model.contexts) {
      const chip = container.querySelector(`[data-chip="${context.id}"]`)!
      expect(chip.getAttribute('aria-hidden')).toBe('true')
      expect(chip.textContent).toBe(context.label)
    }
  })
})
