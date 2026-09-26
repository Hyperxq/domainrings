import { describe, expect, it } from 'vitest'
import { DiagramSchema, linkEndProblem, MapSchema, OnionFileSchema } from './schema'
import { EXAMPLE_DIAGRAM } from './example'
import { newOnionMap, toMap } from './hexa'

const issuePaths = (input: unknown) => {
  const result = DiagramSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
}

describe('DiagramSchema', () => {
  it('accepts the seeded example unchanged', () => {
    expect(DiagramSchema.parse(EXAMPLE_DIAGRAM)).toEqual(EXAMPLE_DIAGRAM)
  })

  it('rejects an unknown architecture kind', () => {
    expect(issuePaths({ ...EXAMPLE_DIAGRAM, kind: 'layered' })).toEqual(['kind'])
  })

  it('rejects a port side outside driving/driven', () => {
    const ports = [{ id: 'p', name: 'x', side: 'sideways' }]
    expect(issuePaths({ ...EXAMPLE_DIAGRAM, ports, adapters: [] })).toEqual(['ports.0.side'])
  })

  it('reports a dangling reference at the referencing field', () => {
    const adapters = [{ id: 'a', name: 'A', portId: 'missing' }]
    expect(issuePaths({ ...EXAMPLE_DIAGRAM, adapters, actors: [], externals: [] })).toEqual([
      'adapters.0.portId',
    ])
  })

  it('reports duplicate ids inside a collection', () => {
    const useCases = [
      { id: 'uc-submit', name: 'A' },
      { id: 'uc-submit', name: 'B' },
    ]
    expect(issuePaths({ ...EXAMPLE_DIAGRAM, useCases })).toEqual(['useCases.1.id'])
  })

  it('accepts an empty diagram without composition', () => {
    const empty = { ...EXAMPLE_DIAGRAM, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [], composition: undefined }
    expect(DiagramSchema.safeParse(empty).success).toBe(true)
  })

  describe('domain item parents', () => {
    const withDomain = (domain: unknown[]) => ({ ...EXAMPLE_DIAGRAM, domain })
    const entity = { id: 'e', name: 'Order', type: 'entity' }
    const aggregate = { id: 'g', name: 'Cart', type: 'aggregate' }

    it('accepts a value object under an entity and an entity under an aggregate', () => {
      const domain = [aggregate, { ...entity, parentId: 'g' }, { id: 'v', name: 'Money', type: 'valueObject', parentId: 'e' }]
      expect(issuePaths(withDomain(domain))).toEqual([])
    })

    it('rejects a parent that is not in this diagram', () => {
      expect(issuePaths(withDomain([{ ...entity, parentId: 'elsewhere' }]))).toEqual(['domain.0.parentId'])
    })

    it('rejects a parent that can hold no children', () => {
      const domain = [{ id: 'v', name: 'Money', type: 'valueObject' }, { ...entity, parentId: 'v' }]
      expect(issuePaths(withDomain(domain))).toEqual(['domain.1.parentId'])
    })

    it('rejects cycles, including an item parenting itself', () => {
      expect(issuePaths(withDomain([{ ...entity, parentId: 'e' }]))).toEqual(['domain.0.parentId'])
      const domain = [{ ...aggregate, parentId: 'e' }, { ...entity, parentId: 'g' }]
      expect(issuePaths(withDomain(domain))).toEqual(['domain.0.parentId', 'domain.1.parentId'])
    })
  })

  describe('layer overrides', () => {
    it('accepts a title and subtitle per known layer, and an empty override set', () => {
      expect(issuePaths({ ...EXAMPLE_DIAGRAM, layers: { application: { title: 'Core', subtitle: 'use cases' }, domain: {} } })).toEqual([])
      expect(issuePaths({ ...EXAMPLE_DIAGRAM, layers: {} })).toEqual([])
    })

    it('rejects an unknown layer and a non-text title', () => {
      expect(issuePaths({ ...EXAMPLE_DIAGRAM, layers: { basement: { title: 'x' } } })).toEqual(['layers'])
      expect(issuePaths({ ...EXAMPLE_DIAGRAM, layers: { domain: { title: 7 } } })).toEqual(['layers.domain.title'])
    })
  })

  describe('port walls', () => {
    const withPorts = (ports: unknown[]) => ({ ...EXAMPLE_DIAGRAM, ports, adapters: [], actors: [], externals: [] })

    it('accepts any wall of the port side half, and no wall at all', () => {
      const ports = [
        { id: 'a', name: 'a', side: 'driving', wall: 'nw' },
        { id: 'b', name: 'b', side: 'driving', wall: 'sw' },
        { id: 'c', name: 'c', side: 'driven', wall: 'ne' },
        { id: 'd', name: 'd', side: 'driven' },
      ]
      expect(issuePaths(withPorts(ports))).toEqual([])
    })

    it('rejects a wall from the other half, and an unknown wall', () => {
      expect(issuePaths(withPorts([{ id: 'a', name: 'a', side: 'driving', wall: 'ne' }]))).toEqual(['ports.0.wall'])
      expect(issuePaths(withPorts([{ id: 'a', name: 'a', side: 'driven', wall: 'north' }]))).toEqual(['ports.0.wall'])
    })
  })
})

