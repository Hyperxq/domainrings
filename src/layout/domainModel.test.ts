import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import type { Diagram, Wall } from '../model/schema'
import { dot, type Point } from './geometry'
import { layoutDiagram, type LayoutMode, type LayoutModel, type LayoutNode } from './layout'
import { halfWidthAt } from './outline'
import { WALLS, wallFrame } from './hexagon/walls'

const MODES: LayoutMode[] = ['detailed', 'overview']
const CASES: Array<[string, Diagram]> = [
  ['example', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
]

const withUses = (d: Diagram, uses: Record<string, { placement?: Wall; aggregateIds?: string[] }>): Diagram => ({
  ...d,
  useCases: d.useCases.map((u) => ({ ...u, ...uses[u.id] })),
})

const cardOf = (m: LayoutModel, _mode: LayoutMode, id: string) => m.nodes.find((n) => n.key === `aggregate:${id}`)!
const cardsOf = (m: LayoutModel, mode: LayoutMode, d: Diagram) => d.domain.filter((i) => i.type === 'aggregate' && !i.parentId).map((i) => cardOf(m, mode, i.id))
const corners = (n: LayoutNode): Point[] => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: n.x + (sx * n.width) / 2, y: n.y + (sy * n.height) / 2 })))
const faceOfCard = (n: LayoutNode): Wall => WALLS.reduce((best, w) => (dot(n, wallFrame(w).n) > dot(n, wallFrame(best).n) ? w : best))
const onBoundary = (n: LayoutNode, p: Point) => {
  const [dx, dy] = [Math.abs(p.x - n.x), Math.abs(p.y - n.y)]
  return dx <= n.width / 2 + 1e-6 && dy <= n.height / 2 + 1e-6 && (Math.abs(dx - n.width / 2) < 1e-6 || Math.abs(dy - n.height / 2) < 1e-6)
}
const strictlyInside = (n: LayoutNode, p: Point) => Math.abs(p.x - n.x) < n.width / 2 - 1 && Math.abs(p.y - n.y) < n.height / 2 - 1
const apart = (a: LayoutNode, b: LayoutNode) =>
  a.x + a.width / 2 <= b.x - b.width / 2 || b.x + b.width / 2 <= a.x - a.width / 2 || a.y + a.height / 2 <= b.y - b.height / 2 || b.y + b.height / 2 <= a.y - a.height / 2

describe.each(CASES)('domain model region: %s', (_, diagram) => {
  describe.each(MODES)('%s', (mode) => {
    const m = layoutDiagram(diagram, { mode })
    const domain = m.rings.at(-1)!

    it('draws an inner region, clear of the domain title and inside the domain ring', () => {
      const region = m.region!
      expect(region).toBeDefined()
      expect(region.apex).toBeLessThan(domain.apex)
      expect(-region.apex).toBeGreaterThanOrEqual(domain.titleBox.y + domain.titleBox.height)
    })

    it('holds one card per aggregate, wholly inside the region and apart from each other', () => {
      const region = m.region!
      const cards = cardsOf(m, mode, diagram)
      expect(cards).toHaveLength(diagram.domain.filter((i) => i.type === 'aggregate').length)
      for (const card of cards) {
        for (const c of corners(card)) {
          expect(Math.abs(c.y)).toBeLessThanOrEqual(region.apex)
          expect(Math.abs(c.x)).toBeLessThanOrEqual(halfWidthAt(region, c.y) + 1e-6)
        }
      }
      cards.forEach((a, i) => cards.slice(i + 1).forEach((b) => expect(apart(a, b)).toBe(true)))
    })
  })
})

