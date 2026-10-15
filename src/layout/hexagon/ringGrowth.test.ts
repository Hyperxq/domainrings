import { describe, expect, it, vi } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../../model/example'
import { layoutDiagram } from '../layout'
import { growToClear } from './ringGrowth'

const runs = vi.hoisted(() => [] as Array<{ exhausted: boolean; probes: number }>)
vi.mock('./ringGrowth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ringGrowth')>()
  return {
    ...real,
    growToClear: (clashes: (apex: number) => boolean, apex: number) => {
      let probes = 0
      const result = real.growToClear((a) => (probes++, clashes(a)), apex)
      runs.push({ exhausted: result.exhausted, probes })
      return result
    },
  }
})

describe('growToClear', () => {
  const threshold = 569.8
  const probed = (clashes: (a: number) => boolean) => {
    let calls = 0
    const result = growToClear((a) => (calls++, clashes(a)), 464.2)
    return { ...result, calls }
  }

  it('leaves an apex that already clears alone, after one probe', () => {
    expect(probed(() => false)).toEqual({ apex: 464.2, exhausted: false, calls: 1 })
  })

  it('finds the first clear apex to within a twentieth of a percent, in a handful of probes', () => {
    const { apex, exhausted, calls } = probed((a) => a < threshold)
    expect(exhausted).toBe(false)
    expect(apex).toBeGreaterThanOrEqual(threshold)
    expect(apex).toBeLessThanOrEqual(threshold * 1.0005)
    expect(calls).toBeLessThanOrEqual(16)
  })

  it('gives up and says so when nothing clears, after a bounded number of probes', () => {
    const { exhausted, calls } = probed(() => true)
    expect(exhausted).toBe(true)
    expect(calls).toBeLessThanOrEqual(80)
  })
})

describe('the application ring of the examples', () => {
  it('is found well inside the search budget and never by exhausting it', () => {
    runs.length = 0
    for (const d of [EXAMPLE_DIAGRAM, STRESS_DIAGRAM]) for (const mode of ['detailed', 'overview'] as const) layoutDiagram(d, { mode })
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.filter((r) => r.exhausted)).toEqual([])
    expect(Math.max(...runs.map((r) => r.probes))).toBeLessThanOrEqual(20)
  })
})
