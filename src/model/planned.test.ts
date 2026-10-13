import { describe, expect, it } from 'vitest'
import { MapSchema, VERSION, type HexaMap, type Hexagon } from './schema'
import { hasPlanned, plannedOf, withoutPlanned } from './planned'

const planned = { status: 'planned' } as const
const hexagon = (id: string, cell: Hexagon['cell'], rest: Partial<Hexagon> = {}): Hexagon => ({
  id,
  contextId: 'c1',
  cell,
  title: id,
  domain: [],
  useCases: [],
  ports: [],
  adapters: [],
  actors: [],
  externals: [],
  ...rest,
})

describe('plannedOf', () => {
  it('collects the ids of planned items across every collection', () => {
    const refs = plannedOf({
      domain: [{ id: 'd1', name: 'D', type: 'entity', ...planned }, { id: 'd2', name: 'E', type: 'entity' }],
      useCases: [{ id: 'u1', name: 'U', ...planned }],
      ports: [{ id: 'p1', name: 'P', side: 'driving', ...planned }],
      adapters: [{ id: 'a1', name: 'A', ...planned }],
      actors: [{ id: 'x1', name: 'X', ...planned }],
      externals: [{ id: 'e1', name: 'E', ...planned }, { id: 'e2', name: 'F' }],
    })
    expect([...refs].sort()).toEqual(['a1', 'd1', 'e1', 'p1', 'u1', 'x1'])
  })

  it('is empty for a diagram with nothing planned', () => {
    expect(plannedOf({ domain: [{ id: 'd1', name: 'D', type: 'entity' }] }).size).toBe(0)
  })
})

