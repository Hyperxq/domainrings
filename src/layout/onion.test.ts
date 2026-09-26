import { describe, expect, it } from 'vitest'
import { newOnionMap } from '../model/hexa'
import type { OnionFile } from '../model/schema'
import { layoutOnion } from './onion'

const withElements = (): OnionFile => ({
  ...newOnionMap('Fresh'),
  elements: [
    { id: 'e1', name: 'Order', ringRole: 'domain' },
    { id: 'e2', name: 'OrderService', ringRole: 'application' },
    { id: 'e3', name: 'OrderController', ringRole: 'outer' },
    { id: 'e4', name: 'PaymentGateway', ringRole: 'outer' },
  ],
})

describe('layoutOnion (rings only)', () => {
  it('lays out exactly the 4 rings the document declares, innermost-first, each strictly inside the next', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    expect(model.rings).toHaveLength(4)
    expect(model.rings.map((r) => r.role)).toEqual(['domain', 'domainServices', 'application', 'outer'])
    for (let i = 0; i < model.rings.length - 1; i++) {
      expect(model.rings[i].apex).toBeLessThan(model.rings[i + 1].apex)
    }
  })

  it('titles the innermost ring sentence-case and every other ring uppercase', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    expect(model.rings.find((r) => r.role === 'domain')!.title).toBe('Domain Model')
    expect(model.rings.find((r) => r.role === 'outer')!.title).toBe('INFRASTRUCTURE')
  })

  it('bounds fully enclose the outermost ring, with margin', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    const outer = model.rings[model.rings.length - 1]
    expect(model.bounds.x).toBeLessThan(-outer.halfWidth)
    expect(model.bounds.y).toBeLessThan(-outer.apex)
    expect(model.bounds.width).toBeGreaterThan(2 * outer.halfWidth)
    expect(model.bounds.height).toBeGreaterThan(2 * outer.apex)
  })
})

describe('layoutOnion (elements, REQ-07)', () => {
  it('places every element, each carrying its own ring role and name', () => {
    const model = layoutOnion(withElements())
    expect(model.elements).toHaveLength(4)
    expect(model.elements.find((e) => e.ref === 'e1')).toMatchObject({ ringRole: 'domain', name: 'Order' })
  })

  it('spreads N elements on the same ring at distinct positions on that ring\'s circumference', () => {
    const model = layoutOnion(withElements())
    const outerRing = model.rings.find((r) => r.role === 'outer')!
    const [e3, e4] = ['e3', 'e4'].map((ref) => model.elements.find((e) => e.ref === ref)!)
    expect(e3.x !== e4.x || e3.y !== e4.y).toBe(true)
    for (const e of [e3, e4]) expect(Math.hypot(e.x, e.y)).toBeCloseTo(outerRing.apex, 6)
  })
})

describe('layoutOnion (dependency edges, REQ-04)', () => {
  it('draws an edge between a dependency\'s two elements', () => {
    const doc: OnionFile = { ...withElements(), dependencies: [{ id: 'd1', fromId: 'e3', toId: 'e2' }] }
    const model = layoutOnion(doc)
    expect(model.edges).toHaveLength(1)
    const e3 = model.elements.find((e) => e.ref === 'e3')!
    const e2 = model.elements.find((e) => e.ref === 'e2')!
    expect(model.edges[0]).toMatchObject({ kind: 'dependency', from: { x: e3.x, y: e3.y }, to: { x: e2.x, y: e2.y } })
  })
})

describe('layoutOnion (endpoints, REQ-05)', () => {
  it('places an actor/external outside the outer ring and draws its edge to the targeted element', () => {
    const doc: OnionFile = { ...withElements(), actors: [{ id: 'a1', name: 'Customer', targetId: 'e3' }] }
    const model = layoutOnion(doc)
    const outerRing = model.rings.find((r) => r.role === 'outer')!
    expect(model.endpoints).toHaveLength(1)
    expect(model.endpoints[0]).toMatchObject({ ref: 'a1', kind: 'actor', name: 'Customer' })
    expect(Math.hypot(model.endpoints[0].x, model.endpoints[0].y)).toBeGreaterThan(outerRing.apex)
    const edge = model.edges.find((e) => e.kind === 'endpoint')!
    const e3 = model.elements.find((e) => e.ref === 'e3')!
    expect(edge.to).toEqual({ x: e3.x, y: e3.y })
    expect(edge.from).toEqual({ x: model.endpoints[0].x, y: model.endpoints[0].y })
  })

  it('an endpoint with no target draws no edge', () => {
    const doc: OnionFile = { ...withElements(), externals: [{ id: 'x1', name: 'Payments API' }] }
    const model = layoutOnion(doc)
    expect(model.endpoints).toHaveLength(1)
    expect(model.edges.filter((e) => e.kind === 'endpoint')).toHaveLength(0)
  })
})
