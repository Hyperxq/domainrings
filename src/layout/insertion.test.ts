import { describe, expect, it } from 'vitest'
import { insertionItem, insertionPoints, type InsertionPoint } from './insertion'
import { layoutDiagram } from './layout'
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

    it('offers only the two sides on circles', () => {
      const clean = byLayer(pointsFor({ ...EXAMPLE_DIAGRAM, kind: 'clean' }), 'application').filter((p) => p.action.kind === 'port')
      expect(clean.map((p) => p.action)).toEqual([
        { kind: 'port', side: 'driving' },
        { kind: 'port', side: 'driven' },
      ])
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
      const clean = byLayer(pointsFor({ ...lonely, kind: 'clean' }), 'outer').filter((p) => p.action.kind === 'endpoint')
      expect(clean).toHaveLength(1)
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
