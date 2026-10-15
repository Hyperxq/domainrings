import { describe, expect, it } from 'vitest'
import { LEGEND_HEADING, LEGEND_ROW, legendFor, legendSections, legendSize } from './legend'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'

describe('legendFor', () => {
  it('lists the colour channel: one row per ring of the kind, plus the two sides', () => {
    expect(legendFor(EXAMPLE_DIAGRAM).colours.map((r) => r.label)).toEqual([
      'Infrastructure',
      'Application',
      'Domain',
      'Driving side',
      'Driven side',
      'External systems',
    ])
  })

  it('lists the stroke channel: dashed contract, solid implementation, dotted wiring', () => {
    expect(legendFor(EXAMPLE_DIAGRAM).strokes).toEqual([
      { stroke: 'dashed', label: 'Contract: port' },
      { stroke: 'solid', label: 'Implementation: adapter, use case' },
      { stroke: 'dotted', label: 'Wiring and ownership' },
    ])
  })

  it('lists one glyph row per element type present in the diagram, in the kind vocabulary', () => {
    expect(legendFor(EXAMPLE_DIAGRAM).tags).toEqual([
      '◆ aggregate',
      '○ value object',
      '▶ use case',
      '⇥ driving port',
      '◇ driven port',
      '⇥ infrastructure/in',
      '⇤ infrastructure/out',
    ])
    expect(legendFor(STRESS_DIAGRAM).tags).toContain('● entity')
  })
})

describe('legendFor — planned', () => {
  it('adds a planned stroke row when the diagram shows planned items, after the three standing ones', () => {
    expect(legendFor(EXAMPLE_DIAGRAM, true).strokes.at(-1)).toEqual({ stroke: 'planned', label: 'Planned: not built yet' })
    expect(legendFor(EXAMPLE_DIAGRAM, true).strokes).toHaveLength(4)
  })

  it('adds nothing when nothing is planned', () => {
    expect(legendFor(EXAMPLE_DIAGRAM).strokes).toHaveLength(3)
    expect(legendFor(EXAMPLE_DIAGRAM, false).strokes.map((s) => s.stroke)).not.toContain('planned')
  })

  it('makes room for the row in the export block', () => {
    expect(legendSize(legendFor(EXAMPLE_DIAGRAM, true)).height - legendSize(legendFor(EXAMPLE_DIAGRAM)).height).toBe(LEGEND_ROW)
  })
})

describe('legend sections', () => {
  const empty = { ...EXAMPLE_DIAGRAM, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }

  it('names the three channels as small label pairs', () => {
    expect(legendSections(legendFor(EXAMPLE_DIAGRAM)).map((s) => s.title)).toEqual(['Colour · layer', 'Stroke · role', 'Glyph · type'])
  })

  it('omits a channel with nothing to explain, in the island and in the export block alike', () => {
    const sections = legendSections(legendFor(empty))
    expect(sections.map((s) => s.title)).toEqual(['Colour · layer', 'Stroke · role'])
    const full = legendSize(legendFor(EXAMPLE_DIAGRAM))
    const bare = legendSize(legendFor(empty))
    expect(full.height - bare.height).toBe(LEGEND_HEADING + legendFor(EXAMPLE_DIAGRAM).tags.length * LEGEND_ROW)
  })
})
