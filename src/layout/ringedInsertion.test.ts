import { describe, expect, it } from 'vitest'
import { endpointInsertionPoints } from './ringedInsertion'

describe('endpointInsertionPoints (shared by Onion and Clean — REQ-05/REQ-07)', () => {
  it('offers an actor and an external "+" beside every outer-ring element passed in', () => {
    const points = endpointInsertionPoints([{ ref: 'e-outer', name: 'Controller', x: 100, y: 0 }], 'outer')
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.action.collection).sort()).toEqual(['actors', 'externals'])
    expect(points.every((p) => p.action.targetId === 'e-outer')).toBe(true)
    expect(points.every((p) => p.ringRole === 'outer')).toBe(true)
    expect(points.find((p) => p.action.collection === 'actors')!.label).toBe('Add an actor for Controller')
    expect(points.find((p) => p.action.collection === 'externals')!.label).toBe('Add an external system for Controller')
  })

  it('offers nothing for an empty outer-element list', () => {
    expect(endpointInsertionPoints([], 'outer')).toEqual([])
  })

  it('spreads the actor and external "+" apart, both further out than the element itself', () => {
    const element = { ref: 'e-outer', name: 'Controller', x: 100, y: 0 }
    const points = endpointInsertionPoints([element], 'outer')
    for (const p of points) expect(Math.hypot(p.at.x, p.at.y)).toBeGreaterThan(Math.hypot(element.x, element.y))
    expect(points[0].at).not.toEqual(points[1].at)
  })
})
