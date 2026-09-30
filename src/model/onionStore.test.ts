import { describe, expect, it } from 'vitest'
import { newOnionMap } from './hexa'
import { useOnionStore } from './onionStore'
import { OnionFileSchema } from './schema'

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

  it('addElement inserts before an existing element when a beforeId is given (REQ: gap "+" insert-at-position)', () => {
    state().replace(newOnionMap('Fresh'))
    const e1 = state().addElement({ name: 'Order', ringRole: 'domain' })
    const e3 = state().addElement({ name: 'Payment', ringRole: 'domain' })
    const e2 = state().addElement({ name: 'OrderLine', ringRole: 'domain' }, e3)
    expect(state().map.elements.map((e) => e.id)).toEqual([e1, e2, e3])
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

describe('onion store — title', () => {
  it('setTitle renames the document, leaving everything else untouched', () => {
    state().replace(newOnionMap('Fresh'))
    const before = state().map
    state().setTitle('Payments')
    expect(state().map).toEqual({ ...before, title: 'Payments' })
  })
})

describe('onion store — element kinds', () => {
  it('updateElement sets and clears a kind allowed in the element\'s ring', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    state().updateElement(id, { kind: 'aggregate' })
    expect(state().map.elements[0].kind).toBe('aggregate')
    state().updateElement(id, { kind: undefined })
    expect(state().map.elements[0].kind).toBeUndefined()
  })

  it('updateElement rejects (no-ops) a kind the element\'s ring does not allow', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    const before = state().map
    state().updateElement(id, { kind: 'controller' as never })
    expect(state().map).toBe(before)
  })

  it('moving an element to a ring that does not allow its kind clears the kind in the same edit', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain', kind: 'entity' })
    state().updateElement(id, { ringRole: 'application' })
    expect(state().map.elements[0]).toMatchObject({ ringRole: 'application' })
    expect(state().map.elements[0].kind).toBeUndefined()
  })

  it('moving an element to a ring that still allows its kind keeps it', () => {
    state().replace(newOnionMap('Fresh'))
    const id = state().addElement({ name: 'Order', ringRole: 'domain', kind: 'entity' })
    state().updateElement(id, { ringRole: 'domain' })
    expect(state().map.elements[0].kind).toBe('entity')
  })
})

