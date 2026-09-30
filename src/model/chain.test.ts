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
})
