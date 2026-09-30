import { describe, expect, it } from 'vitest'
import { newOnionMap } from '../model/hexa'
import type { OnionFile } from '../model/schema'
import { countCrossings } from './crossings'
import { layoutOnion, tidyOnionOrder } from './onion'
import { ringElementRadius } from './ringed'

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

  it('spreads N elements on the same ring at distinct positions inside that ring\'s own band (its mid radius, never its outer edge)', () => {
    const model = layoutOnion(withElements())
    const outerIndex = model.rings.findIndex((r) => r.role === 'outer')
    const outerRing = model.rings[outerIndex]
    const [e3, e4] = ['e3', 'e4'].map((ref) => model.elements.find((e) => e.ref === ref)!)
    expect(e3.x !== e4.x || e3.y !== e4.y).toBe(true)
    const radius = ringElementRadius(outerRing, model.rings[outerIndex - 1])
    for (const e of [e3, e4]) expect(Math.hypot(e.x, e.y)).toBeCloseTo(radius, 6)
  })

  // A ring with exactly one element always used to place it at the same dead-bottom angle (`arcAngles`' own
  // single-count spacing) regardless of which ring — a document made of nothing but single-element rings (Onion's
  // most common small shape, onion-basic.hexa) stacked every one of them into one straight vertical column, even
  // though concentric rings were never meant to read as a stack.
  it('a chain of single-element rings staggers their angles instead of stacking into one column', () => {
    const doc: OnionFile = {
      ...newOnionMap('Fresh'),
      elements: [
        { id: 'e1', name: 'Order', ringRole: 'domain' },
        { id: 'e2', name: 'PricingService', ringRole: 'domainServices' },
        { id: 'e3', name: 'PlaceOrderService', ringRole: 'application' },
        { id: 'e4', name: 'OrderController', ringRole: 'outer' },
      ],
    }
    const model = layoutOnion(doc)
    const angleOf = (e: { x: number; y: number }) => Math.atan2(e.y, e.x)
    const angles = model.elements.map(angleOf)
    // Not every angle identical (the reported straight column) — each stays in the bottom half (never risking the
    // rings' own top-centred titles).
    expect(new Set(angles.map((a) => a.toFixed(3))).size).toBeGreaterThan(1)
    for (const a of angles) expect(Math.sin(a)).toBeGreaterThan(0)
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

  // Decision 1 (Overview mode): the canvas filters edges down to the ones touching a hovered/selected element,
  // which needs the two element refs an edge connects, not just its endpoints' screen coordinates.
  it('carries the fromId/toId refs of the elements it connects', () => {
    const doc: OnionFile = { ...withElements(), dependencies: [{ id: 'd1', fromId: 'e3', toId: 'e2' }] }
    const model = layoutOnion(doc)
    expect(model.edges[0]).toMatchObject({ fromRef: 'e3', toRef: 'e2' })
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
    expect(edge).toMatchObject({ fromRef: 'a1', toRef: 'e3' })
  })

  it('an endpoint with no target draws no edge', () => {
    const doc: OnionFile = { ...withElements(), externals: [{ id: 'x1', name: 'Payments API' }] }
    const model = layoutOnion(doc)
    expect(model.endpoints).toHaveLength(1)
    expect(model.edges.filter((e) => e.kind === 'endpoint')).toHaveLength(0)
  })
})

// The document's own author order (Decision 3 is now an explicit "Tidy ring order" action, never automatic —
// ADR-XX) — outer starts REVERSED against domain's own dependency targets, the same crossed scenario
// `crossingMinimization.test.ts` reorders on its own terms.
const crossedDoc: OnionFile = {
  ...newOnionMap('Fresh'),
  elements: [
    { id: 'x', name: 'X', ringRole: 'domain' },
    { id: 'y', name: 'Y', ringRole: 'domain' },
    { id: 'z', name: 'Z', ringRole: 'domain' },
    { id: 'c', name: 'C', ringRole: 'outer' },
    { id: 'b', name: 'B', ringRole: 'outer' },
    { id: 'a', name: 'A', ringRole: 'outer' },
  ],
  dependencies: [
    { id: 'd1', fromId: 'a', toId: 'x' },
    { id: 'd2', fromId: 'b', toId: 'y' },
    { id: 'd3', fromId: 'c', toId: 'z' },
  ],
}