describe('onion store — editable rings', () => {
  const roles = () => state().map.rings.map((r) => r.role)
  const seed = () => {
    state().replace(newOnionMap('Rings'))
    const order = state().addElement({ name: 'Order', ringRole: 'domain', kind: 'entity' })
    const pricing = state().addElement({ name: 'Pricing', ringRole: 'domainServices', kind: 'domainService' })
    const plain = state().addElement({ name: 'Rules', ringRole: 'domainServices' })
    const place = state().addElement({ name: 'PlaceOrder', ringRole: 'application', kind: 'applicationService' })
    const web = state().addElement({ name: 'Web', ringRole: 'outer', kind: 'ui' })
    return { order, pricing, plain, place, web }
  }

  it('renames a ring without touching its id or its elements', () => {
    seed()
    state().renameRing('application', 'Use cases')
    expect(state().map.rings[2]).toEqual({ role: 'application', name: 'Use cases' })
    expect(state().map.elements.filter((e) => e.ringRole === 'application')).toHaveLength(1)
  })

  it('renames the innermost and the outermost ring', () => {
    seed()
    state().renameRing('domain', 'Core')
    state().renameRing('outer', 'Edge')
    expect(state().map.rings.map((r) => r.name)).toEqual(['Core', 'Domain Services', 'Application Services', 'Edge'])
  })

  it('adds a ring just inside the outermost one, with a fresh id and no kinds', () => {
    seed()
    const role = state().addRing('Events')
    expect(roles()).toEqual(['domain', 'domainServices', 'application', role, 'outer'])
    expect(state().map.rings[3].name).toBe('Events')
    expect(role).not.toBe('outer')
    expect(OnionFileSchema.safeParse(state().map).success).toBe(true)
  })

  it('never removes the innermost or the outermost ring', () => {
    seed()
    const before = state().map
    expect(state().removeRing('domain')).toBeUndefined()
    expect(state().removeRing('outer')).toBeUndefined()
    expect(state().map).toBe(before)
  })

  it('never removes a ring that is not there', () => {
    seed()
    const before = state().map
    expect(state().removeRing('nope')).toBeUndefined()
    expect(state().map).toBe(before)
  })

  it('removing a ring moves its elements to the next inner ring and clears the kinds that ring does not allow', () => {
    const { order, pricing, plain } = seed()
    const result = state().removeRing('domainServices')
    expect(result).toEqual({ into: 'Domain Model', moved: 2, cleared: 1, pruned: 0 })
    expect(roles()).toEqual(['domain', 'application', 'outer'])
    const byId = new Map(state().map.elements.map((e) => [e.id, e]))
    expect(byId.get(pricing)).toMatchObject({ ringRole: 'domain', kind: undefined })
    expect(byId.get(plain)).toMatchObject({ ringRole: 'domain' })
    expect(byId.get(order)).toMatchObject({ ringRole: 'domain', kind: 'entity' })
    expect(OnionFileSchema.safeParse(state().map).success).toBe(true)
  })

  it('removing a ring keeps the dependencies and the actor targets that stay valid', () => {
    const { pricing, place, web } = seed()
    const dep = state().addDependency(place, pricing)!
    state().addEndpoint('actors', { name: 'Customer', targetId: web })
    state().removeRing('domainServices')
    expect(state().map.dependencies.map((d) => d.id)).toEqual([dep])
    expect(state().map.actors[0].targetId).toBe(web)
  })

  it('removing an empty user-added ring changes nothing else', () => {
    seed()
    const role = state().addRing('Events')
    const elements = state().map.elements
    expect(state().removeRing(role)).toEqual({ into: 'Application Services', moved: 0, cleared: 0, pruned: 0 })
    expect(state().map.elements).toEqual(elements)
    expect(roles()).toEqual(['domain', 'domainServices', 'application', 'outer'])
  })

  it('moves a middle ring outward, prunes the dependencies that now point outward and keeps every kind', () => {
    const { pricing, place, order } = seed()
    state().addDependency(place, pricing)
    const keep = state().addDependency(place, order)!
    const result = state().moveRing('domainServices', 'out')
    expect(result).toEqual({ pruned: 1 })
    expect(roles()).toEqual(['domain', 'application', 'domainServices', 'outer'])
    expect(state().map.dependencies.map((d) => d.id)).toEqual([keep])
    expect(state().map.elements.find((e) => e.id === pricing)?.kind).toBe('domainService')
    expect(OnionFileSchema.safeParse(state().map).success).toBe(true)
  })

  it('moves a middle ring inward', () => {
    seed()
    expect(state().moveRing('application', 'in')).toEqual({ pruned: 0 })
    expect(roles()).toEqual(['domain', 'application', 'domainServices', 'outer'])
  })

  it('keeps the innermost and the outermost ring in place', () => {
    seed()
    const before = state().map
    expect(state().moveRing('domain', 'out')).toBeUndefined()
    expect(state().moveRing('outer', 'in')).toBeUndefined()
    expect(state().moveRing('domainServices', 'in')).toBeUndefined()
    expect(state().moveRing('application', 'out')).toBeUndefined()
    expect(state().map).toBe(before)
  })

  it('moves a user-added ring between the middle rings', () => {
    seed()
    const role = state().addRing('Events')
    state().moveRing(role, 'in')
    expect(roles()).toEqual(['domain', 'domainServices', role, 'application', 'outer'])
  })

  it('places an element in a user-added ring, where a kind is refused', () => {
    seed()
    const role = state().addRing('Events')
    const id = state().addElement({ name: 'OrderPlaced', ringRole: role })
    state().updateElement(id, { kind: 'domainEvent' })
    expect(state().map.elements.find((e) => e.id === id)?.kind).toBeUndefined()
  })
})
