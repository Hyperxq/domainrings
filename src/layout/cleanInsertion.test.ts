import { describe, expect, it } from 'vitest'
import { newCleanMap } from '../model/hexa'
import type { CleanFile } from '../model/schema'
import { layoutClean } from './clean'
import { cleanInsertionItem, cleanInsertionPoints } from './cleanInsertion'
import { arcLabelFootprintBox, ringedElementHeight, ringedElementWidth, titleFootprintBox, titleHalfSpan, TITLE_ARC_PAD } from './ringedMetrics'
import { ringElementRadius } from './ringOutlines'
import { measure, RING_LABEL, RING_SUBTITLE } from './text'

describe('cleanInsertionPoints', () => {
  it('offers exactly one "+" per ring for adding a sector, on a fresh (empty) map (REQ-03)', () => {
    const doc = newCleanMap('Fresh')
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const sectorPoints = points.filter((p) => p.action.kind === 'sector')
    expect(sectorPoints).toHaveLength(4)
    expect(sectorPoints.map((p) => p.ringRole).sort()).toEqual(['adapters', 'application', 'domain', 'outer'])
  })

  // Element "+"s already sit at their ring's own mid-band radius (`ringSlotRadii`) — a sector "+" must too, never
  // at the ring's own OUTER edge (`ringCircumferencePositions`' radius), which is exactly the line the ring itself
  // paints its stroke on.
  it('places the "add sector" + at its own ring\'s mid-band radius, not on the ring\'s own outer edge', () => {
    const doc = newCleanMap('Fresh')
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const sectorPoints = points.filter((p) => p.action.kind === 'sector')
    for (const point of sectorPoints) {
      const ringIndex = model.rings.findIndex((r) => r.role === point.ringRole)
      const ring = model.rings[ringIndex]
      const inner = model.rings[ringIndex - 1]
      const expectedRadius = ringElementRadius(ring, inner)
      const actualRadius = Math.hypot(point.at.x, point.at.y)
      expect(actualRadius).toBeCloseTo(expectedRadius, 5)
    }
  })

  // The ring's own title always centres at the TOP (-π/2, `ringOutlines`/`RingedTitle`) — a "+" at the SAME
  // mid-band radius must sit somewhere else around the ring, or it renders directly on top of the title text.
  it('places the "add sector" + away from the top, where its own ring\'s title always centres', () => {
    const doc = newCleanMap('Fresh')
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const sectorPoints = points.filter((p) => p.action.kind === 'sector')
    for (const point of sectorPoints) {
      const angle = Math.atan2(point.at.y, point.at.x)
      expect(angle).not.toBeCloseTo(-Math.PI / 2, 1)
    }
  })

  it('offers one "+" per sector for adding an element (REQ-04), none for a ring with no sectors yet', () => {
    const doc: CleanFile = { ...newCleanMap('Fresh'), sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }] }
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const elementPoints = points.filter((p) => p.action.kind === 'element')
    expect(elementPoints).toHaveLength(1)
    expect(elementPoints[0].label).toBe('Add element to Billing')
    expect((elementPoints[0].action as { beforeId?: string }).beforeId).toBeUndefined()
  })

  it('a sector with elements offers one MORE gap "+" than it has elements (linear wedge: both its own boundaries count)', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }],
      elements: [
        { id: 'e1', name: 'Invoice', sectorId: 's1' },
        { id: 'e2', name: 'Payment', sectorId: 's1' },
      ],
    }
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const elementPoints = points.filter((p) => p.action.kind === 'element')
    expect(elementPoints).toHaveLength(3)
    const beforeIds = elementPoints.map((p) => (p.action as { beforeId?: string }).beforeId)
    // Before e1, between e1 and e2, and after e2 (undefined — appends at the end of the sector's own order).
    expect(beforeIds.filter((id) => id === 'e1')).toHaveLength(1)
    expect(beforeIds.filter((id) => id === 'e2')).toHaveLength(1)
    expect(beforeIds.filter((id) => id === undefined)).toHaveLength(1)
  })

  // A single sector spanning a WHOLE ring (its own wedge a full circle) centres its own curved name at that
  // ring's own bottom (`sectorWedges`' own mid-angle) — the exact spot every "+" on that ring, gap or "add
  // sector", already had to keep clear of the ring's own TOP title. Neither the gap "+"s' own isolated
  // `ringSlotRadii` call nor the ring-level "add sector" +'s own fixed-bottom placement knew to check a SECTOR's
  // own label until now — this pins that they do.
  it('no "+" (gap, or "add sector") ever sits on the ring\'s own title, a sector\'s own name, or an element\'s own box', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'Ordering', ringRole: 'domain' }],
      elements: [
        { id: 'e1', name: 'Order', sectorId: 's1' },
        { id: 'e2', name: 'OrderLine', sectorId: 's1' },
        { id: 'e3', name: 'Payment', sectorId: 's1' },
      ],
    }
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const ring = model.rings.find((r) => r.role === 'domain')!
    const inner = undefined
    const boxesOverlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2

    const titleBox = titleFootprintBox(ringElementRadius(ring, inner), measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD)
    const sector = model.sectors[0]
    const labelHalf = titleHalfSpan(measure(sector.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD, ringElementRadius(ring, inner))
    const labelBox = arcLabelFootprintBox(ringElementRadius(ring, inner), (sector.startAngle + sector.endAngle) / 2, labelHalf)
    const elementBoxes = model.elements.map((e) => ({ x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }))

    const PLUS_DIAMETER = 20 // PlusGlyph's own circle radius (10) doubled.
    for (const point of points.filter((p) => p.ringRole === 'domain')) {
      const plusBox = { x: point.at.x, y: point.at.y, width: PLUS_DIAMETER, height: PLUS_DIAMETER }
      expect(boxesOverlap(plusBox, titleBox), `"${point.label}" sits on the ring's own title`).toBe(false)
      expect(boxesOverlap(plusBox, labelBox), `"${point.label}" sits on "${sector.name}"`).toBe(false)
      for (const box of elementBoxes) expect(boxesOverlap(plusBox, box), `"${point.label}" sits on an element box`).toBe(false)
    }
  })

  it('offers an actor and an external "+" for every outer-ring element, and none for an inner-ring one (REQ-07)', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's-inner', name: 'Core', ringRole: 'domain' },
        { id: 's-outer', name: 'API', ringRole: 'outer' },
      ],
      elements: [
        { id: 'e-inner', name: 'Order', sectorId: 's-inner' },
        { id: 'e-outer', name: 'Controller', sectorId: 's-outer' },
      ],
    }
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const endpointPoints = points.filter((p) => p.action.kind === 'endpoint')
    expect(endpointPoints).toHaveLength(2)
    expect(endpointPoints.every((p) => (p.action as { targetId: string }).targetId === 'e-outer')).toBe(true)
  })
})

describe('cleanInsertionItem', () => {
  it('carries a gap\'s own beforeId through to the caller, for an insert-at-position add', () => {
    const item = cleanInsertionItem({ kind: 'element', sectorId: 's1', beforeId: 'e2' })
    expect(item).toEqual({ kind: 'element', patch: { name: 'NewElement', sectorId: 's1' }, beforeId: 'e2' })
  })

  it('builds a sector patch carrying the ring it was added from', () => {
    const item = cleanInsertionItem({ kind: 'sector', ringRole: 'application' })
    expect(item).toEqual({ kind: 'sector', patch: { name: 'NewSector', ringRole: 'application' } })
  })

  it('builds an element patch carrying the sector it was added from', () => {
    const item = cleanInsertionItem({ kind: 'element', sectorId: 's1' })
    expect(item).toEqual({ kind: 'element', patch: { name: 'NewElement', sectorId: 's1' } })
  })

  it('builds an actor patch already targeting the outer-ring element it was added from', () => {
    const item = cleanInsertionItem({ kind: 'endpoint', collection: 'actors', targetId: 'e-outer' })
    expect(item).toEqual({ kind: 'endpoint', collection: 'actors', patch: { name: 'New actor', targetId: 'e-outer' } })
  })
})
