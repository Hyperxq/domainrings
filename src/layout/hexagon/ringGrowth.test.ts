import { describe, expect, it, vi } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../../model/example'
import projectBuilderRaw from '../../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../../model/hexa'
import { diagramOf } from '../../model/map'
import type { Diagram } from '../../model/schema'
import { layoutDiagram } from '../layout'
import { growToClear } from './ringGrowth'

const runs = vi.hoisted(() => [] as Array<{ exhausted: boolean; probes: number; clashes: (apex: number) => boolean; start: number; apex: number }>)
vi.mock('./ringGrowth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ringGrowth')>()
  return {
    ...real,
    growToClear: (clashes: (apex: number) => boolean, apex: number) => {
      let probes = 0
      const result = real.growToClear((a) => (probes++, clashes(a)), apex)
      runs.push({ exhausted: result.exhausted, probes, clashes, start: apex, apex: result.apex })
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

/** One use case whose driven ports all sit on the east wall, each with its own adapter and external system. */
const crowdedOn = (n: number): Diagram => {
  const ids = Array.from({ length: n }, (_, i) => i)
  return {
    version: 1,
    kind: 'hexagonal',
    title: '',
    domain: [{ id: 'g', name: 'Order', type: 'aggregate' }],
    useCases: [{ id: 'u', name: 'PlaceOrder', aggregateIds: ['g'] }],
    ports: ids.map((i) => ({ id: `p${i}`, name: `Port${i}`, side: 'driven' as const, wall: 'e' as const, useCaseId: 'u' })),
    adapters: ids.map((i) => ({ id: `a${i}`, name: `SomeFairlyLongAdapterName${i}`, portId: `p${i}` })),
    actors: [],
    externals: ids.map((i) => ({ id: `x${i}`, name: `External system ${i}`, adapterId: `a${i}` })),
  }
}

describe('the search against a fine linear walk', () => {
  const parsed = parseHexa(projectBuilderRaw)
  const maps = [...EXAMPLES.map((e) => e.map), ...(parsed.ok ? [parsed.map] : [])]
  const examples: Diagram[] = [EXAMPLE_DIAGRAM, STRESS_DIAGRAM, ...maps.flatMap((m) => (m.kind === 'hexagonal' ? m.hexagons.map((h) => diagramOf(m, h.id)) : []))]
  const modes = ['detailed', 'overview'] as const

  const crowded = [4, 6, 8, 10, 12, 14, 18, 24, 30].map(crowdedOn)

  it('lands on the first clear apex of every ring, crowded or not, so the clash test is monotone where it is used', () => {
    runs.length = 0
    for (const d of [...examples, ...crowded]) for (const mode of modes) layoutDiagram(d, { mode })
    const rings = [...runs]
    expect(rings.filter((r) => r.probes > 1).length).toBeGreaterThan(0)
    for (const { clashes, start, apex, exhausted } of rings) {
      expect(exhausted).toBe(false)
      let walked = start
      for (let step = 0; clashes(walked); step++) {
        expect(step).toBeLessThan(10000)
        walked *= 1.001
      }
      expect(Math.abs(apex / walked - 1)).toBeLessThan(0.002)
    }
  })
})
