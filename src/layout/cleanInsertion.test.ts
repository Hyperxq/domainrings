import { describe, expect, it } from 'vitest'
import { newCleanMap } from '../model/hexa'
import type { CleanFile } from '../model/schema'
import { layoutClean } from './clean'
import { cleanInsertionItem, cleanInsertionPoints } from './cleanInsertion'

describe('cleanInsertionPoints', () => {
  it('offers exactly one "+" per ring for adding a sector, on a fresh (empty) map (REQ-03)', () => {
    const doc = newCleanMap('Fresh')
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const sectorPoints = points.filter((p) => p.action.kind === 'sector')
    expect(sectorPoints).toHaveLength(4)
    expect(sectorPoints.map((p) => p.ringRole).sort()).toEqual(['adapters', 'application', 'domain', 'outer'])
  })

  it('offers one "+" per sector for adding an element (REQ-04), none for a ring with no sectors yet', () => {
    const doc: CleanFile = { ...newCleanMap('Fresh'), sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }] }
    const model = layoutClean(doc)
    const points = cleanInsertionPoints(model, doc)
    const elementPoints = points.filter((p) => p.action.kind === 'element')
    expect(elementPoints).toHaveLength(1)
    expect(elementPoints[0].label).toBe('Add element to Billing')
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
