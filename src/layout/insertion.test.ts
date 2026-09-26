import { describe, expect, it } from 'vitest'
import { insertionItem, insertionPoints, type InsertionPoint } from './insertion'
import { layoutDiagram, wallFrame } from './layout'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import type { Diagram } from '../model/schema'

const COS30 = Math.sqrt(3) / 2
const pointsFor = (d: Diagram, mode: 'detailed' | 'overview' = 'detailed') => insertionPoints(layoutDiagram(d, { mode }), d, mode)
const byLayer = (points: InsertionPoint[], layer: string) => points.filter((p) => p.layer === layer)

describe('insertionPoints', () => {
  describe('domain', () => {
    const points = byLayer(pointsFor(EXAMPLE_DIAGRAM), 'domain')

    it('offers one "+" under the roots, one inside each aggregate, one under the declared ports', () => {
      expect(points.map((p) => p.action)).toEqual([
        { kind: 'domainRoot' },
        { kind: 'domainChild', parentId: 'd-feedback' },
        { kind: 'drivenPortDecl' },
      ])
      expect(points.map((p) => p.label)).toEqual(['Add a domain item', 'Add an item inside Feedback', 'Add a driven port'])
    })

    it('puts the root "+" under the last root and the child "+" on its aggregate outline', () => {
      const m = layoutDiagram(EXAMPLE_DIAGRAM)
      const outline = m.nodes.find((n) => n.kind === 'aggregate')!
      expect(points[0].at.y).toBeGreaterThan(outline.y + outline.height / 2)
      expect(points[1].at).toEqual({ x: outline.x, y: outline.y + outline.height / 2 })
    })

    it('has no declared-port "+" in overview, where that list is hidden', () => {
      expect(byLayer(pointsFor(EXAMPLE_DIAGRAM, 'overview'), 'domain').map((p) => p.action.kind)).toEqual(['domainRoot'])
    })
  })

  describe('application', () => {
    const model = layoutDiagram(EXAMPLE_DIAGRAM)
    const app = model.rings.find((r) => r.role === 'application')!
    const points = byLayer(insertionPoints(model, EXAMPLE_DIAGRAM, 'detailed'), 'application')
    const ports = points.filter((p) => p.action.kind === 'port')

    it('offers a use case "+" under the last use case', () => {
      const uc = model.nodes.find((n) => n.kind === 'useCase')!
      const add = points.find((p) => p.action.kind === 'useCase')!
      expect(add.at.x).toBe(0)
      expect(add.at.y).toBeGreaterThan(uc.y + uc.height / 2)
    })

    it('offers one port "+" per hexagon wall, each for its own side', () => {
      expect(ports.map((p) => p.action)).toEqual([
        { kind: 'port', side: 'driving', wall: 'nw' },
        { kind: 'port', side: 'driving', wall: 'w' },
        { kind: 'port', side: 'driving', wall: 'sw' },
        { kind: 'port', side: 'driven', wall: 'ne' },
        { kind: 'port', side: 'driven', wall: 'e' },
        { kind: 'port', side: 'driven', wall: 'se' },
      ])
      expect(ports.find((p) => p.action.kind === 'port' && p.action.wall === 'ne')!.label).toBe('Add a driven port on the north-east wall')
    })

    it('puts an empty wall "+" at the wall midpoint, and a used wall "+" past the end of its run', () => {
      const ne = ports.find((p) => p.action.kind === 'port' && p.action.wall === 'ne')!
      expect(ne.at.x).toBeCloseTo(0.5 * app.halfWidth, 6)
      expect(ne.at.y).toBeCloseTo(-COS30 * app.halfWidth, 6)
      const e = ports.find((p) => p.action.kind === 'port' && p.action.wall === 'e')!
      const lowest = Math.max(...model.nodes.filter((n) => n.kind === 'port' && n.wall === 'e').map((n) => n.y + n.height / 2))
      expect(e.at.x).toBeCloseTo(app.halfWidth, 6)
      expect(e.at.y).toBeGreaterThan(lowest)
    })

    it('puts an overview wall "+" past the port names that run along that wall', () => {
      const model = layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })
      const walls = insertionPoints(model, STRESS_DIAGRAM, 'overview').flatMap((p) => (p.action.kind === 'port' && p.action.wall ? [{ wall: p.action.wall, at: p.at }] : []))
      for (const { wall, at } of walls.filter((w) => w.wall !== 'w' && w.wall !== 'e')) {
        const sockets = model.nodes.filter((n) => n.kind === 'port' && n.wall === wall)
        const dir = { x: Math.cos((sockets[0].rotation! * Math.PI) / 180), y: Math.sin((sockets[0].rotation! * Math.PI) / 180) }
        const along = (q: { x: number; y: number }) => q.x * dir.x + q.y * dir.y
        const labels = model.nodes.filter((n) => n.kind === 'portLabel' && sockets.some((s) => s.ref === n.ref))
        const [lo, hi] = [Math.min(...labels.map((l) => along(l) - l.width / 2)), Math.max(...labels.map((l) => along(l) + l.width / 2))]
        expect(along(at) < lo || along(at) > hi).toBe(true)
      }
    })

    it('offers a use case "+" per sector of a hexagon besides the one under the title, skipping sectors whose "+" would sit on the stack', () => {
      const actions = points.filter((p) => p.action.kind === 'useCase').map((p) => p.action)
      expect(actions).toEqual([{ kind: 'useCase' }, ...['w', 'sw', 'e', 'se'].map((placement) => ({ kind: 'useCase', placement }))])
      const stress = byLayer(pointsFor(STRESS_DIAGRAM, 'overview'), 'application').flatMap((p) => (p.action.kind === 'useCase' && p.action.placement ? [p.action.placement] : []))
      // EarnPoints sits on nw at the stack's height, so both ends of that run are taken; ne is free lower down.
      expect(stress).toEqual(['w', 'sw', 'ne', 'e', 'se'])
    })

    it('puts a sector "+" past the use cases already on that wall', () => {
      const model = layoutDiagram(STRESS_DIAGRAM)
      const nw = pointsFor(STRESS_DIAGRAM).find((p) => p.action.kind === 'useCase' && p.action.placement === 'nw')!
      const placed = model.nodes.find((n) => n.kind === 'useCase' && n.wall === 'nw')!
      const dir = { x: COS30, y: -0.5 }
      const along = (q: { x: number; y: number }) => q.x * dir.x + q.y * dir.y
      const reach = (placed.width / 2) * COS30 + (placed.height / 2) * 0.5
      expect(along(nw.at) > along(placed) + reach || along(nw.at) < along(placed) - reach).toBe(true)
    })

    it('reaches all six walls of the stress example, each past its own run', () => {
      const walls = byLayer(pointsFor(STRESS_DIAGRAM), 'application').flatMap((p) => (p.action.kind === 'port' ? [p.action.wall] : []))
      expect(walls).toEqual(['nw', 'w', 'sw', 'ne', 'e', 'se'])
    })
  })

  describe('missing counterparts', () => {
    const lonely: Diagram = {
      ...EXAMPLE_DIAGRAM,
      ports: [...EXAMPLE_DIAGRAM.ports, { id: 'p-solo', name: 'AuditLog', side: 'driven' }],
      adapters: [...EXAMPLE_DIAGRAM.adapters, { id: 'a-quiet', name: 'MetricsSink', portId: 'p-notify' }],
    }
    const points = pointsFor(lonely)

    it('offers an adapter "+" beside each port that has none, plus one at the end of each adapter column', () => {
      const adapters = byLayer(points, 'adapters').filter((p) => p.action.kind === 'adapter')
      expect(adapters.map((p) => p.action)).toEqual([
        { kind: 'adapter', side: 'driven', portId: 'p-solo' },
        { kind: 'adapter', side: 'driving' },
        { kind: 'adapter', side: 'driven' },
      ])
      expect(adapters[0].label).toBe('Add an adapter for AuditLog')
    })

    it('offers an actor or external "+" beside each adapter without one, in the outermost layer', () => {
      const endpoints = byLayer(points, 'adapters').filter((p) => p.action.kind === 'endpoint')
      expect(endpoints.map((p) => p.action)).toEqual([{ kind: 'endpoint', side: 'driven', adapterId: 'a-quiet' }])
      expect(endpoints[0].label).toBe('Add an external system for MetricsSink')
    })
  })
})

