import { describe, expect, it } from 'vitest'
import { newOnionMap } from '../model/hexa'
import type { OnionFile } from '../model/schema'
import { layoutOnion } from './onion'
import { onionInsertionItem, onionInsertionPoints } from './onionInsertion'

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

describe('onionInsertionItem', () => {
  it('builds an element patch carrying the ring it was added from', () => {
    const item = onionInsertionItem({ kind: 'element', ringRole: 'application' })
    expect(item).toEqual({ kind: 'element', patch: { name: 'NewElement', ringRole: 'application' } })
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
