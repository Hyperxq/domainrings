import { describe, expect, it } from 'vitest'
import { linkedTwoHexMap } from '../test/fixtures'
import { dependencyChain } from './chain'

const DOMAIN = ['d-feedback', 'd-rating', 'd-email']
const both = new Set(['h1', 'h2'])
const refs = (chain: ReturnType<typeof dependencyChain>, hexId: string) => [...(chain?.elements.get(hexId) ?? [])].sort()

describe('dependencyChain', () => {
  const map = linkedTwoHexMap()

  it('follows an adapter inward to its port, use case and domain, and stops there', () => {
    const chain = dependencyChain(map, 'h1', 'a-http', new Set(['h1']))
    expect(refs(chain, 'h1')).toEqual(['a-http', 'p-submit', 'uc-submit', ...DOMAIN].sort())
    expect(chain?.links.size).toBe(0)
  })

  it('starts from an actor or external system and passes through its adapter', () => {
    expect(refs(dependencyChain(map, 'h1', 'act-frontend', new Set(['h1'])), 'h1')).toEqual(['a-http', 'act-frontend', 'p-submit', 'uc-submit', ...DOMAIN].sort())
    expect(refs(dependencyChain(map, 'h1', 'ext-mailgun', new Set(['h1'])), 'h1')).toEqual(['a-email', 'ext-mailgun', 'p-notify', 'uc-submit', ...DOMAIN].sort())
  })

  it('never goes outward: a port leaves its adapter and endpoints out, a use case its ports', () => {
    expect(refs(dependencyChain(map, 'h1', 'p-submit', new Set(['h1'])), 'h1')).toEqual(['p-submit', 'uc-submit', ...DOMAIN].sort())
    expect(refs(dependencyChain(map, 'h1', 'uc-submit', new Set(['h1'])), 'h1')).toEqual(['uc-submit', ...DOMAIN].sort())
  })

  it('follows a domain item up through the aggregate that holds it', () => {
    expect(refs(dependencyChain(map, 'h1', 'd-rating', new Set(['h1'])), 'h1')).toEqual(['d-feedback', 'd-rating'])
  })

  it('crosses a link to the port at its other end, and stops at that port while its hexagon is compact', () => {
    const chain = dependencyChain(map, 'h1', 'a-knex', new Set(['h1']))
    expect(refs(chain, 'h1')).toEqual(['a-knex', 'p-repo', 'uc-submit', ...DOMAIN].sort())
    expect(refs(chain, 'h2')).toEqual(['p-submit'])
    expect([...chain!.links]).toEqual(['link-1'])
  })

  it('continues inward to the domain of an expanded hexagon across the link, never back out to its adapter', () => {
    const chain = dependencyChain(map, 'h1', 'p-repo', both)
    expect(refs(chain, 'h2')).toEqual(['p-submit', 'uc-submit', ...DOMAIN].sort())
    expect(refs(chain, 'h2')).not.toContain('a-http')
  })

  it('ends at a domain: no other outbound port or link of either core joins the chain', () => {
    const chain = dependencyChain(map, 'h1', 'p-repo', both)
    for (const hexId of ['h1', 'h2']) expect(refs(chain, hexId)).not.toContain('p-notify')
    expect(refs(chain, 'h1')).not.toContain('p-submit')
    expect(refs(chain, 'h2')).not.toContain('p-repo')
    expect(chain?.links.size).toBe(1)
  })

  it('does not follow a link back from the driving port at its far end', () => {
    const chain = dependencyChain(map, 'h2', 'p-submit', both)
    expect(chain?.elements.has('h1')).toBe(false)
    expect(chain?.links.size).toBe(0)
  })

  it('has no chain for something that is not an element of the hexagon', () => {
    expect(dependencyChain(map, 'h1', 'composition', both)).toBeUndefined()
    expect(dependencyChain(map, 'h1', 'layer:domain', both)).toBeUndefined()
  })

  // The schema rejects these on every load path, so they are only reachable by a map built around it; the walk must still end.
  it('ends on a link cycle', () => {
    const cyclic = { ...map, links: [...map.links, { id: 'back', from: { hexagonId: 'h2', portId: 'p-submit' }, to: { hexagonId: 'h1', portId: 'p-repo' } }] }
    const chain = dependencyChain(cyclic, 'h1', 'p-repo', both)
    expect(refs(chain, 'h2')).toContain('p-submit')
    expect([...chain!.links].sort()).toEqual(['back', 'link-1'])
  })

  it('ends on a parent cycle', () => {
    const [h1, ...rest] = map.hexagons
    const domain = h1.domain.map((i) => (i.id === 'd-feedback' ? { ...i, parentId: 'd-rating' } : i))
    const chain = dependencyChain({ ...map, hexagons: [{ ...h1, domain }, ...rest] }, 'h1', 'd-rating', both)
    expect(refs(chain, 'h1')).toEqual(['d-feedback', 'd-rating'])
  })

  describe('dependents', () => {
    const dependents = (hexId: string, ref: string, expanded: ReadonlySet<string>, m = map) => dependencyChain(m, hexId, ref, expanded, 'dependents')
    const OUTER = ['a-email', 'a-http', 'a-knex', 'a-legacy', 'act-frontend', 'ext-legacy', 'ext-mailgun', 'ext-pg', 'p-notify', 'p-repo', 'p-submit', 'p-users']

    it('follows a use case outward to its ports, their adapters and their endpoints, and never back in to the domain', () => {
      expect(refs(dependents('h1', 'uc-submit', new Set(['h1'])), 'h1')).toEqual(['uc-submit', ...OUTER].sort())
    })

    it('follows a port outward to its adapters and endpoints, leaving its use case out', () => {
      expect(refs(dependents('h1', 'p-submit', new Set(['h1'])), 'h1')).toEqual(['a-http', 'act-frontend', 'p-submit'])
    })

    it('reaches every use case from a domain item, since a use case asks the whole domain, and carries on outward', () => {
      expect(refs(dependents('h1', 'd-rating', new Set(['h1'])), 'h1')).toEqual(['d-rating', 'uc-submit', ...OUTER].sort())
    })

    it('includes what an aggregate holds but not the aggregate that holds an item', () => {
      expect(refs(dependents('h1', 'd-feedback', new Set(['h1'])), 'h1')).toEqual(['d-email', 'd-feedback', 'd-rating', 'uc-submit', ...OUTER].sort())
    })

    it('crosses a link backwards from a driving port into the caller, carrying on outward from the port it reaches', () => {
      const chain = dependents('h2', 'p-submit', both)
      expect(refs(chain, 'h2')).toEqual(['a-http', 'act-frontend', 'p-submit'])
      expect(refs(chain, 'h1')).toEqual(['a-knex', 'ext-pg', 'p-repo'])
      expect([...chain!.links]).toEqual(['link-1'])
    })

    it('reaches a caller through the domain of the called hexagon', () => {
      const chain = dependents('h2', 'd-rating', both)
      expect(refs(chain, 'h1')).toEqual(['a-knex', 'ext-pg', 'p-repo'])
      expect([...chain!.links]).toEqual(['link-1'])
    })

    it('stops at the port of a compact caller', () => {
      const chain = dependents('h2', 'p-submit', new Set(['h2']))
      expect(refs(chain, 'h1')).toEqual(['p-repo'])
      expect([...chain!.links]).toEqual(['link-1'])
    })

    it('does not follow a link forwards from the driven port at its near end', () => {
      const chain = dependents('h1', 'p-repo', both)
      expect(chain?.elements.has('h2')).toBe(false)
      expect(chain?.links.size).toBe(0)
    })

    it('has no chain for something that is not an element of the hexagon', () => {
      expect(dependents('h1', 'layer:domain', both)).toBeUndefined()
    })

    it('ends on a link cycle', () => {
      const cyclic = { ...map, links: [...map.links, { id: 'back', from: { hexagonId: 'h2', portId: 'p-submit' }, to: { hexagonId: 'h1', portId: 'p-repo' } }] }
      const chain = dependents('h2', 'p-submit', both, cyclic)
      expect([...chain!.links].sort()).toEqual(['back', 'link-1'])
      expect(refs(chain, 'h1')).toEqual(['a-knex', 'ext-pg', 'p-repo'])
    })

    it('ends on a parent cycle', () => {
      const [h1, ...rest] = map.hexagons
      const domain = h1.domain.map((i) => (i.id === 'd-feedback' ? { ...i, parentId: 'd-rating' } : i))
      const chain = dependents('h1', 'd-rating', both, { ...map, hexagons: [{ ...h1, domain }, ...rest] })
      expect(refs(chain, 'h1')).toContain('d-feedback')
    })
  })
})
