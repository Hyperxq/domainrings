import { describe, expect, it } from 'vitest'
import { newOnionMap } from './hexa'
import { useOnionStore } from './onionStore'

const state = () => useOnionStore.getState()

describe('onion store', () => {
  it('starts with a fresh onion map and revision 0', () => {
    expect(state().map.kind).toBe('onion')
    expect(state().revision).toBe(0)
  })

  it('replace swaps the map and bumps the revision, mirroring useMapStore (ADR-02)', () => {
    const before = state().revision
    const next = newOnionMap('Swapped')
    state().replace(next)
    expect(state().map).toBe(next)
    expect(state().revision).toBe(before + 1)
  })

  it('restore without swap puts the map back but leaves the revision alone', () => {
    const original = state().map
    const revisionBefore = state().revision
    state().replace(newOnionMap('Edited'))
    state().restore({ map: original })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionBefore + 1) // the replace() in between already bumped it once
  })

  it('restore with swap: true bumps the revision like replace does', () => {
    const original = state().map
    state().replace(newOnionMap('Edited'))
    const revisionAfterReplace = state().revision
    state().restore({ map: original, swap: true })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionAfterReplace + 1)
  })
})

describe('onion store — elements (REQ-07)', () => {
  it('addElement adds a named element to the given ring', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0]).toMatchObject({ id, name: 'Order', ringRole: 'domain' })
  })

  it('updateElement renames an element in place', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    state().updateElement(id, { name: 'Purchase Order' })
    expect(state().map.elements[0].name).toBe('Purchase Order')
  })

  it('updateElement rejects (no-ops) a ring change that would break an existing dependency', () => {
    state().replace(newOnionMap('Fresh'))
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    const appId = state().addElement({ name: 'OrderService', ringRole: 'application' })
    state().addDependency(appId, domainId) // application → domain: inward, accepted
    const before = state().map
    // Moving the depended-on element outward would make the existing dependency point outward too.
    state().updateElement(domainId, { ringRole: 'outer' })
    expect(state().map).toBe(before)
  })

  it('removeElement removes the element, prunes dependencies referencing it, and clears endpoint targets pointing to it', () => {
    state().replace(newOnionMap('Fresh'))
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const appId = state().addElement({ name: 'Service', ringRole: 'application' })
    state().addDependency(outerId, appId)
    state().addEndpoint('actors', { name: 'Customer', targetId: outerId })

    state().removeElement(outerId)

    expect(state().map.elements.map((e) => e.id)).toEqual([appId])
    expect(state().map.dependencies).toEqual([])
    expect(state().map.actors[0].targetId).toBeUndefined()
  })
})

describe('onion store — dependencies (REQ-04)', () => {
  it('addDependency succeeds on an inward pair', () => {
    state().replace(newOnionMap('Fresh'))
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    const id = state().addDependency(outerId, domainId)
    expect(id).toBeDefined()
    expect(state().map.dependencies).toEqual([{ id, fromId: outerId, toId: domainId }])
  })

  it('addDependency no-ops on an outward pair (REQ-04)', () => {
    state().replace(newOnionMap('Fresh'))
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const before = state().map
    const id = state().addDependency(domainId, outerId)
    expect(id).toBeUndefined()
    expect(state().map).toBe(before)
  })

  it('removeDependency removes an existing dependency', () => {
    state().replace(newOnionMap('Fresh'))
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    const id = state().addDependency(outerId, domainId)!
    state().removeDependency(id)
    expect(state().map.dependencies).toEqual([])
  })
})

describe('onion store — endpoints (REQ-05)', () => {
  it('addEndpoint succeeds when the target is an outer-ring element', () => {
    state().replace(newOnionMap('Fresh'))
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const id = state().addEndpoint('actors', { name: 'Customer', targetId: outerId })
    expect(id).toBeDefined()
    expect(state().map.actors).toEqual([{ id, name: 'Customer', targetId: outerId }])
  })

  it('addEndpoint no-ops when the target is not an outer-ring element (REQ-05)', () => {
    state().replace(newOnionMap('Fresh'))
    const appId = state().addElement({ name: 'OrderService', ringRole: 'application' })
    const before = state().map
    const id = state().addEndpoint('externals', { name: 'Payments API', targetId: appId })
    expect(id).toBeUndefined()
    expect(state().map).toBe(before)
  })

  it('removeEndpoint removes an existing actor or external', () => {
    state().replace(newOnionMap('Fresh'))
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const id = state().addEndpoint('actors', { name: 'Customer', targetId: outerId })!
    state().removeEndpoint('actors', id)
    expect(state().map.actors).toEqual([])
  })
})