describe('insertionItem', () => {
  it.each([
    [{ kind: 'domainRoot' as const }, 'aggregate' as const, { collection: 'domain', patch: { name: 'NewAggregate', type: 'aggregate' } }],
    [{ kind: 'domainRoot' as const }, 'entity' as const, { collection: 'domain', patch: { name: 'NewEntity', type: 'entity' } }],
    [{ kind: 'domainChild' as const, parentId: 'g' }, 'valueObject' as const, { collection: 'domain', patch: { name: 'NewValueObject', type: 'valueObject', parentId: 'g' } }],
    [{ kind: 'drivenPortDecl' as const }, undefined, { collection: 'ports', patch: { name: 'NewPort', side: 'driven', wall: 'e' } }],
    [{ kind: 'useCase' as const }, undefined, { collection: 'useCases', patch: { name: 'NewUseCase' } }],
    [{ kind: 'useCase' as const, placement: 'nw' as const }, undefined, { collection: 'useCases', patch: { name: 'NewUseCase', placement: 'nw' } }],
    [{ kind: 'port' as const, side: 'driving' as const, wall: 'sw' as const }, undefined, { collection: 'ports', patch: { name: 'newPort', side: 'driving', wall: 'sw' } }],
    [{ kind: 'port' as const, side: 'driven' as const }, undefined, { collection: 'ports', patch: { name: 'NewPort', side: 'driven' } }],
    [{ kind: 'adapter' as const, side: 'driven' as const, portId: 'p' }, undefined, { collection: 'adapters', patch: { name: 'NewAdapter', portId: 'p' } }],
    [{ kind: 'adapter' as const, side: 'driving' as const }, undefined, { collection: 'adapters', patch: { name: 'NewAdapter' } }],
    [{ kind: 'endpoint' as const, side: 'driving' as const, adapterId: 'a' }, undefined, { collection: 'actors', patch: { name: 'New actor', adapterId: 'a' } }],
    [{ kind: 'endpoint' as const, side: 'driven' as const, adapterId: 'a' }, undefined, { collection: 'externals', patch: { name: 'New system', adapterId: 'a' } }],
  ])('creates %j (%s) with its link and default name', (action, choice, expected) => {
    expect(insertionItem(action, choice)).toEqual(expected)
  })
})

