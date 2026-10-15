import { describe, expect, it } from 'vitest'
import { EXAMPLES } from './example'
import { flowChain, flowOf, flowsOf, type Flow } from './flow'
import { parseHexa, toHexa } from './hexa'
import { VERSION, type Diagram, type HexaMap } from './schema'

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.map as HexaMap
const chain = (flow: Flow) => flow.steps.map((s) => s.name).join(' > ')

type Fields = Partial<Omit<Diagram, 'version' | 'kind'>>
const hexagon = (id: string, fields: Fields) => ({ id, contextId: 'c1', cell: { q: Number(id.slice(1)), r: 0 }, title: id, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [], ...fields })
const mapOf = (hexagons: ReturnType<typeof hexagon>[], links: HexaMap['links'] = []): HexaMap => ({ version: VERSION, kind: 'hexagonal', title: 't', contexts: [{ id: 'c1' }], hexagons, links })

describe('flowOf on the shipped examples', () => {
  it('reads hexagonal-basic from the actor to every external system, calls in port order', () => {
    const map = example('hexagonal-basic')
    const flow = flowOf(map, map.hexagons[0].id, 'uc-submit')
    expect(chain(flow)).toBe(
      'Frontend > feedback.routes/handler/schema > submitChatFeedback > SubmitChatFeedback > ' +
        'FeedbackRepository > KnexFeedbackRepository > Postgres > ' +
        'SupportNotifier > EmailSupportNotifier > Mailgun > ' +
        'UserDirectory > LegacyUserDirectory · ACL > model-user (legacy)',
    )
    expect(flow.steps.map((s) => s.role)).toEqual(['actor', 'adapter', 'drivingPort', 'useCase', 'drivenPort', 'drivenAdapter', 'external', 'drivenPort', 'drivenAdapter', 'external', 'drivenPort', 'drivenAdapter', 'external'])
    expect(flow.starters).toEqual(['Frontend'])
    expect(flow.destinations).toEqual(['Postgres', 'Mailgun', 'model-user (legacy)'])
    expect(flow.gaps).toEqual([])
  })

  it('follows a driven port across a link in hexagonal-advanced', () => {
    const map = example('hexagonal-advanced')
    const flow = flowOf(map, 'h1', 'uc-place')
    const hop = flow.steps.find((s) => s.role === 'linkedPort' && s.id === 'p-charge-in')!
    expect(hop).toMatchObject({ hexId: 'h2', useCaseName: 'ChargePayment' })
    expect(flow.steps[flow.steps.indexOf(hop) - 1].role).toBe('drivenAdapter')
    expect(flow.destinations).toContain('Payments')
    expect(flow.gaps.filter((g) => g.kind === 'noDestination')).toEqual([])
  })

  it('gives one flow per use case, in the hexagon order', () => {
    const map = example('hexagonal-advanced')
    expect(flowsOf(map, 'h1').map((f) => f.useCaseId)).toEqual(map.hexagons[0].useCases.map((u) => u.id))
  })
})

describe('flowOf on small maps', () => {
  const uc = { id: 'u', name: 'Charge' }
  const driving = { id: 'in1', name: 'in1', side: 'driving' as const, useCaseId: 'u' }

  it('keeps every entry, adapter and actor, in array order', () => {
    const map = mapOf([
      hexagon('h1', {
        useCases: [uc],
        ports: [driving, { id: 'in2', name: 'in2', side: 'driving', useCaseId: 'u' }],
        adapters: [{ id: 'a1', name: 'a1', portId: 'in1' }, { id: 'a2', name: 'a2', portId: 'in1' }, { id: 'a3', name: 'a3', portId: 'in2' }],
        actors: [{ id: 'x1', name: 'x1', adapterId: 'a1' }, { id: 'x2', name: 'x2', adapterId: 'a1' }, { id: 'x3', name: 'x3', adapterId: 'a3' }],
      }),
    ])
    expect(chain(flowOf(map, 'h1', 'u'))).toBe('x1 > x2 > a1 > a2 > in1 > x3 > a3 > in2 > Charge')
    expect(flowOf(map, 'h1', 'u').starters).toEqual(['x1', 'x2', 'x3'])
  })

  it('reports each broken link of the chain as a gap', () => {
    const map = mapOf([
      hexagon('h1', {
        useCases: [uc],
        ports: [driving, { id: 'in2', name: 'in2', side: 'driving', useCaseId: 'u' }, { id: 'out1', name: 'out1', side: 'driven', useCaseId: 'u' }, { id: 'out2', name: 'out2', side: 'driven', useCaseId: 'u' }],
        adapters: [{ id: 'a1', name: 'a1', portId: 'in1' }, { id: 'a2', name: 'a2', portId: 'out2' }],
      }),
    ])
    expect(flowOf(map, 'h1', 'u').gaps).toEqual([
      { kind: 'noActor', hexId: 'h1', id: 'a1' },
      { kind: 'noAdapter', hexId: 'h1', id: 'in2' },
      { kind: 'noAdapter', hexId: 'h1', id: 'out1' },
      { kind: 'noDestination', hexId: 'h1', id: 'a2' },
    ])
  })

  it('ignores ports of another use case or of none', () => {
    const map = mapOf([hexagon('h1', { useCases: [uc], ports: [{ ...driving, useCaseId: undefined }, { id: 'o', name: 'o', side: 'driven', useCaseId: 'other' }] })])
    expect(chain(flowOf(map, 'h1', 'u'))).toBe('Charge')
    expect(flowOf(map, 'h1', 'u').gaps).toEqual([])
  })

  it('carries the verb of a driven port and the author notes by element id', () => {
    const map = mapOf([
      hexagon('h1', {
        useCases: [{ ...uc, description: 'Takes the money', stepNotes: { u: 'decides', out: 'asks the PSP', gone: 'stale' } }],
        ports: [{ id: 'out', name: 'Payments', side: 'driven', useCaseId: 'u', verb: 'charge' }],
        adapters: [{ id: 'a', name: 'a', portId: 'out' }],
        externals: [{ id: 'e', name: 'Stripe', adapterId: 'a' }],
      }),
    ])
    const flow = flowOf(map, 'h1', 'u')
    expect(flow.description).toBe('Takes the money')
    expect(flow.steps).toEqual([
      { role: 'useCase', hexId: 'h1', id: 'u', name: 'Charge', note: 'decides' },
      { role: 'drivenPort', hexId: 'h1', id: 'out', name: 'Payments', note: 'asks the PSP', verb: 'charge' },
      { role: 'drivenAdapter', hexId: 'h1', id: 'a', name: 'a' },
      { role: 'external', hexId: 'h1', id: 'e', name: 'Stripe' },
    ])
  })

  it('shows the caller as the start of a flow entered across a link, not as a gap', () => {
    const map = mapOf(
      [
        hexagon('h1', { title: 'Shop', useCases: [{ id: 'buy', name: 'Buy' }], ports: [{ id: 'pay', name: 'pay', side: 'driven', useCaseId: 'buy' }] }),
        hexagon('h2', { title: 'Payments', useCases: [uc], ports: [driving] }),
      ],
      [{ id: 'l', from: { hexagonId: 'h1', portId: 'pay' }, to: { hexagonId: 'h2', portId: 'in1' } }],
    )
    const flow = flowOf(map, 'h2', 'u')
    expect(flow.steps.map((s) => [s.role, s.hexId, s.name])).toEqual([['linkedPort', 'h1', 'pay'], ['drivingPort', 'h2', 'in1'], ['useCase', 'h2', 'Charge']])
    expect(flow.starters).toEqual(['Shop'])
    expect(flow.gaps).toEqual([])
    expect(flowOf(map, 'h1', 'buy').destinations).toEqual(['Payments'])
  })
})

