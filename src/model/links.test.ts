import { describe, expect, it } from 'vitest'
import { linkTargets } from './links'
import type { Diagram } from './schema'

const d: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: 'Links',
  domain: [
    { id: 'agg', name: 'Order', type: 'aggregate' },
    { id: 'ent', name: 'OrderLine', type: 'entity', parentId: 'agg' },
    { id: 'vo', name: 'Money', type: 'valueObject', parentId: 'ent' },
    { id: 'ent2', name: 'Customer', type: 'entity' },
    { id: 'svc', name: 'Pricing', type: 'domainService' },
  ],
  useCases: [
    { id: 'uc1', name: 'PlaceOrder' },
    { id: 'uc2', name: 'CancelOrder' },
  ],
  ports: [
    { id: 'in1', name: 'ordersApi', side: 'driving', useCaseId: 'uc1' },
    { id: 'in2', name: 'adminApi', side: 'driving' },
    { id: 'out1', name: 'OrderRepository', side: 'driven' },
    { id: 'out2', name: 'Payments', side: 'driven' },
  ],
  adapters: [
    { id: 'rest', name: 'orders.routes', portId: 'in1' },
    { id: 'knex', name: 'KnexOrders', portId: 'out1' },
    { id: 'bare', name: 'NewAdapter' },
    { id: 'toStripe', name: 'stripe.client' },
    { id: 'fromCli', name: 'admin.cli' },
  ],
  actors: [
    { id: 'shop', name: 'Web shop', adapterId: 'rest' },
    { id: 'ops', name: 'Ops', adapterId: 'fromCli' },
  ],
  externals: [
    { id: 'pg', name: 'Postgres', adapterId: 'knex' },
    { id: 'stripe', name: 'Stripe', adapterId: 'toStripe' },
  ],
}
const refs = (ref: string) => linkTargets(d, ref).map((t) => t.targetRef)

describe('linkTargets', () => {
  it('links an adapter to the other ports of its side, never across sides', () => {
    expect(linkTargets(d, 'rest')).toEqual([{ targetRef: 'in2', patch: { portId: 'in2' } }])
    expect(refs('knex')).toEqual(['out2'])
  })

  it('reads an unlinked adapter’s side from its endpoints, and offers every port when nothing says', () => {
    expect(refs('toStripe')).toEqual(['out1', 'out2'])
    expect(refs('fromCli')).toEqual(['in1', 'in2'])
    expect(refs('bare')).toEqual(['in1', 'in2', 'out1', 'out2'])
  })

  it('links a port to any use case but the one it already serves', () => {
    expect(linkTargets(d, 'in1')).toEqual([{ targetRef: 'uc2', patch: { useCaseId: 'uc2' } }])
    expect(refs('out1')).toEqual(['uc1', 'uc2'])
  })

  it('links an actor to driving adapters only, and an external system to driven adapters only', () => {
    expect(linkTargets(d, 'shop')).toEqual([
      { targetRef: 'bare', patch: { adapterId: 'bare' } },
      { targetRef: 'fromCli', patch: { adapterId: 'fromCli' } },
    ])
    expect(refs('pg')).toEqual(['bare', 'toStripe'])
  })

  it('links an entity or value object to an aggregate or entity, never itself, its current parent or anything below it', () => {
    expect(linkTargets(d, 'vo')).toEqual([
      { targetRef: 'agg', patch: { parentId: 'agg' } },
      { targetRef: 'ent2', patch: { parentId: 'ent2' } },
    ])
    // ent holds vo: linking ent under vo would close a cycle, and a value object holds nothing anyway.
    expect(refs('ent')).toEqual(['ent2'])
    expect(refs('ent2')).toEqual(['agg', 'ent'])
  })

  it('offers nothing for sources that only receive links, or that are not items', () => {
    for (const ref of ['uc1', 'agg', 'svc', 'composition', 'layer:application', 'driven-ports', 'missing']) expect(refs(ref)).toEqual([])
  })
})