describe('insertion points never crowd the canvas', () => {
  const PLUS = 24
  const SQRT3 = Math.sqrt(3)
  const extraStacked = { ...EXAMPLE_DIAGRAM, useCases: [...EXAMPLE_DIAGRAM.useCases, { id: 'uc-extra', name: 'ArchiveFeedback' }] }
  const noUseCases = { ...EXAMPLE_DIAGRAM, useCases: [], ports: EXAMPLE_DIAGRAM.ports.map(({ useCaseId: _, ...p }) => p) }
  const box = (at: { x: number; y: number }) => ({ x0: at.x - PLUS / 2, x1: at.x + PLUS / 2, y0: at.y - PLUS / 2, y1: at.y + PLUS / 2 })
  const hits = (a: ReturnType<typeof box>, b: { x: number; y: number; width: number; height: number }) =>
    a.x1 > b.x && a.x0 < b.x + b.width && a.y1 > b.y && a.y0 < b.y + b.height

  describe.each([
    ['feedback', EXAMPLE_DIAGRAM],
    ['feedback with a second stacked use case', extraStacked],
    ['feedback without use cases', noUseCases],
    ['stress', STRESS_DIAGRAM],
    [
      'three wide seats on one wall',
      {
        ...EXAMPLE_DIAGRAM,
        useCases: ['ImportTheNightlyStockFeed', 'RebuildTheSearchIndex', 'ExpireAbandonedCarts'].map((name, i) => ({ id: `u${i}`, name, placement: 'sw' as const })),
        ports: EXAMPLE_DIAGRAM.ports.map(({ useCaseId: _, ...p }) => p),
      },
    ],
  ])('%s', (_, diagram) => {
    it.each(['detailed', 'overview'] as const)('keeps every "+" off the layer titles and 24 apart (%s)', (mode) => {
      const model = layoutDiagram(diagram, { mode })
      const points = insertionPoints(model, diagram, mode)
      for (const p of points) {
        for (const r of model.rings) expect(hits(box(p.at), r.titleBox) ? `${p.key} over the ${r.role} title` : 'clear').toBe('clear')
        for (const q of points) if (q !== p) expect(Math.hypot(q.at.x - p.at.x, q.at.y - p.at.y) >= PLUS ? 'apart' : `${p.key} near ${q.key}`).toBe('apart')
      }
    })

    it.each(['detailed', 'overview'] as const)('offers exactly one use case "+" for the stack, below it (%s)', (mode) => {
      const model = layoutDiagram(diagram, { mode })
      const app = model.rings.find((r) => r.role === 'application')!
      const stackPlus = insertionPoints(model, diagram, mode).filter((p) => p.action.kind === 'useCase' && !p.action.placement)
      expect(stackPlus).toHaveLength(1)
      const stacked = model.nodes.filter((n) => n.kind === 'useCase' && !n.wall)
      const floor = stacked.length ? Math.max(...stacked.map((n) => n.y + n.height / 2)) : app.titleBox.y + app.titleBox.height
      expect(stackPlus[0].at.y - PLUS / 2).toBeGreaterThanOrEqual(floor)
    })

    it.each(['detailed', 'overview'] as const)('keeps each sector "+" 8 clear of the spokes and off the stack (%s)', (mode) => {
      const model = layoutDiagram(diagram, { mode })
      const stacked = model.nodes.filter((n) => n.kind === 'useCase' && !n.wall)
      for (const p of insertionPoints(model, diagram, mode)) {
        if (p.action.kind !== 'useCase' || !p.action.placement) continue
        const { n, dir } = wallFrame(p.action.placement)
        const depth = p.at.x * n.x + p.at.y * n.y
        const along = Math.abs(p.at.x * dir.x + p.at.y * dir.y)
        // Distance from the point to the nearer spoke of its sector, less the "+" half-size.
        expect((depth / SQRT3 - along) * (SQRT3 / 2) - PLUS / 2).toBeGreaterThanOrEqual(8 - 1e-6)
        for (const s of stacked) expect(hits(box(p.at), { x: s.x - s.width / 2, y: s.y - s.height / 2, width: s.width, height: s.height }) ? `${p.key} on ${s.key}` : 'clear').toBe('clear')
        // The upper sectors share their height with the stack: a "+" there only below the stack's own "+".
        const stackPlus = insertionPoints(model, diagram, mode).find((q) => q.action.kind === 'useCase' && !q.action.placement)!
        if (p.action.placement === 'nw' || p.action.placement === 'ne') expect(p.at.y).toBeGreaterThanOrEqual(stackPlus.at.y + PLUS)
      }
    })
  })
})