describe('a domain without aggregates', () => {
  it('draws no region when it is empty', () => {
    expect(layoutDiagram({ ...EXAMPLE_DIAGRAM, domain: [] }).region).toBeUndefined()
  })

  it('keeps its other roots inside the region, each on a card headed with its type', () => {
    const d = { ...EXAMPLE_DIAGRAM, domain: [{ id: 'e1', name: 'Order', type: 'entity' as const }] }
    const m = layoutDiagram(d)
    const root = m.nodes.find((n) => n.key === 'domainItem:e1')!
    expect(m.nodes.find((n) => n.key === 'aggregate:e1')!.lines[0].text).toBe('● entity')
    for (const c of corners(root)) expect(Math.abs(c.x)).toBeLessThanOrEqual(halfWidthAt(m.region!, c.y) + 1e-6)
  })
})

describe('where a card sits', () => {
  const diagram = withUses(STRESS_DIAGRAM, {
    'uc-place': { placement: 'e', aggregateIds: ['g-order'] },
    'uc-earn': { placement: 'nw', aggregateIds: ['g-customer'] },
  })

  it.each(MODES)('is on the face toward the use cases that use it (%s)', (mode) => {
    const m = layoutDiagram(diagram, { mode })
    expect(faceOfCard(cardOf(m, mode, 'g-order'))).toBe('e')
    expect(faceOfCard(cardOf(m, mode, 'g-customer'))).toBe('nw')
  })

  it.each(MODES)('spreads cards nobody points at over opposite faces (%s)', (mode) => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode })
    const [a, b] = cardsOf(m, mode, STRESS_DIAGRAM)
    expect(faceOfCard(a)).not.toBe(faceOfCard(b))
    expect(dot(a, b)).toBeLessThan(0)
  })
})

describe('the domain no longer lists its driven ports', () => {
  it.each(CASES)('draws no declaration, heading or ownership link: %s', (_, diagram) => {
    for (const mode of MODES) {
      const m = layoutDiagram(diagram, { mode })
      expect(m.nodes.map((n) => n.kind as string).filter((k) => k === 'portDecl' || k === 'note')).toEqual([])
      expect(m.edges.map((e) => e.kind as string).filter((k) => k !== 'import' && k !== 'wiring')).toEqual([])
      expect(m.nodes.flatMap((n) => n.lines.map((l) => l.text)).filter((t) => t.includes('driven-ports/'))).toEqual([])
    }
  })

  it('marks every driven port with a diamond and no driving port', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    const tags = (side: string) => m.nodes.filter((n) => n.kind === 'port' && n.side === side).map((n) => n.lines.map((l) => l.text).filter((t) => /port$/.test(t)))
    expect(tags('driven').length).toBeGreaterThan(0)
    for (const t of tags('driven')) expect(t).toEqual(['◇ driven port'])
    for (const t of tags('driving')) expect(t).toEqual(['⇥ driving port'])
  })

  it('marks the driven ports of the overview with a diamond just the same', () => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })
    const tags = (side: string) => m.nodes.filter((n) => n.kind === 'port' && n.side === side).map((n) => n.lines[0].text)
    for (const t of tags('driven')) expect(t).toBe('◇ driven port')
    for (const t of tags('driving')) expect(t).toBe('⇥ driving port')
  })
})

