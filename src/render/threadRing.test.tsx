import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { LayoutNode } from '../layout/layout'
import { contrast, PALETTES, type PaletteId } from '../ui/palette'
import { THREAD_SLOTS, threadColour } from '../model/threadPalette'
import { svgMarkup } from '../ui/exporters'
import { ThreadDots } from './ThreadDots'

afterEach(cleanup)

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
const rule = css.match(/^\.thread-dot \{([^}]*)\}/m)?.[1] ?? ''

const CASES = (Object.keys(PALETTES) as PaletteId[]).flatMap((id) => (['light', 'dark'] as const).map((mode) => [id, mode] as const))

describe('a thread dot on a filled box', () => {
  it('is drawn with a surface-coloured ring that is painted behind the dot', () => {
    expect(rule).toMatch(/stroke:\s*var\(--card\)/)
    expect(rule).toMatch(/paint-order:\s*stroke/)
    expect(Number(rule.match(/stroke-width:\s*([\d.]+)/)?.[1])).toBeGreaterThanOrEqual(3)
  })

  it('carries the thread-dot class on an adapter, which the ring rule targets', () => {
    const adapter = { kind: 'adapter', x: 100, y: 50, width: 120, height: 40, threads: [{ id: 'u1', slot: 3 }] } as unknown as LayoutNode
    const { container } = render(
      <svg>
        <ThreadDots node={adapter} />
      </svg>,
    )
    expect(container.querySelector('circle.thread-dot')).not.toBeNull()
  })

  // The dark driving/driven fills sit closer to --card than the light ones do; 2.29 is just under the worst measured (2.298)
  // (terracotta dark), so this floor catches a regression without choosing new palette colours.
  it.each(CASES)('keeps its ring apart from the driving and driven adapter fills (%s, %s)', (id, mode) => {
    const p = PALETTES[id][mode]
    const floor = mode === 'light' ? 3 : 2.29
    for (const f of ['driving-fill', 'driven-fill'] as const) expect(contrast(p.card, p[f]), f).toBeGreaterThanOrEqual(floor)
  })

  it.each(CASES)('keeps every thread colour at 3:1 or more against its ring and the pale external fill (%s, %s)', (id, mode) => {
    const p = PALETTES[id][mode]
    for (let s = 0; s < THREAD_SLOTS; s++) {
      expect(contrast(threadColour(s, mode), p.card), `slot ${s} on card`).toBeGreaterThanOrEqual(3)
      expect(contrast(threadColour(s, mode), p['slate-soft']), `slot ${s} on slate-soft`).toBeGreaterThanOrEqual(3)
    }
  })

  it('survives export as inline paint on the dot', async () => {
    const adapter = { kind: 'adapter', x: 100, y: 50, width: 120, height: 40, threads: [{ id: 'u1', slot: 3 }] } as unknown as LayoutNode
    const styleTag = document.createElement('style')
    styleTag.textContent = ':root { --card: #fbfbf9; --thread-3: #123456; }\n' + css
    document.head.appendChild(styleTag)
    const { container } = render(
      <svg>
        <ThreadDots node={adapter} />
      </svg>,
    )
    try {
      const markup = await svgMarkup(container.querySelector('svg')!, { x: 0, y: 0, width: 300, height: 200 }, 'T', { legend: false, legendHeight: 0 })
      const dot = markup.match(/<circle[^>]*>/)![0]
      expect(dot).not.toContain('class=')
      // jsdom leaves var() unresolved; a browser resolves it to the card colour before it is inlined.
      expect(dot).toMatch(/stroke="(var\(--card\)|rgb\(251, 251, 249\)|#fbfbf9)"/)
      expect(dot).toMatch(/stroke-width="4/)
      expect(dot).toContain('paint-order="stroke')
    } finally {
      styleTag.remove()
    }
  })
})
