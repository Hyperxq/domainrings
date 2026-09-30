import { describe, expect, it } from 'vitest'
import { newOnionMap } from '../model/hexa'
import type { OnionFile } from '../model/schema'
import { layoutOnion } from './onion'
import { onionInsertionItem, onionInsertionPoints } from './onionInsertion'
import { ringedElementHeight, ringedElementWidth } from './ringedMetrics'

describe('onionInsertionPoints', () => {
  it('offers exactly one "+" per ring, ring-scoped, on a fresh (empty) map', () => {
    const doc = newOnionMap('Fresh')
    const model = layoutOnion(doc)
    const points = onionInsertionPoints(model, doc)
    const elementPoints = points.filter((p) => p.action.kind === 'element')
    expect(elementPoints).toHaveLength(4)
    expect(elementPoints.map((p) => p.ringRole).sort()).toEqual(['application', 'domain', 'domainServices', 'outer'])
  })

  it('offers an actor and an external "+" for every outer-ring element, and none for an inner-ring one', () => {
    const doc: OnionFile = {
      ...newOnionMap('Fresh'),
      elements: [
        { id: 'e-inner', name: 'Order', ringRole: 'domain' },
        { id: 'e-outer', name: 'Controller', ringRole: 'outer' },
      ],
    }
    const model = layoutOnion(doc)
    const points = onionInsertionPoints(model, doc)
    const endpointPoints = points.filter((p) => p.action.kind === 'endpoint')
    expect(endpointPoints).toHaveLength(2)
    expect(endpointPoints.map((p) => (p.action as { collection: string }).collection).sort()).toEqual(['actors', 'externals'])
    expect(endpointPoints.every((p) => (p.action as { targetId: string }).targetId === 'e-outer')).toBe(true)
  })
})

describe('onionInsertionPoints — one gap "+" per neighbour pair, circular (Onion\'s whole ring)', () => {
  const doc: OnionFile = {
    ...newOnionMap('Fresh'),
    elements: [
      { id: 'e1', name: 'Order', ringRole: 'domain' },
      { id: 'e2', name: 'OrderLine', ringRole: 'domain' },
      { id: 'e3', name: 'Payment', ringRole: 'domain' },
    ],
  }

  it('offers exactly one gap per element on a 3-element ring (circular: N elements, N gaps)', () => {
    const model = layoutOnion(doc)
    const points = onionInsertionPoints(model, doc)
    const domainPoints = points.filter((p) => p.action.kind === 'element' && p.ringRole === 'domain')
    expect(domainPoints).toHaveLength(3)
  })

  it('each gap\'s action carries the id of the neighbour a click would insert the new element before', () => {
    const model = layoutOnion(doc)
    const points = onionInsertionPoints(model, doc)
    const domainPoints = points.filter((p) => p.action.kind === 'element' && p.ringRole === 'domain')
    const beforeIds = domainPoints.map((p) => (p.action as { beforeId?: string }).beforeId).sort()
    // Every element is named as SOME gap's own neighbour (including the wraparound one) — e1 twice over would mean
    // a gap was lost or duplicated.
    expect(beforeIds).toEqual(['e1', 'e2', 'e3'])
  })

  it('a single-element ring still offers exactly one gap (the whole rest of the circle)', () => {
    const single: OnionFile = { ...newOnionMap('Fresh'), elements: [{ id: 'e1', name: 'Order', ringRole: 'domain' }] }
    const model = layoutOnion(single)
    const points = onionInsertionPoints(model, single)
    const domainPoints = points.filter((p) => p.action.kind === 'element' && p.ringRole === 'domain')
    expect(domainPoints).toHaveLength(1)
    expect((domainPoints[0].action as { beforeId?: string }).beforeId).toBe('e1')
  })

  it('an empty ring keeps its own single "add here" +, with no beforeId (appends)', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    const points = onionInsertionPoints(model, newOnionMap('Fresh'))
    const domainPoints = points.filter((p) => p.action.kind === 'element' && p.ringRole === 'domain')
    expect(domainPoints).toHaveLength(1)
    expect((domainPoints[0].action as { beforeId?: string }).beforeId).toBeUndefined()
  })

  // A wide neighbour's own box (a long name) can reach into a gap's own default mid-band radius even though the
  // gap's own ANGLE is correctly the midpoint between its two neighbours — the angle alone doesn't guarantee
  // radial clearance on a small ring.
  it('no gap "+" ever sits on either of the two elements it names as neighbours', () => {
    const doc: OnionFile = {
      ...newOnionMap('Fresh'),
      elements: [
        { id: 'e1', name: 'Order', ringRole: 'domain' },
        { id: 'e2', name: 'OrderLine', ringRole: 'domain' },
        { id: 'e3', name: 'Payment', ringRole: 'domain' },
      ],
    }
    const model = layoutOnion(doc)
    const points = onionInsertionPoints(model, doc).filter((p) => p.ringRole === 'domain')
    const boxesOverlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2
    const elementBoxes = model.elements.map((e) => ({ name: e.name, x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }))
    const PLUS_DIAMETER = 20
    for (const point of points) {
      const plusBox = { x: point.at.x, y: point.at.y, width: PLUS_DIAMETER, height: PLUS_DIAMETER }
      for (const box of elementBoxes) expect(boxesOverlap(plusBox, box), `"${point.label}" sits on "${box.name}"`).toBe(false)
    }
  })
})

describe('onionInsertionItem', () => {
  it('builds an element patch carrying the ring it was added from', () => {
    const item = onionInsertionItem({ kind: 'element', ringRole: 'application' })
    expect(item).toEqual({ kind: 'element', patch: { name: 'NewElement', ringRole: 'application' } })
  })

  it('carries a gap\'s own beforeId through to the caller, for an insert-at-position add', () => {
    const item = onionInsertionItem({ kind: 'element', ringRole: 'application', beforeId: 'e2' })
    expect(item).toEqual({ kind: 'element', patch: { name: 'NewElement', ringRole: 'application' }, beforeId: 'e2' })
  })

  it('builds an actor patch already targeting the outer-ring element it was added from', () => {
    const item = onionInsertionItem({ kind: 'endpoint', collection: 'actors', targetId: 'e-outer' })
    expect(item).toEqual({ kind: 'endpoint', collection: 'actors', patch: { name: 'New actor', targetId: 'e-outer' } })
  })

  it('builds an external patch the same way', () => {
    const item = onionInsertionItem({ kind: 'endpoint', collection: 'externals', targetId: 'e-outer' })
    expect(item).toEqual({ kind: 'endpoint', collection: 'externals', patch: { name: 'New system', targetId: 'e-outer' } })
  })
})

describe('onionInsertionPoints (user-added rings)', () => {
  it('offers a "+" on a user-added ring that adds an element to it', () => {
    const doc: OnionFile = { ...newOnionMap('Rings'), rings: [{ role: 'domain', name: 'Core' }, { role: 'ring-a1b2c3d4', name: 'Events' }, { role: 'outer', name: 'Edge' }] }
    const points = onionInsertionPoints(layoutOnion(doc), doc)
    expect(points.filter((p) => p.action.kind === 'element' && p.action.ringRole === 'ring-a1b2c3d4')).not.toHaveLength(0)
  })
})
