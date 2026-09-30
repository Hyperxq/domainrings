import { describe, expect, it } from 'vitest'
import { kindsFor, ONION_KINDS } from './ringedKinds'
import { HexaFileV3Schema, HexaFileV4Schema } from './fileFormat'
import { APP, CleanFileSchema, DiagramSchema, linkEndProblem, MapSchema, OnionFileSchema, VERSION } from './schema'
import { EXAMPLE_DIAGRAM } from './example'
import { newCleanMap, newOnionMap, toMap } from './hexa'

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
  version: VERSION,
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

describe('newCleanMap', () => {
  it('starts with exactly 4 rings, innermost-first, in the fixed role order, no sectors (REQ-02)', () => {
    const clean = newCleanMap('Fresh architecture')
    expect(CleanFileSchema.safeParse(clean).success).toBe(true)
    expect(clean.rings).toHaveLength(4)
    expect(clean.rings.map((r) => r.role)).toEqual(['domain', 'application', 'adapters', 'outer'])
    expect(clean.sectors).toEqual([])
    expect(clean.elements).toEqual([])
    expect(clean.dependencies).toEqual([])
    expect(clean.actors).toEqual([])
    expect(clean.externals).toEqual([])
  })

  it('round-trips through CleanFileSchema at version, kind and VERSION unchanged', () => {
    const clean = newCleanMap('Fresh architecture')
    expect(CleanFileSchema.parse(clean)).toEqual(clean)
    expect(clean.version).toBe(VERSION)
    expect(clean.kind).toBe('clean')
  })
})

describe('CleanFileSchema integrity (REQ-06, REQ-07)', () => {
  const withSectorsAndElements = () => {
    const base = newCleanMap('Fresh architecture')
    const sectors = [
      { id: 's-domain', name: 'Orders', ringRole: 'domain' as const },
      { id: 's-app', name: 'Order flows', ringRole: 'application' as const },
      { id: 's-outer-1', name: 'Web', ringRole: 'outer' as const },
      { id: 's-outer-2', name: 'CLI', ringRole: 'outer' as const },
    ]
    const elements = [
      { id: 'e-domain', name: 'Order', sectorId: 's-domain' },
      { id: 'e-app', name: 'PlaceOrder', sectorId: 's-app' },
      { id: 'e-outer-1', name: 'WebController', sectorId: 's-outer-1' },
      { id: 'e-outer-2', name: 'CliController', sectorId: 's-outer-2' },
    ]
    return { ...base, sectors, elements }
  }

  it('accepts a dependency pointing inward (outer → application, via each element\'s own sector)', () => {
    const doc = { ...withSectorsAndElements(), dependencies: [{ id: 'd1', fromId: 'e-outer-1', toId: 'e-app' }] }
    expect(CleanFileSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects a dependency pointing outward (domain → application)', () => {
    const doc = { ...withSectorsAndElements(), dependencies: [{ id: 'd1', fromId: 'e-domain', toId: 'e-app' }] }
    const result = CleanFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'dependencies.0.toId')).toBe(true)
  })

  it('accepts an endpoint targeting an outer-ring element (resolved through its sector)', () => {
    const doc = { ...withSectorsAndElements(), actors: [{ id: 'a1', name: 'Customer', targetId: 'e-outer-1' }] }
    expect(CleanFileSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects an endpoint targeting a non-outer-ring element', () => {
    const doc = { ...withSectorsAndElements(), externals: [{ id: 'x1', name: 'Payments API', targetId: 'e-app' }] }
    const result = CleanFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'externals.0.targetId')).toBe(true)
  })

  it('rejects an element naming a sector that does not exist', () => {
    const doc = { ...newCleanMap('Fresh'), sectors: [], elements: [{ id: 'e1', name: 'Order', sectorId: 'missing' }] }
    const result = CleanFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'elements.0.sectorId')).toBe(true)
  })
})

