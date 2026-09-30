import { describe, expect, it } from 'vitest'
import { newCleanMap } from '../model/hexa'
import type { CleanFile } from '../model/schema'
import { layoutClean, tidyCleanOrder } from './clean'
import { countCrossings } from './crossings'
import { arcLabelFootprintBox, ringedElementHeight, ringedElementWidth, titleHalfSpan, TITLE_ARC_PAD } from './ringedMetrics'
import { ringElementRadius } from './ringed'
import { measure, RING_SUBTITLE } from './text'

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
  it('an element sits inside its own ring\'s band (its mid radius, never its outer edge), at an angle strictly inside its sector\'s own span', () => {
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
    const ringIndex = model.rings.findIndex((r) => r.role === 'domain')
    const ring = model.rings[ringIndex]
    expect(Math.hypot(element.x, element.y)).toBeCloseTo(ringElementRadius(ring, model.rings[ringIndex - 1]), 6)
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

// A ring's own curved TITLE already keeps every element clear of it (Decision 5, `ringOutlines`) — but a Clean
// sector's own name (`render/CleanDiagram.tsx`'s `SectorLabel`) is a SEPARATE curved label, centred at its own
// wedge's mid-angle rather than always the top, that `ringOutlines`' sizing never knew to keep clear of. A sector
// with exactly one element places it at that same wedge mid-angle (`arcAngles`' own one-slot placement) — right
// on top of its own sector's label (the reported "Shipping" sector name sitting under the "Shipment" box,
// clean-advanced.hexa).
describe("a ring's own sector label never overlaps its own elements", () => {
  const boxesOverlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2

  it('a lone element in a sector never sits under that sector\'s own curved name', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'A Very Long Sector Name Indeed', ringRole: 'domain' },
        { id: 's2', name: 'Other', ringRole: 'domain' },
      ],
      elements: [{ id: 'e1', name: 'A Very Long Element Name Too', sectorId: 's1' }],
    }
    const model = layoutClean(doc)
    const ringIndex = model.rings.findIndex((r) => r.role === 'domain')
    const ring = model.rings[ringIndex]
    const sector = model.sectors.find((s) => s.ref === 's1')!
    const radius = ringElementRadius(ring, model.rings[ringIndex - 1])
    const centerAngle = (sector.startAngle + sector.endAngle) / 2
    const labelArc = measure(sector.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD
    const labelBox = arcLabelFootprintBox(radius, centerAngle, titleHalfSpan(labelArc, radius))
    const [element] = model.elements
    const elementBox = { x: element.x, y: element.y, width: ringedElementWidth(element.name), height: ringedElementHeight(element.name) }
    expect(boxesOverlap(labelBox, elementBox)).toBe(false)
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
    expect(model.edges).toEqual([
      { key: 'endpoint-edge:a1', kind: 'endpoint', fromRef: 'a1', toRef: 'e1', from: { x: model.endpoints[0].x, y: model.endpoints[0].y }, to: { x: model.elements[0].x, y: model.elements[0].y }, control: expect.any(Object) },
    ])
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
    expect(model.edges).toEqual([
      { key: 'dependency:d1', kind: 'dependency', fromRef: 'e1', toRef: 'e2', from: { x: at('e1').x, y: at('e1').y }, to: { x: at('e2').x, y: at('e2').y }, control: expect.any(Object) },
    ])
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

// The document's own author order (Decision 3 is now an explicit "Tidy ring order" action, never automatic —
// ADR-XX, mirrors onion.test.ts) — the outer sector starts REVERSED against the domain sector's own dependency
// targets.
const crossedDoc: CleanFile = {
  ...newCleanMap('Fresh'),
  sectors: [
    { id: 's-domain', name: 'Core', ringRole: 'domain' },
    { id: 's-outer', name: 'API', ringRole: 'outer' },
  ],
  elements: [
    { id: 'x', name: 'X', sectorId: 's-domain' },
    { id: 'y', name: 'Y', sectorId: 's-domain' },
    { id: 'z', name: 'Z', sectorId: 's-domain' },
    { id: 'c', name: 'C', sectorId: 's-outer' },
    { id: 'b', name: 'B', sectorId: 's-outer' },
    { id: 'a', name: 'A', sectorId: 's-outer' },
  ],
  dependencies: [
    { id: 'd1', fromId: 'a', toId: 'x' },
    { id: 'd2', fromId: 'b', toId: 'y' },
    { id: 'd3', fromId: 'c', toId: 'z' },
  ],
}

describe('layoutClean always respects the document\'s own element order (Decision 3 moved to tidyCleanOrder)', () => {
  it('never silently reorders a sector, even when doing so would reduce crossings', () => {
    const model = layoutClean(crossedDoc)
    expect(model.elements.filter((e) => e.ringRole === 'outer').map((e) => e.ref)).toEqual(['c', 'b', 'a'])
  })
})

describe('tidyCleanOrder — the explicit "Tidy ring order" action (Decision 3)', () => {
  it('rewrites the document into a crossing-minimised order, kept because it actually reduces crossings', () => {
    const before = countCrossings(layoutClean(crossedDoc).edges)
    expect(before).toBeGreaterThan(0)
    const tidied = tidyCleanOrder(crossedDoc)
    expect(tidied).toBeDefined()
    expect(countCrossings(layoutClean(tidied!).edges)).toBeLessThan(before)
  })

  it('touches nothing else in the document', () => {
    const tidied = tidyCleanOrder(crossedDoc)!
    expect(tidied.dependencies).toBe(crossedDoc.dependencies)
    expect(tidied.sectors).toBe(crossedDoc.sectors)
    expect(new Set(tidied.elements.map((e) => e.id))).toEqual(new Set(crossedDoc.elements.map((e) => e.id)))
  })

  it('returns undefined when the current order has no crossings left to reduce', () => {
    expect(tidyCleanOrder(newCleanMap('Fresh'))).toBeUndefined()
  })
})
