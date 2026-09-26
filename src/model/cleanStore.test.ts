import { describe, expect, it } from 'vitest'
import { newCleanMap } from './hexa'
import { useCleanStore } from './cleanStore'

const state = () => useCleanStore.getState()

describe('clean store', () => {
  it('boots with a fresh Clean map: 4 canonical rings, empty collections, revision 0', () => {
    expect(state().map.kind).toBe('clean')
    expect(state().map.rings.map((r) => r.role)).toEqual(['domain', 'application', 'adapters', 'outer'])
    expect(state().map.sectors).toEqual([])
    expect(state().map.elements).toEqual([])
    expect(state().revision).toBe(0)
  })

  it('replace swaps the map and bumps the revision, mirroring useOnionStore (ADR-02)', () => {
    const before = state().revision
    const next = newCleanMap('Swapped')
    state().replace(next)
    expect(state().map).toBe(next)
    expect(state().revision).toBe(before + 1)
  })

  it('restore without swap puts the map back but leaves the revision alone', () => {
    const original = state().map
    const revisionBefore = state().revision
    state().replace(newCleanMap('Edited'))
    state().restore({ map: original })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionBefore + 1) // the replace() in between already bumped it once
  })

  it('restore with swap: true bumps the revision like replace does', () => {
    const original = state().map
    state().replace(newCleanMap('Edited'))
    const revisionAfterReplace = state().revision
    state().restore({ map: original, swap: true })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionAfterReplace + 1)
  })
})

describe('sectors (REQ-03: free, user-named, any ring, any count including zero)', () => {
  it('addSector adds a free, user-named sector — growing past one, not just a single case', () => {
    state().replace(newCleanMap('Fresh'))
    expect(state().map.sectors).toEqual([])
    const first = state().addSector({ name: 'Billing', ringRole: 'domain' })
    expect(state().map.sectors).toEqual([{ id: first, name: 'Billing', ringRole: 'domain' }])
    state().addSector({ name: 'Catalog', ringRole: 'domain' })
    state().addSector({ name: 'Shipping', ringRole: 'application' })
    expect(state().map.sectors).toHaveLength(3)
  })

  it('updateSector renames a sector in place', () => {
    state().replace(newCleanMap('Fresh'))
    const id = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().updateSector(id, { name: 'Invoicing' })
    expect(state().map.sectors[0].name).toBe('Invoicing')
  })

  it('removeSector removes the sector and cascade-prunes its own elements, mirroring removeElement\'s idiom', () => {
    state().replace(newCleanMap('Fresh'))
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId })
    state().removeSector(sectorId)
    expect(state().map.sectors).toEqual([])
    expect(state().map.elements).toEqual([])
  })

  it('removeSector leaves other sectors and their own elements untouched', () => {
    state().replace(newCleanMap('Fresh'))
    const keptSectorId = state().addSector({ name: 'Catalog', ringRole: 'domain' })
    const keptElementId = state().addElement({ name: 'Product', sectorId: keptSectorId })
    const droppedSectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId: droppedSectorId })

    state().removeSector(droppedSectorId)

    expect(state().map.sectors).toEqual([{ id: keptSectorId, name: 'Catalog', ringRole: 'domain' }])
    expect(state().map.elements).toEqual([{ id: keptElementId, name: 'Product', sectorId: keptSectorId }])
  })
})

describe('elements (REQ-04: every element belongs to a sector, never directly to a ring)', () => {
  it('addElement attaches the element to the given sector — sectorId is required by the type, no ring-direct path', () => {
    state().replace(newCleanMap('Fresh'))
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const id = state().addElement({ name: 'Invoice', sectorId })
    expect(state().map.elements).toEqual([{ id, name: 'Invoice', sectorId }])
  })

  it('updateElement renames an element in place', () => {
    state().replace(newCleanMap('Fresh'))
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const id = state().addElement({ name: 'Invoice', sectorId })
    state().updateElement(id, { name: 'Invoice v2' })
    expect(state().map.elements[0].name).toBe('Invoice v2')
  })

  it('removeElement removes just that element, leaving its sector and siblings intact', () => {
    state().replace(newCleanMap('Fresh'))
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const keptId = state().addElement({ name: 'Invoice', sectorId })
    const removedId = state().addElement({ name: 'Credit note', sectorId })
    state().removeElement(removedId)
    expect(state().map.elements).toEqual([{ id: keptId, name: 'Invoice', sectorId }])
    expect(state().map.sectors).toEqual([{ id: sectorId, name: 'Billing', ringRole: 'domain' }])
  })
})
