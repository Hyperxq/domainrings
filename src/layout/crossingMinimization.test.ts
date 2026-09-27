import { describe, expect, it } from 'vitest'
import { minimizeCrossings, neighborLookup, type CrossingGroup } from './crossingMinimization'

const FULL_CIRCLE = { startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + 2 * Math.PI }

describe('minimizeCrossings', () => {
  it('reorders groups so each dependency pair lands at the same angular slot (zero crossings)', () => {
    // Outer starts in the REVERSE order [c, b, a] even though c depends on z, b on y, a on x — a naive layout
    // would draw an X-crossed knot. Barycentric reordering may realign EITHER side (whichever the sweep order
    // moves first); what must hold is the outcome, not which group moved: every dependency pair ends up at the
    // same slot index in its own group, so the edge between them is radial, not a diagonal crossing another.
    const domain: CrossingGroup = { key: 'domain', refs: ['x', 'y', 'z'], ...FULL_CIRCLE }
    const outer: CrossingGroup = { key: 'outer', refs: ['c', 'b', 'a'], ...FULL_CIRCLE }
    const neighborsOf = neighborLookup([
      { fromId: 'a', toId: 'x' },
      { fromId: 'b', toId: 'y' },
      { fromId: 'c', toId: 'z' },
    ])
    const order = minimizeCrossings([domain, outer], neighborsOf)
    const domainOrder = order.get('domain')!
    const outerOrder = order.get('outer')!
    expect(outerOrder.indexOf('a')).toBe(domainOrder.indexOf('x'))
    expect(outerOrder.indexOf('b')).toBe(domainOrder.indexOf('y'))
    expect(outerOrder.indexOf('c')).toBe(domainOrder.indexOf('z'))
  })

  it('never moves an element out of its own group', () => {
    const a: CrossingGroup = { key: 'a', refs: ['a1', 'a2'], ...FULL_CIRCLE }
    const b: CrossingGroup = { key: 'b', refs: ['b1', 'b2'], ...FULL_CIRCLE }
    const neighborsOf = neighborLookup([{ fromId: 'a1', toId: 'b2' }])
    const order = minimizeCrossings([a, b], neighborsOf)
    expect(new Set(order.get('a'))).toEqual(new Set(['a1', 'a2']))
    expect(new Set(order.get('b'))).toEqual(new Set(['b1', 'b2']))
  })

  it('is deterministic — the same input always yields the same order', () => {
    const domain: CrossingGroup = { key: 'domain', refs: ['x', 'y', 'z'], ...FULL_CIRCLE }
    const outer: CrossingGroup = { key: 'outer', refs: ['c', 'b', 'a'], ...FULL_CIRCLE }
    const neighborsOf = neighborLookup([
      { fromId: 'a', toId: 'x' },
      { fromId: 'b', toId: 'y' },
      { fromId: 'c', toId: 'z' },
    ])
    const first = minimizeCrossings([domain, outer], neighborsOf)
    const second = minimizeCrossings([domain, outer], neighborsOf)
    expect(first.get('outer')).toEqual(second.get('outer'))
  })

  it('leaves a group with no dependencies at all in its original order', () => {
    const lonely: CrossingGroup = { key: 'lonely', refs: ['p', 'q', 'r'], ...FULL_CIRCLE }
    const order = minimizeCrossings([lonely], neighborLookup([]))
    expect(order.get('lonely')).toEqual(['p', 'q', 'r'])
  })
})
