import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import type { Diagram } from '../model/schema'
import { layoutDiagram, type LayoutMode, type LayoutNode } from './layout'

const MODES: LayoutMode[] = ['detailed', 'overview']
/** Every use case names an aggregate, so each has an arrow to a card. */
const NAMING: Diagram = { ...STRESS_DIAGRAM, useCases: STRESS_DIAGRAM.useCases.map((u, i) => ({ ...u, aggregateIds: [i % 2 ? 'g-customer' : 'g-order'] })) }
const WITH_ROOTS: Diagram = {
  ...NAMING,
  domain: [...NAMING.domain, { id: 'e-audit', name: 'AuditTrail', type: 'entity' }, { id: 's-pricing', name: 'PricingPolicy', type: 'domainService' }],
}
const CASES: Array<[string, Diagram]> = [['example', EXAMPLE_DIAGRAM], ['stress', STRESS_DIAGRAM], ['naming', NAMING], ['with other roots', WITH_ROOTS]]

const cards = (nodes: LayoutNode[]) => nodes.filter((n) => n.kind === 'aggregate')
const rowsOf = (nodes: LayoutNode[], d: Diagram) => nodes.filter((n) => n.kind === 'domainItem' && d.domain.find((i) => i.id === n.ref)?.parentId)
const inside = (n: LayoutNode, c: LayoutNode) => Math.abs(n.x - c.x) + n.width / 2 <= c.width / 2 + 1e-6 && Math.abs(n.y - c.y) + n.height / 2 <= c.height / 2 + 1e-6

describe('Overview and Detailed differ only in the cards', () => {
  it.each(CASES)('%s: the same edges, keyed alike', (_, d) => {
    const keys = (mode: LayoutMode) => layoutDiagram(d, { mode }).edges.map((e) => e.key)
    expect(keys('overview')).toEqual(keys('detailed'))
  })

  it.each(CASES)('%s: the same nodes but the rows of the aggregate cards', (_, d) => {
    const keys = (mode: LayoutMode) => layoutDiagram(d, { mode }).nodes.map((n) => n.key).sort()
    const aggregateRows = new Set(d.domain.filter((i) => i.parentId && i.type !== 'domainService').map((i) => `domainItem:${i.id}`))
    expect(keys('detailed').filter((k) => !aggregateRows.has(k))).toEqual(keys('overview'))
  })

  it.each(CASES)('%s: an Overview card is its header and name alone, and is no wider than in Detailed', (_, d) => {
    const [detailed, overview] = [layoutDiagram(d), layoutDiagram(d, { mode: 'overview' })]
    expect(rowsOf(overview.nodes, d)).toEqual([])
    for (const card of cards(overview.nodes)) {
      expect(card.rule).toBeUndefined()
      expect(card.lines).toHaveLength(1)
    }
    expect(Math.max(0, ...cards(overview.nodes).map((c) => c.width))).toBeLessThanOrEqual(Math.max(0, ...cards(detailed.nodes).map((c) => c.width)))
  })

  it('shrinks the aggregate cards and the region that holds them', () => {
    const [detailed, overview] = [layoutDiagram(NAMING), layoutDiagram(NAMING, { mode: 'overview' })]
    expect(Math.max(...cards(overview.nodes).map((c) => c.height))).toBeLessThan(Math.max(...cards(detailed.nodes).map((c) => c.height)))
    expect(overview.region!.apex).toBeLessThan(detailed.region!.apex)
  })
})

describe.each(MODES)('the card format (%s)', (mode) => {
  const m = layoutDiagram(WITH_ROOTS, { mode })

  it('gives every card of a hexagon the width of the widest', () => {
    expect(new Set(cards(m.nodes).map((c) => c.width)).size).toBe(1)
  })

  it('heads an aggregate card "◆ aggregate root" and any other root with its own type', () => {
    const header = (id: string) => m.nodes.find((n) => n.key === `aggregate:${id}`)!.lines[0].text
    expect(header('g-order')).toBe('◆ aggregate root')
    expect(header('e-audit')).toBe('● entity')
    expect(header('s-pricing')).toBe('⚙ domain service')
  })

  it('sets the root name bold under the header, inside its card', () => {
    for (const card of cards(m.nodes)) {
      const name = m.nodes.find((n) => n.key === `domainItem:${card.ref}`)!
      expect(name.lines[0].style).toBe('strong')
      expect(name.align).toBe('center')
      expect(name.y).toBeGreaterThan(card.y - card.height / 2 + 14)
      expect(inside(name, card)).toBe(true)
    }
  })
})

describe('the rows of a card (Detailed)', () => {
  const m = layoutDiagram(WITH_ROOTS)
  const rows = rowsOf(m.nodes, WITH_ROOTS)

  it('are one line each: a glyph and the name left, the type right, left to right in the card', () => {
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const item = WITH_ROOTS.domain.find((i) => i.id === row.ref)!
      const [line] = row.lines
      expect(row.lines).toHaveLength(1)
      expect(row.align).toBe('start')
      expect(line.text).toBe(`${item.type === 'entity' ? '●' : '○'} ${item.name}`)
      expect(line.right).toBe(item.type === 'entity' ? 'entity' : 'value obj')
    }
  })

  it('sit inside their card, under its divider, in tree order without overlapping', () => {
    for (const card of cards(m.nodes).filter((c) => rowsOf(m.nodes, WITH_ROOTS).some((r) => inside(r, c)))) {
      const mine = rows.filter((r) => inside(r, card))
      expect(card.rule).toBeGreaterThan(0)
      for (const r of mine) expect(r.y - r.height / 2).toBeGreaterThanOrEqual(card.y - card.height / 2 + card.rule! - 1e-6)
      mine.forEach((r, i) => i && expect(r.y - r.height / 2).toBeGreaterThanOrEqual(mine[i - 1].y + mine[i - 1].height / 2 - 1e-6))
    }
  })

  it('leave a card with no rows with no divider', () => {
    expect(m.nodes.find((n) => n.key === 'aggregate:e-audit')!.rule).toBeUndefined()
  })
})
