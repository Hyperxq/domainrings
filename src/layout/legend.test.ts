import { describe, expect, it } from 'vitest'
import { LEGEND_HEADING, LEGEND_PAD, LEGEND_ROW, legendFor, legendForClean, legendForOnion, legendSections, legendSize } from './legend'
import { threadSlots } from '../model/threads'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'

describe('legendFor', () => {
  it('lists only the layers, under a Layers heading, then the threads', () => {
    const legend = legendFor(EXAMPLE_DIAGRAM)
    expect(legend.colours.map((r) => r.label)).toEqual(['Infrastructure', 'Application', 'Domain'])
    expect(legendSections(legend).map((s) => s.title)).toEqual(['Layers'])
    expect(legend.threads).toHaveLength(EXAMPLE_DIAGRAM.useCases.length)
  })

  it('honours the diagram’s own layer names', () => {
    const named = { ...EXAMPLE_DIAGRAM, layers: { domain: { title: ' Core ' } } }
    expect(legendFor(named).colours.map((r) => r.label)).toEqual(['Infrastructure', 'Application', 'Core'])
  })

  it('no longer explains strokes or glyphs, planned items included', () => {
    const legend = legendFor(EXAMPLE_DIAGRAM)
    expect(legend.strokes).toEqual([])
    expect(legend.tags).toEqual([])
  })
})

describe('legend sections', () => {
  it('the export block is sized by the layers and the threads block alone', () => {
    const { height } = legendSize(legendFor(EXAMPLE_DIAGRAM))
    const rows = 3 + EXAMPLE_DIAGRAM.useCases.length
    expect(height).toBe(2 * LEGEND_PAD + 2 * LEGEND_HEADING + rows * LEGEND_ROW)
  })
})

describe('the legend\'s threads block', () => {
  it('lists one row per use case, in thread-slot order, with the slot it draws with', () => {
    const threads = legendFor(STRESS_DIAGRAM).threads!
    expect(threads.map((t) => t.name)).toEqual(STRESS_DIAGRAM.useCases.map((u) => u.name))
    expect(threads.map((t) => t.slot)).toEqual(STRESS_DIAGRAM.useCases.map((u) => threadSlots(STRESS_DIAGRAM).get(u.id)))
  })

  it('is absent when the hexagon has no use case', () => {
    expect(legendFor({ ...EXAMPLE_DIAGRAM, useCases: [] }).threads).toBeUndefined()
  })

  it('is absent from the Onion and Clean legends', () => {
    expect(legendForOnion({ rings: [{ role: 'domain', name: 'Domain' }] } as never).threads).toBeUndefined()
    expect(legendForClean({ rings: [{ role: 'domain', name: 'Domain' }] } as never).threads).toBeUndefined()
  })

  it('makes the export block taller by a heading and a row per thread', () => {
    const [plain, withThreads] = [legendFor({ ...STRESS_DIAGRAM, useCases: [] }), legendFor(STRESS_DIAGRAM)]
    expect(legendSize(withThreads).height - legendSize({ ...withThreads, threads: undefined }).height).toBe(LEGEND_HEADING + STRESS_DIAGRAM.useCases.length * LEGEND_ROW)
    expect(plain.threads).toBeUndefined()
  })
})