const TWO_HEXAGON_MAP = {
  version: 3 as const,
  kind: 'hexagonal' as const,
  title: 'Two hexagons',
  contexts: [{ id: 'c1' }],
  hexagons: [
    { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [{ id: 'p-out', name: 'out', side: 'driven' as const }], adapters: [], actors: [], externals: [] },
    { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'B', domain: [], useCases: [], ports: [{ id: 'p-in', name: 'in', side: 'driving' as const }], adapters: [], actors: [], externals: [] },
  ],
  links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }],
}

describe('MapSchema', () => {
  it('accepts a migrated single-hexagon map', () => {
    expect(MapSchema.safeParse(toMap(EXAMPLE_DIAGRAM)).success).toBe(true)
  })

  it('accepts a hand-built two-hexagon map with one valid link', () => {
    const result = MapSchema.safeParse(TWO_HEXAGON_MAP)
    expect(result.success).toBe(true)
  })
})

describe('linkEndProblem', () => {
  const map = MapSchema.parse(TWO_HEXAGON_MAP)

  it('finds no problem with a valid driven-to-driving pair', () => {
    expect(linkEndProblem(map, { hexagonId: 'h1', portId: 'p-out' }, 'from')).toBeUndefined()
    expect(linkEndProblem(map, { hexagonId: 'h2', portId: 'p-in' }, 'to')).toBeUndefined()
  })

  it('reports an unknown hexagon', () => {
    expect(linkEndProblem(map, { hexagonId: 'nope', portId: 'p-out' }, 'from')).toMatch(/Unknown hexagon/)
  })

  it('reports an unknown port', () => {
    expect(linkEndProblem(map, { hexagonId: 'h1', portId: 'nope' }, 'from')).toMatch(/Unknown port/)
  })

  it('reports the wrong side for the role', () => {
    expect(linkEndProblem(map, { hexagonId: 'h2', portId: 'p-in' }, 'from')).toMatch(/driven port/)
    expect(linkEndProblem(map, { hexagonId: 'h1', portId: 'p-out' }, 'to')).toMatch(/driving port/)
  })
})

describe('newOnionMap', () => {
  it('starts with exactly 4 rings, innermost-first, in the fixed role order (REQ-02)', () => {
    const onion = newOnionMap('Fresh architecture')
    expect(OnionFileSchema.safeParse(onion).success).toBe(true)
    expect(onion.rings).toHaveLength(4)
    expect(onion.rings.map((r) => r.role)).toEqual(['domain', 'domainServices', 'application', 'outer'])
    expect(onion.elements).toEqual([])
    expect(onion.dependencies).toEqual([])
    expect(onion.actors).toEqual([])
    expect(onion.externals).toEqual([])
  })
})

describe('use case placement', () => {
  const withPlacement = (placement: unknown) => ({ ...EXAMPLE_DIAGRAM, useCases: EXAMPLE_DIAGRAM.useCases.map((u, i) => (i === 0 ? { ...u, placement } : u)) })

  it('is optional: a use case without one stays in the stack under the title', () => {
    const parsed = DiagramSchema.parse(EXAMPLE_DIAGRAM)
    expect(parsed.useCases.every((u) => u.placement === undefined)).toBe(true)
  })

  it.each(['top', 'nw', 'w', 'sw', 'ne', 'e', 'se'])('accepts %s', (placement) => {
    expect(DiagramSchema.parse(withPlacement(placement)).useCases[0].placement).toBe(placement)
  })

  it('rejects anything else, at the placement path', () => {
    const result = DiagramSchema.safeParse(withPlacement('north'))
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].path).toEqual(['useCases', 0, 'placement'])
  })
})