describe('the fields flows add to a file', () => {
  const doc = mapOf([
    hexagon('h1', {
      useCases: [{ id: 'u', name: 'Charge', description: 'Takes the money', stepNotes: { u: 'decides' } }],
      ports: [{ id: 'out', name: 'Payments', side: 'driven', useCaseId: 'u', verb: 'charge' }],
    }),
  ])

  it('survive a save and open, at the version they are saved at', () => {
    expect(parseHexa(toHexa(doc))).toEqual({ ok: true, map: doc })
  })

  it('are optional: files without them still open', () => {
    const plain = mapOf([hexagon('h1', { useCases: [{ id: 'u', name: 'Charge' }] })])
    expect(parseHexa(toHexa(plain))).toEqual({ ok: true, map: plain })
  })

  it('are rejected when mistyped', () => {
    const bad = JSON.parse(toHexa(doc))
    bad.hexagons[0].ports[0].verb = 3
    expect(parseHexa(JSON.stringify(bad)).ok).toBe(false)
  })
})

describe('flowChain', () => {
  it('holds every element of the flow per hexagon, and the links between them', () => {
    const map = example('hexagonal-advanced')
    const chain = flowChain(map, flowOf(map, 'h1', 'uc-place'))
    expect([...chain.elements.keys()].sort()).toEqual(['h1', 'h2', 'h3', 'h4'])
    expect(chain.elements.get('h1')).toContain('uc-place')
    expect(chain.elements.get('h2')).toEqual(new Set(['p-charge-in']))
    expect(chain.links.size).toBeGreaterThan(0)
    expect([...chain.links].every((id) => map.links.some((l) => l.id === id && l.from.hexagonId === 'h1'))).toBe(true)
  })
})

describe('flowOf with a dangling link', () => {
  const base = (links: HexaMap['links']) =>
    mapOf(
      [
        hexagon('h1', {
          useCases: [{ id: 'u', name: 'Charge' }],
          ports: [{ id: 'in1', name: 'in1', side: 'driving', useCaseId: 'u' }, { id: 'out1', name: 'out1', side: 'driven', useCaseId: 'u' }],
        }),
      ],
      links,
    )
  const link = (from: { hexagonId: string; portId: string }, to: { hexagonId: string; portId: string }) => ({ id: 'l1', from, to })

  it('skips a caller whose port or hexagon is gone, keeping the gap it would have hidden', () => {
    for (const from of [{ hexagonId: 'h1', portId: 'gone' }, { hexagonId: 'hx', portId: 'p' }]) {
      const flow = flowOf(base([link(from, { hexagonId: 'h1', portId: 'in1' })]), 'h1', 'u')
      expect(chain(flow)).toBe('in1 > Charge > out1')
      expect(flow.starters).toEqual([])
      expect(flow.gaps).toContainEqual({ kind: 'noAdapter', hexId: 'h1', id: 'in1' })
    }
  })

  it('skips a callee whose port or hexagon is gone', () => {
    for (const to of [{ hexagonId: 'h1', portId: 'gone' }, { hexagonId: 'hx', portId: 'p' }]) {
      const flow = flowOf(base([link({ hexagonId: 'h1', portId: 'out1' }, to)]), 'h1', 'u')
      expect(chain(flow)).toBe('in1 > Charge > out1')
      expect(flow.destinations).toEqual([])
      expect(flow.gaps).toContainEqual({ kind: 'noAdapter', hexId: 'h1', id: 'out1' })
    }
  })
})
