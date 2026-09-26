import { describe, expect, it } from 'vitest'
import { newCleanMap } from '../model/hexa'
import type { CleanFile } from '../model/schema'
import { layoutClean } from './clean'

describe('layoutClean — sector wedges (REQ-08)', () => {
  it('a ring with no sectors has no wedges', () => {
    const model = layoutClean(newCleanMap('Fresh'))
    expect(model.sectors).toEqual([])
  })

  it('N sectors on a ring split it into N equal, non-overlapping wedge spans', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
        { id: 's3', name: 'Shipping', ringRole: 'domain' },
      ],
    }
    const model = layoutClean(doc)
    expect(model.sectors).toHaveLength(3)
    const spans = model.sectors.map((s) => s.endAngle - s.startAngle)
    for (const span of spans) expect(span).toBeCloseTo((2 * Math.PI) / 3, 6)
    // Non-overlapping and contiguous: sorted by start angle, each one's end is the next one's start.
    const sorted = [...model.sectors].sort((a, b) => a.startAngle - b.startAngle)
    for (let i = 0; i < sorted.length - 1; i++) expect(sorted[i].endAngle).toBeCloseTo(sorted[i + 1].startAngle, 6)
  })

  it('sectors in different rings are independent — each ring divides its own full circle', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
        { id: 's3', name: 'API', ringRole: 'outer' },
      ],
    }
    const model = layoutClean(doc)
    const domainSectors = model.sectors.filter((s) => s.ringRole === 'domain')
    const outerSectors = model.sectors.filter((s) => s.ringRole === 'outer')
    expect(domainSectors).toHaveLength(2)
    expect(outerSectors).toHaveLength(1)
    expect(outerSectors[0].endAngle - outerSectors[0].startAngle).toBeCloseTo(2 * Math.PI, 6)
  })
})

describe('layoutClean — elements placed inside their own sector\'s wedge (REQ-08)', () => {
  it('an element sits at the ring radius, at an angle strictly inside its sector\'s own span', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
      ],
      elements: [{ id: 'e1', name: 'Invoice', sectorId: 's1' }],
    }
    const model = layoutClean(doc)
    const [element] = model.elements
    const sector = model.sectors.find((s) => s.ref === 's1')!
    const ring = model.rings.find((r) => r.role === 'domain')!
    expect(Math.hypot(element.x, element.y)).toBeCloseTo(ring.apex, 6)
    const angle = Math.atan2(element.y, element.x)
    expect(angle).toBeGreaterThan(sector.startAngle)
    expect(angle).toBeLessThan(sector.endAngle)
  })

  it('never spreads a sector\'s elements across the whole ring — only across its own wedge', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
      ],
      elements: [
        { id: 'e1', name: 'Invoice', sectorId: 's1' },
        { id: 'e2', name: 'Credit note', sectorId: 's1' },
      ],
    }
    const model = layoutClean(doc)
    const sector = model.sectors.find((s) => s.ref === 's1')!
    for (const element of model.elements) {
      const angle = Math.atan2(element.y, element.x)
      expect(angle).toBeGreaterThan(sector.startAngle)
      expect(angle).toBeLessThan(sector.endAngle)
    }
  })
})

describe('layoutClean — endpoints and edges (REQ-06/REQ-07, same placement contract as Onion)', () => {
  it('an actor/external sits outside the outer ring, with an edge to its target', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'API', ringRole: 'outer' }],
      elements: [{ id: 'e1', name: 'Controller', sectorId: 's1' }],
      actors: [{ id: 'a1', name: 'Customer', targetId: 'e1' }],
    }
    const model = layoutClean(doc)
    expect(model.endpoints).toHaveLength(1)
    const outerRing = model.rings[model.rings.length - 1]
    expect(Math.hypot(model.endpoints[0].x, model.endpoints[0].y)).toBeGreaterThan(outerRing.apex)
    expect(model.edges).toEqual([{ key: 'endpoint-edge:a1', kind: 'endpoint', from: { x: model.endpoints[0].x, y: model.endpoints[0].y }, to: { x: model.elements[0].x, y: model.elements[0].y } }])
  })

  it('a dependency between two elements produces an edge between their laid-out positions', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'API', ringRole: 'outer' },
        { id: 's2', name: 'Core', ringRole: 'domain' },
      ],
      elements: [
        { id: 'e1', name: 'Controller', sectorId: 's1' },
        { id: 'e2', name: 'Order', sectorId: 's2' },
      ],
      dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2' }],
    }
    const model = layoutClean(doc)
    const at = (ref: string) => model.elements.find((e) => e.ref === ref)!
    expect(model.edges).toEqual([{ key: 'dependency:d1', kind: 'dependency', from: { x: at('e1').x, y: at('e1').y }, to: { x: at('e2').x, y: at('e2').y } }])
  })

  it('bounds grow to include the endpoint ring when actors/externals exist', () => {
    const plain = layoutClean(newCleanMap('Fresh'))
    const withActor: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'API', ringRole: 'outer' }],
      elements: [{ id: 'e1', name: 'Controller', sectorId: 's1' }],
      actors: [{ id: 'a1', name: 'Customer', targetId: 'e1' }],
    }
    const withActorModel = layoutClean(withActor)
    expect(withActorModel.bounds.width).toBeGreaterThan(plain.bounds.width)
  })
})