describe('a use case that names its aggregates', () => {
  const diagram = withUses(STRESS_DIAGRAM, { 'uc-place': { aggregateIds: ['g-order', 'g-customer'] }, 'uc-cancel': { aggregateIds: ['nope', 'e-line'] } })
  const m = layoutDiagram(diagram)
  const edge = (key: string) => m.edges.find((e) => e.key === key)

  it('draws one arrow per aggregate, ending on its card, and none into the domain', () => {
    expect(edge('useCase:uc-place->domain')).toBeUndefined()
    for (const id of ['g-order', 'g-customer']) {
      const e = edge(`useCase:uc-place->aggregate:${id}`)!
      expect(e).toBeDefined()
      expect(onBoundary(m.nodes.find((n) => n.key === 'useCase:uc-place')!, e.points[0])).toBe(true)
      expect(onBoundary(cardOf(m, 'detailed', id), e.points.at(-1)!)).toBe(true)
    }
  })

  it('crosses no other box on the way', () => {
    for (const id of ['g-order', 'g-customer']) {
      const e = edge(`useCase:uc-place->aggregate:${id}`)!
      const card = cardOf(m, 'detailed', id)
      const others = m.nodes.filter((n) => n.key !== 'useCase:uc-place' && n !== card && !strictlyInside(card, n))
      for (const [a, b] of e.points.slice(1).map((p, i) => [e.points[i], p])) {
        for (let t = 0; t <= 1; t += 0.01) {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          expect(others.filter((n) => strictlyInside(n, p)).map((n) => n.key)).toEqual([])
        }
      }
    }
  })

  it('ignores ids that are not aggregates of the diagram', () => {
    expect(edge('useCase:uc-cancel->domain')).toBeDefined()
    expect(m.edges.filter((e) => e.key.startsWith('useCase:uc-cancel->aggregate:'))).toEqual([])
  })

  it('leaves a use case that names none asking the domain, as before', () => {
    expect(edge('useCase:uc-earn->domain')).toBeDefined()
  })

  it('draws every use case arrow in the overview too, into the domain where it has no card to reach', () => {
    const o = layoutDiagram(diagram, { mode: 'overview' })
    for (const u of diagram.useCases) {
      expect(o.edges.some((e) => e.key.startsWith(`useCase:${u.id}->`) && (e.key.endsWith('->domain') || e.key.includes('->aggregate:'))), u.id).toBe(true)
    }
  })
})

describe('an arrow round the domain', () => {
  const diagram = withUses(STRESS_DIAGRAM, {
    'uc-place': { placement: 'ne', aggregateIds: ['g-order'] },
    'uc-cancel': { placement: 'ne', aggregateIds: ['g-order'] },
    'uc-earn': { placement: 'nw', aggregateIds: ['g-order'] },
  })
  const m = layoutDiagram(diagram)

  it('goes by the top and keeps clear of every ring title', () => {
    const e = m.edges.find((e) => e.key === 'useCase:uc-earn->aggregate:g-order')!
    expect(faceOfCard(cardOf(m, 'detailed', 'g-order'))).toBe('ne')
    expect(e.points.some((p) => p.y < m.region!.apex * -1)).toBe(true)
    for (const [a, b] of e.points.slice(1).map((p, i) => [e.points[i], p])) {
      for (let t = 0; t <= 1; t += 0.005) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        for (const ring of m.rings) {
          const inTitle = p.x > ring.titleBox.x && p.x < ring.titleBox.x + ring.titleBox.width && p.y > ring.titleBox.y && p.y < ring.titleBox.y + ring.titleBox.height
          expect(inTitle ? `${ring.role} title at ${p.x},${p.y}` : 'clear').toBe('clear')
        }
      }
    }
  })
})

describe('the domain title', () => {
  const LONG = 'A domain title that runs on far wider than anything the domain holds'
  const sparse: Array<[string, Diagram]> = [
    ['an empty domain', { ...EXAMPLE_DIAGRAM, domain: [], layers: { domain: { title: LONG } } }],
    ['a single entity', { ...EXAMPLE_DIAGRAM, domain: [{ id: 'e1', name: 'Order', type: 'entity' }], layers: { domain: { title: LONG } } }],
    ['a short title', { ...EXAMPLE_DIAGRAM, domain: [], layers: { domain: { title: 'Core' } } }],
  ]

  it.each(sparse)('stays inside the domain ring and in its upper half over %s', (_, diagram) => {
    const m = layoutDiagram(diagram)
    const ring = m.rings.at(-1)!
    const { x, y, width, height } = ring.titleBox
    for (const c of [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }]) {
      expect(Math.abs(c.y)).toBeLessThanOrEqual(ring.apex)
      expect(Math.abs(c.x)).toBeLessThanOrEqual(halfWidthAt(ring, c.y) + 1e-6)
    }
    expect(y + height).toBeLessThanOrEqual(0)
  })
})
