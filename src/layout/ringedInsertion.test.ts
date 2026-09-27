import { describe, expect, it } from 'vitest'
import { elementGapPoints, endpointInsertionPoints } from './ringedInsertion'

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

describe('elementGapPoints (explicit gap placement, replacing the old always-append single "+")', () => {
  it('offers nothing for an empty group — the caller keeps its own single "add here" + for that case', () => {
    expect(elementGapPoints([], -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, true)).toEqual([])
    expect(elementGapPoints([], 0, Math.PI, false)).toEqual([])
  })

  it('a circular group (Onion\'s whole ring) gives exactly one gap per element, wrapping the last back to the first', () => {
    const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3] // three elements, evenly spaced
    const gaps = elementGapPoints(angles, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, true)
    expect(gaps).toHaveLength(3)
    expect(gaps.map((g) => g.beforeIndex)).toEqual([1, 2, 0])
    expect(gaps[0].angle).toBeCloseTo(Math.PI / 3, 6)
    expect(gaps[1].angle).toBeCloseTo(Math.PI, 6)
    expect(gaps[2].angle).toBeCloseTo((5 * Math.PI) / 3, 6) // the wraparound gap, between the last element and the first
  })

  it('a circular group of one element gives one gap, diametrically opposite it', () => {
    const gaps = elementGapPoints([0], -Math.PI, Math.PI, true)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].beforeIndex).toBe(0)
    expect(Math.abs(gaps[0].angle)).toBeCloseTo(Math.PI, 6)
  })

  it('a linear group (a Clean sector\'s own wedge) gives one MORE gap than elements — both boundaries count too', () => {
    const angles = [1, 2] // two elements inside a [0, 3] wedge
    const gaps = elementGapPoints(angles, 0, 3, false)
    expect(gaps).toHaveLength(3)
    expect(gaps.map((g) => g.beforeIndex)).toEqual([0, 1, 2])
    expect(gaps[0].angle).toBeCloseTo(0.5, 6) // between the start boundary and the first element
    expect(gaps[1].angle).toBeCloseTo(1.5, 6) // between the two elements
    expect(gaps[2].angle).toBeCloseTo(2.5, 6) // between the last element and the end boundary — "append" (beforeIndex === length)
  })

  it('a linear group of one element still gives a before- and an after-gap', () => {
    const gaps = elementGapPoints([1.5], 0, 3, false)
    expect(gaps).toHaveLength(2)
    expect(gaps.map((g) => g.beforeIndex)).toEqual([0, 1])
  })
})
