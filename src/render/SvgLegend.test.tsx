import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { legendFor, legendForOnion, legendSize, LEGEND_PAD, LEGEND_ROW } from '../layout/legend'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import { threadSlots } from '../model/threads'
import { SvgLegend } from './SvgLegend'

afterEach(cleanup)

const bounds = { x: 0, y: 0, width: 800, height: 600 }
const draw = (legend: ReturnType<typeof legendFor>) => render(<svg><SvgLegend legend={legend} bounds={bounds} /></svg>).container

describe('the exported legend\'s threads block', () => {
  it('draws one dot in the thread colour and the use case name per thread, in order', () => {
    const rows = [...draw(legendFor(STRESS_DIAGRAM)).querySelectorAll('.legend-thread')]
    const slots = threadSlots(STRESS_DIAGRAM)
    expect(rows.map((r) => r.querySelector('text')!.textContent)).toEqual(STRESS_DIAGRAM.useCases.map((u) => u.name))
    expect(rows.map((r) => (r.querySelector('circle') as SVGCircleElement).getAttribute('style'))).toEqual(STRESS_DIAGRAM.useCases.map((u) => `--thread: var(--thread-${slots.get(u.id)});`))
  })

  it('has a Threads heading, and the panel is tall enough to hold every row', () => {
    const legend = legendFor(EXAMPLE_DIAGRAM)
    const c = draw(legend)
    expect([...c.querySelectorAll('.legend-heading')].map((h) => h.textContent)).toContain('Threads')
    const lastRow = [...c.querySelectorAll('.legend-thread text')].at(-1)!
    const rowBottom = Number(lastRow.getAttribute('y')) + LEGEND_ROW / 2
    expect(rowBottom + LEGEND_PAD).toBeLessThanOrEqual(legendSize(legend).height)
  })

  it('is left out of the Onion legend', () => {
    expect(draw(legendForOnion({ rings: [{ role: 'domain', name: 'Domain' }] } as never)).querySelectorAll('.legend-thread')).toHaveLength(0)
  })
})