describe('withoutPlanned', () => {
  // h1 is the focused hexagon. Its planned use case is referenced by a built port; its planned port-adapter is
  // referenced by a built actor; a planned aggregate holds a built child.
  const base = (): HexaMap => ({
    version: VERSION,
    kind: 'hexagonal',
    title: 'Roadmap',
    contexts: [{ id: 'c1' }, { id: 'c2' }],
    hexagons: [
      hexagon('h1', { q: 0, r: 0 }, {
        domain: [{ id: 'd-agg', name: 'Agg', type: 'aggregate', ...planned }, { id: 'd-child', name: 'Child', type: 'entity', parentId: 'd-agg' }],
        useCases: [{ id: 'uc-new', name: 'New', ...planned }, { id: 'uc-old', name: 'Old' }],
        ports: [
          { id: 'p-out', name: 'out', side: 'driven', useCaseId: 'uc-new' },
          { id: 'p-gone', name: 'gone', side: 'driven', ...planned },
        ],
        adapters: [{ id: 'a-built', name: 'Built', portId: 'p-out' }, { id: 'a-new', name: 'New', portId: 'p-out', ...planned }],
        actors: [{ id: 'x1', name: 'Actor', adapterId: 'a-new' }],
        externals: [{ id: 'e1', name: 'Ext', adapterId: 'a-built' }],
      }),
      hexagon('h2', { q: 1, r: 0 }, { contextId: 'c2', ports: [{ id: 'p-in', name: 'in', side: 'driving' }], adapters: [{ id: 'a-in', name: 'In', portId: 'p-in' }] }),
      hexagon('h3', { q: 2, r: 0 }, { contextId: 'c2', ...planned, ports: [{ id: 'p-in3', name: 'in', side: 'driving' }] }),
    ],
    links: [
      { id: 'built', from: { hexagonId: 'h1', portId: 'p-out', adapterId: 'a-built' }, to: { hexagonId: 'h2', portId: 'p-in' } },
    ],
  })

  it('is the same map, by reference, when nothing is planned', () => {
    const clean = { ...base(), hexagons: [hexagon('h2', { q: 0, r: 0 })], links: [] }
    expect(withoutPlanned(clean, 'h2')).toBe(clean)
  })

  it('removes planned elements and keeps the built ones', () => {
    const { hexagons } = withoutPlanned(base(), 'h1')
    expect(hexagons[0].domain.map((d) => d.id)).toEqual(['d-child'])
    expect(hexagons[0].useCases.map((u) => u.id)).toEqual(['uc-old'])
    expect(hexagons[0].ports.map((p) => p.id)).toEqual(['p-out'])
    expect(hexagons[0].adapters.map((a) => a.id)).toEqual(['a-built'])
  })

  it('clears references to a removed element on the built ones that stay, without removing them', () => {
    const [h] = withoutPlanned(base(), 'h1').hexagons
    expect(h.domain[0]).not.toHaveProperty('parentId')
    expect(h.ports[0]).not.toHaveProperty('useCaseId')
    expect(h.actors).toEqual([{ id: 'x1', name: 'Actor' }])
    expect(h.externals[0].adapterId).toBe('a-built')
  })

  it('hides a planned hexagon unless it is the focused one', () => {
    expect(withoutPlanned(base(), 'h1').hexagons.map((h) => h.id)).toEqual(['h1', 'h2'])
    expect(withoutPlanned(base(), 'h3').hexagons.map((h) => h.id)).toEqual(['h1', 'h2', 'h3'])
  })

  it('keeps the contents of a focused planned hexagon that are not themselves planned', () => {
    const map = base()
    const focusedPlanned = { ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, ...planned } : h)) }
    const [h] = withoutPlanned(focusedPlanned, 'h1').hexagons
    expect(h.status).toBe('planned')
    expect(h.useCases.map((u) => u.id)).toEqual(['uc-old'])
  })

  it('drops a planned link and a link to a hidden hexagon or port', () => {
    const map = base()
    const links = [
      map.links[0],
      { id: 'planned', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' }, ...planned },
      { id: 'to-hidden-hex', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h3', portId: 'p-in3' } },
    ]
    const hexagons = map.hexagons.map((h) => (h.id === 'h2' ? { ...h, ports: [...h.ports, { id: 'p-new', name: 'n', side: 'driving' as const, ...planned }] } : h))
    links.push({ id: 'to-hidden-port', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-new' } })
    expect(withoutPlanned({ ...map, hexagons, links }, 'h1').links.map((l) => l.id)).toEqual(['built'])
  })

  it('keeps a link whose end only lost its adapter, clearing that adapter', () => {
    const map = base()
    const links = [{ id: 'l', from: { hexagonId: 'h1', portId: 'p-out', adapterId: 'a-new' }, to: { hexagonId: 'h2', portId: 'p-in' } }]
    const { links: kept } = withoutPlanned({ ...map, links }, 'h1')
    expect(kept).toEqual([{ id: 'l', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }])
  })

  it('leaves a map that still satisfies the schema', () => {
    expect(MapSchema.safeParse(withoutPlanned(base(), 'h1')).success).toBe(true)
  })

  it('does not mutate its input', () => {
    const map = base()
    const before = JSON.stringify(map)
    withoutPlanned(map, 'h1')
    expect(JSON.stringify(map)).toBe(before)
  })
})

describe('hasPlanned', () => {
  const clean = (): HexaMap => ({ version: VERSION, kind: 'hexagonal', title: 'T', contexts: [{ id: 'c1' }], hexagons: [hexagon('h1', { q: 0, r: 0 }), hexagon('h2', { q: 1, r: 0 })], links: [] })

  it('is false for a built map', () => {
    expect(hasPlanned(clean())).toBe(false)
  })

  it.each([
    ['a hexagon', (m: HexaMap): HexaMap => ({ ...m, hexagons: [m.hexagons[0], { ...m.hexagons[1], ...planned }] })],
    ['an element', (m: HexaMap): HexaMap => ({ ...m, hexagons: [{ ...m.hexagons[0], useCases: [{ id: 'u', name: 'U', ...planned }] }, m.hexagons[1]] })],
    ['a link', (m: HexaMap): HexaMap => ({ ...m, links: [{ id: 'l', from: { hexagonId: 'h1', portId: 'a' }, to: { hexagonId: 'h2', portId: 'b' }, ...planned }] })],
  ])('is true when %s is planned', (_, plan) => {
    expect(hasPlanned(plan(clean()))).toBe(true)
  })
})
