import { describe, expect, it } from 'vitest'
import { roundedPath } from './roundedPath'

describe('roundedPath', () => {
  it('draws a straight run as a line', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 40, y: 0 }])).toBe('M0 0 L40 0')
  })

  it('rounds a corner with a radius of 12 along both runs', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toBe('M0 0 L88 0 Q100 0 100 12 L100 100')
  })

  it('rounds a corner of any angle along its own runs', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 86.60254037844386 }])
    expect(d).toMatch(/^M0 0 L88 0 Q100 0 106 10\.39/)
  })

  it('clamps the radius to half of the shorter run', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }])).toBe('M0 0 L5 0 Q10 0 10 5 L10 100')
  })

  it('leaves collinear points alone and drops repeated ones', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0 }, { x: 60, y: 0 }])).toBe('M0 0 L20 0 L60 0')
  })

  it('draws nothing for no points', () => {
    expect(roundedPath([])).toBe('')
  })

  it('measures a run from the last point kept, so tiny steps cannot drift', () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({ x: i * 0.4, y: 0 }))
    expect(roundedPath(steps)).toBe('M0 0 L0.8 0 L1.6 0 L2.4 0 L3.2 0 L4 0')
  })
})