describe('layoutOnion always respects the document\'s own element order (Decision 3 moved to tidyOnionOrder)', () => {
  it('never silently reorders a ring, even when doing so would reduce crossings', () => {
    const model = layoutOnion(crossedDoc)
    expect(model.elements.filter((e) => e.ringRole === 'outer').map((e) => e.ref)).toEqual(['c', 'b', 'a'])
  })
})

describe('tidyOnionOrder — the explicit "Tidy ring order" action (Decision 3)', () => {
  it('rewrites the document into a crossing-minimised order, kept because it actually reduces crossings', () => {
    const before = countCrossings(layoutOnion(crossedDoc).edges)
    expect(before).toBeGreaterThan(0)
    const tidied = tidyOnionOrder(crossedDoc)
    expect(tidied).toBeDefined()
    expect(countCrossings(layoutOnion(tidied!).edges)).toBeLessThan(before)
  })

  it('touches nothing else in the document', () => {
    const tidied = tidyOnionOrder(crossedDoc)!
    expect(tidied.dependencies).toBe(crossedDoc.dependencies)
    expect(tidied.rings).toBe(crossedDoc.rings)
    expect(new Set(tidied.elements.map((e) => e.id))).toEqual(new Set(crossedDoc.elements.map((e) => e.id)))
  })

  it('returns undefined when the current order has no crossings left to reduce', () => {
    expect(tidyOnionOrder(newOnionMap('Fresh'))).toBeUndefined()
  })
})

describe('layoutOnion (any ring count)', () => {
  const ring = (role: string, name: string) => ({ role, name })
  const doc = (rings: OnionFile['rings'], elements: OnionFile['elements'] = [], dependencies: OnionFile['dependencies'] = []): OnionFile => ({ ...newOnionMap('Rings'), rings, elements, dependencies })

  it.each([
    ['two rings', [ring('domain', 'Core'), ring('outer', 'Edge')]],
    ['three rings', [ring('domain', 'Core'), ring('ring-a1b2c3d4', 'Events'), ring('outer', 'Edge')]],
    ['five rings', [ring('domain', 'Core'), ring('domainServices', 'Services'), ring('ring-a1b2c3d4', 'Events'), ring('application', 'App'), ring('outer', 'Edge')]],
  ])('lays out %s, each strictly inside the next, and places an element on each ring at its own radius', (_name, rings) => {
    const elements = rings.map((r, i) => ({ id: `e${i}`, name: `Item${i}`, ringRole: r.role }))
    const model = layoutOnion(doc(rings, elements))
    expect(model.rings.map((r) => r.role)).toEqual(rings.map((r) => r.role))
    for (let i = 0; i < model.rings.length - 1; i++) expect(model.rings[i].apex).toBeLessThan(model.rings[i + 1].apex)
    model.elements.forEach((e, i) => {
      const radius = ringElementRadius(model.rings[i], model.rings[i - 1])
      expect(Math.hypot(e.x, e.y)).toBeCloseTo(radius, 0)
    })
  })

  it('draws a dependency between elements of a user-added ring and an inner ring', () => {
    const rings = [ring('domain', 'Core'), ring('ring-a1b2c3d4', 'Events'), ring('outer', 'Edge')]
    const elements = [
      { id: 'a', name: 'Order', ringRole: 'domain' },
      { id: 'b', name: 'OrderPlaced', ringRole: 'ring-a1b2c3d4' },
    ]
    const model = layoutOnion(doc(rings, elements, [{ id: 'd', fromId: 'b', toId: 'a' }]))
    expect(model.edges.filter((e) => e.kind === 'dependency')).toHaveLength(1)
  })

  it('anchors actors outside the last ring whichever ring that is', () => {
    const rings = [ring('domain', 'Core'), ring('outer', 'Edge')]
    const model = layoutOnion({ ...doc(rings, [{ id: 'w', name: 'Web', ringRole: 'outer' }]), actors: [{ id: 'u', name: 'User', targetId: 'w' }] })
    const outer = model.rings[1]
    expect(Math.hypot(model.endpoints[0].x, model.endpoints[0].y)).toBeGreaterThan(outer.halfWidth)
  })
})