describe('OnionFileSchema integrity (REQ-04, REQ-05)', () => {
  const withElements = () => ({
    ...newOnionMap('Fresh architecture'),
    elements: [
      { id: 'e-domain', name: 'Domain', ringRole: 'domain' as const },
      { id: 'e-app', name: 'Application', ringRole: 'application' as const },
      { id: 'e-outer-1', name: 'Outer 1', ringRole: 'outer' as const },
      { id: 'e-outer-2', name: 'Outer 2', ringRole: 'outer' as const },
    ],
  })

  it('accepts a dependency pointing inward (outer → application)', () => {
    const doc = { ...withElements(), dependencies: [{ id: 'd1', fromId: 'e-app', toId: 'e-domain' }] }
    expect(OnionFileSchema.safeParse(doc).success).toBe(true)
  })

  it('accepts a dependency within the same ring', () => {
    const doc = { ...withElements(), dependencies: [{ id: 'd1', fromId: 'e-outer-1', toId: 'e-outer-2' }] }
    expect(OnionFileSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects a dependency pointing outward (domain → application)', () => {
    const doc = { ...withElements(), dependencies: [{ id: 'd1', fromId: 'e-domain', toId: 'e-app' }] }
    const result = OnionFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'dependencies.0.toId')).toBe(true)
  })

  it('accepts an endpoint targeting an outer-ring element', () => {
    const doc = { ...withElements(), actors: [{ id: 'a1', name: 'Customer', targetId: 'e-outer-1' }] }
    expect(OnionFileSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects an endpoint targeting a non-outer-ring element', () => {
    const doc = { ...withElements(), externals: [{ id: 'x1', name: 'Payments API', targetId: 'e-app' }] }
    const result = OnionFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'externals.0.targetId')).toBe(true)
  })

  it('rejects an endpoint whose targetId does not resolve to any element', () => {
    const doc = { ...withElements(), actors: [{ id: 'a1', name: 'Customer', targetId: 'unknown-id' }] }
    const result = OnionFileSchema.safeParse(doc)
    expect(result.success).toBe(false)
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

describe('ringed element kinds', () => {
  const onion = (elements: unknown[]) => ({ ...newOnionMap('Kinds'), elements })
  const clean = (elements: unknown[]) => ({
    ...newCleanMap('Kinds'),
    sectors: [
      { id: 's-domain', name: 'Orders', ringRole: 'domain' as const },
      { id: 's-adapters', name: 'Web', ringRole: 'adapters' as const },
    ],
    elements,
  })
  const issueMessage = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, path: string) =>
    result.error?.issues.find((i) => i.path.join('.') === path)?.message

  it('accepts a kind from the element\'s own Onion ring, and no kind at all', () => {
    const doc = onion([
      { id: 'a', name: 'Order', ringRole: 'domain', kind: 'domainEvent' },
      { id: 'b', name: 'PricingService', ringRole: 'domainServices', kind: 'repositoryInterface' },
      { id: 'c', name: 'PlaceOrder', ringRole: 'application', kind: 'applicationService' },
      { id: 'd', name: 'Web', ringRole: 'outer', kind: 'repositoryImplementation' },
      { id: 'e', name: 'Untyped', ringRole: 'outer' },
    ])
    expect(OnionFileSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects an Onion kind that belongs to another ring, naming the element, the kind and the allowed kinds', () => {
    const result = OnionFileSchema.safeParse(onion([{ id: 'a', name: 'Order', ringRole: 'application', kind: 'entity' }]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'elements.0.kind')).toBe('Element "Order" has kind "entity", which its ring does not allow (allowed: application service).')
  })

  it('rejects a kind that exists in no ring', () => {
    expect(OnionFileSchema.safeParse(onion([{ id: 'a', name: 'Order', ringRole: 'domain', kind: 'bogus' }])).success).toBe(false)
  })

  it('accepts a Clean kind resolved through the element\'s sector, and rejects one from another ring', () => {
    expect(CleanFileSchema.safeParse(clean([{ id: 'a', name: 'Order', sectorId: 's-domain', kind: 'aggregate' }])).success).toBe(true)
    const result = CleanFileSchema.safeParse(clean([{ id: 'a', name: 'OrderController', sectorId: 's-adapters', kind: 'interactor' }]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'elements.0.kind')).toBe('Element "OrderController" has kind "interactor", which its ring does not allow (allowed: controller, presenter, gateway).')
  })

  it('does not offer domain event in Clean\'s entities ring', () => {
    expect(CleanFileSchema.safeParse(clean([{ id: 'a', name: 'Order', sectorId: 's-domain', kind: 'domainEvent' }])).success).toBe(false)
  })
})

describe('frozen v3 Onion arm', () => {
  it('still strips an element kind, exactly as before kinds existed', () => {
    const { version: _v, ...onion } = newOnionMap('Old')
    const file = { ...onion, version: 3, app: APP, elements: [{ id: 'e1', name: 'Order', ringRole: 'domain', kind: 'entity' }] }
    const result = HexaFileV3Schema.safeParse(file)
    expect(result.success).toBe(true)
    if (result.success && result.data.kind === 'onion') expect(result.data.elements[0]).toEqual({ id: 'e1', name: 'Order', ringRole: 'domain' })
  })
})

describe('editable Onion rings', () => {
  const ring = (role: string, name = role) => ({ role, name })
  const withRings = (rings: unknown[], elements: unknown[] = []) => ({ ...newOnionMap('Rings'), rings, elements })
  const outerTwo = [ring('domain'), ring('outer')]
  const issueMessage = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, path: string) =>
    result.error?.issues.find((i) => i.path.join('.') === path)?.message

  it.each([
    ['two rings', outerTwo],
    ['three rings with a user-added one', [ring('domain'), ring('ring-a1b2c3d4', 'Events'), ring('outer')]],
    ['five rings', [ring('domain'), ring('domainServices'), ring('ring-a1b2c3d4'), ring('application'), ring('outer')]],
  ])('accepts %s', (_name, rings) => {
    expect(OnionFileSchema.safeParse(withRings(rings)).success).toBe(true)
  })

  it('rejects a single ring', () => {
    expect(OnionFileSchema.safeParse(withRings([ring('domain')])).success).toBe(false)
  })

  it('rejects a duplicate ring id', () => {
    const result = OnionFileSchema.safeParse(withRings([ring('domain'), ring('domain'), ring('outer')]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'rings.1.role')).toBe('Duplicate ring "domain"')
  })

  it('rejects a ring id that cannot be used as a class or attribute value', () => {
    expect(OnionFileSchema.safeParse(withRings([ring('domain'), ring('has space'), ring('outer')])).success).toBe(false)
  })

  it('rejects an element that names a ring the file does not have', () => {
    const result = OnionFileSchema.safeParse(withRings(outerTwo, [{ id: 'a', name: 'Order', ringRole: 'application' }]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'elements.0.ringRole')).toBe('Unknown ring "application"')
  })

  it('offers no kind in a user-added ring', () => {
    const rings = [ring('domain'), ring('ring-a1b2c3d4'), ring('outer')]
    expect(OnionFileSchema.safeParse(withRings(rings, [{ id: 'a', name: 'Order', ringRole: 'ring-a1b2c3d4' }])).success).toBe(true)
    expect(OnionFileSchema.safeParse(withRings(rings, [{ id: 'a', name: 'Order', ringRole: 'ring-a1b2c3d4', kind: 'entity' }])).success).toBe(false)
  })

  it('keeps a canonical role bound to its kinds wherever the ring sits', () => {
    const rings = [ring('domain'), ring('application'), ring('domainServices'), ring('outer')]
    expect(OnionFileSchema.safeParse(withRings(rings, [{ id: 'a', name: 'Pricing', ringRole: 'domainServices', kind: 'domainService' }])).success).toBe(true)
  })

  it('still enforces the inward rule against the ring order the file declares', () => {
    const rings = [ring('domain'), ring('application'), ring('domainServices'), ring('outer')]
    const elements = [
      { id: 'svc', name: 'Svc', ringRole: 'domainServices' },
      { id: 'app', name: 'App', ringRole: 'application' },
    ]
    const dependencies = [{ id: 'd', fromId: 'app', toId: 'svc' }]
    expect(OnionFileSchema.safeParse({ ...withRings(rings, elements), dependencies }).success).toBe(false)
  })
})

describe('frozen v4 arm', () => {
  it('keeps the fixed 4-ring tuple of the version-4 format', () => {
    const { version: _v, ...onion } = newOnionMap('Old')
    const file = { ...onion, version: 4, app: APP }
    expect(HexaFileV4Schema.safeParse(file).success).toBe(true)
    expect(HexaFileV4Schema.safeParse({ ...file, rings: file.rings.slice(0, 3) }).success).toBe(false)
  })
})

describe('Onion edge rings', () => {
  const ring = (role: string) => ({ role, name: role })
  const withRings = (rings: unknown[]) => ({ ...newOnionMap('Rings'), rings })
  const issueMessage = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, path: string) =>
    result.error?.issues.find((i) => i.path.join('.') === path)?.message

  it('requires the first ring to be domain', () => {
    const result = OnionFileSchema.safeParse(withRings([ring('application'), ring('outer')]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'rings.0.role')).toBe('The innermost ring must be "domain"')
  })

  it('requires the last ring to be outer', () => {
    const result = OnionFileSchema.safeParse(withRings([ring('domain'), ring('application')]))
    expect(result.success).toBe(false)
    expect(issueMessage(result, 'rings.1.role')).toBe('The outermost ring must be "outer"')
  })

  it.each(['constructor', 'hasOwnProperty', 'ring has space', 'application2'])('rejects the ring id %s: only a canonical role or "ring-…" is one', (role) => {
    expect(OnionFileSchema.safeParse(withRings([ring('domain'), ring(role), ring('outer')])).success).toBe(false)
  })
})

describe('kindsFor', () => {
  it('answers a role the table does not name, or one an object inherits, with no kinds', () => {
    for (const role of ['ring-a1b2c3d4', 'constructor', 'hasOwnProperty', '']) expect(kindsFor(ONION_KINDS, role)).toEqual([])
    expect(kindsFor(ONION_KINDS, 'outer')).toContain('ui')
  })
})
