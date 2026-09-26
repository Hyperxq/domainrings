import { describe, expect, it } from 'vitest'
import { newOnionMap } from './hexa'
import * as ringedDocument from './ringedDocument'
import { OnionFileSchema, type OnionElement, type OnionEndpoint, type OnionFile } from './schema'

// Onion's existing CRUD (model/onionStore.test.ts) re-expressed directly against the shared functions
// (ADR-01) — proves the extraction is behaviour-preserving: same inputs, same outputs, independent of the
// zustand store wrapper.
const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 6)}`

describe('ringedDocument.addElement', () => {
  it('adds a named element to the given ring', () => {
    const doc = newOnionMap('Fresh')
    const { doc: next, id } = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    expect(next.elements).toHaveLength(1)
    expect(next.elements[0]).toMatchObject({ id, name: 'Order', ringRole: 'domain' })
  })
})

describe('ringedDocument.updateElement', () => {
  it('renames an element in place', () => {
    const doc = newOnionMap('Fresh')
    const added = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    const next = ringedDocument.updateElement<OnionFile, OnionElement>(added.doc, added.id, { name: 'Purchase Order' }, OnionFileSchema)
    expect(next?.elements[0].name).toBe('Purchase Order')
  })

  it('rejects (returns undefined) a ring change that would break an existing dependency', () => {
    let doc = newOnionMap('Fresh')
    const domain = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    doc = domain.doc
    const app = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'OrderService', ringRole: 'application' }, () => makeId('element'))
    doc = app.doc
    const dep = ringedDocument.addDependency(doc, app.id, domain.id, () => makeId('dependency'), OnionFileSchema)!
    doc = dep.doc
    const next = ringedDocument.updateElement<OnionFile, OnionElement>(doc, domain.id, { ringRole: 'outer' }, OnionFileSchema)
    expect(next).toBeUndefined()
  })
})

describe('ringedDocument.removeElement', () => {
  it('removes the element, prunes dependencies referencing it, and clears endpoint targets pointing to it', () => {
    let doc = newOnionMap('Fresh')
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const app = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Service', ringRole: 'application' }, () => makeId('element'))
    doc = app.doc
    doc = ringedDocument.addDependency(doc, outer.id, app.id, () => makeId('dependency'), OnionFileSchema)!.doc
    doc = ringedDocument.addEndpoint<OnionFile, OnionEndpoint>(doc, 'actors', { name: 'Customer', targetId: outer.id }, () => makeId('actor'), OnionFileSchema)!.doc

    const next = ringedDocument.removeElement(doc, outer.id)

    expect(next.elements.map((e) => e.id)).toEqual([app.id])
    expect(next.dependencies).toEqual([])
    expect(next.actors[0].targetId).toBeUndefined()
  })
})

describe('ringedDocument.addDependency / removeDependency', () => {
  it('succeeds on an inward pair', () => {
    let doc = newOnionMap('Fresh')
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const domain = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    doc = domain.doc
    const result = ringedDocument.addDependency(doc, outer.id, domain.id, () => makeId('dependency'), OnionFileSchema)
    expect(result).toBeDefined()
    expect(result!.doc.dependencies).toEqual([{ id: result!.id, fromId: outer.id, toId: domain.id }])
  })

  it('no-ops (undefined) on an outward pair', () => {
    let doc = newOnionMap('Fresh')
    const domain = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    doc = domain.doc
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const before = doc
    const result = ringedDocument.addDependency(doc, domain.id, outer.id, () => makeId('dependency'), OnionFileSchema)
    expect(result).toBeUndefined()
    expect(doc).toBe(before)
  })

  it('removeDependency removes an existing dependency', () => {
    let doc = newOnionMap('Fresh')
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const domain = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Order', ringRole: 'domain' }, () => makeId('element'))
    doc = domain.doc
    const dep = ringedDocument.addDependency(doc, outer.id, domain.id, () => makeId('dependency'), OnionFileSchema)!
    const next = ringedDocument.removeDependency(dep.doc, dep.id)
    expect(next.dependencies).toEqual([])
  })
})

describe('ringedDocument.addEndpoint / removeEndpoint', () => {
  it('succeeds when the target is an outer-ring element', () => {
    let doc = newOnionMap('Fresh')
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const result = ringedDocument.addEndpoint<OnionFile, OnionEndpoint>(doc, 'actors', { name: 'Customer', targetId: outer.id }, () => makeId('actor'), OnionFileSchema)
    expect(result).toBeDefined()
    expect(result!.doc.actors).toEqual([{ id: result!.id, name: 'Customer', targetId: outer.id }])
  })

  it('no-ops (undefined) when the target is not an outer-ring element', () => {
    let doc = newOnionMap('Fresh')
    const app = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'OrderService', ringRole: 'application' }, () => makeId('element'))
    doc = app.doc
    const before = doc
    const result = ringedDocument.addEndpoint<OnionFile, OnionEndpoint>(doc, 'externals', { name: 'Payments API', targetId: app.id }, () => makeId('external'), OnionFileSchema)
    expect(result).toBeUndefined()
    expect(doc).toBe(before)
  })

  it('removeEndpoint removes an existing actor or external', () => {
    let doc = newOnionMap('Fresh')
    const outer = ringedDocument.addElement<OnionFile, OnionElement>(doc, { name: 'Controller', ringRole: 'outer' }, () => makeId('element'))
    doc = outer.doc
    const added = ringedDocument.addEndpoint<OnionFile, OnionEndpoint>(doc, 'actors', { name: 'Customer', targetId: outer.id }, () => makeId('actor'), OnionFileSchema)!
    const next = ringedDocument.removeEndpoint(added.doc, 'actors', added.id)
    expect(next.actors).toEqual([])
  })
})
