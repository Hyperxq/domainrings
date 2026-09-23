import { describe, expect, it } from 'vitest'
import { blend, contrast, GUIDE_OPACITY, GUIDE_TOKEN, PALETTE, paletteCss, TEXT_PAIRS } from './palette'

describe('palette', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it.each(['light', 'dark'] as const)('reaches 4.5:1 for every text-on-fill pair in the %s theme', (theme) => {
    const failing = TEXT_PAIRS.map(([text, fill]) => ({ pair: `${text} on ${fill}`, ratio: contrast(PALETTE[theme][text], PALETTE[theme][fill]) }))
      .filter((p) => p.ratio < 4.5)
      .map((p) => `${p.pair} = ${p.ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('emits both themes: the system default and the explicit override', () => {
    const css = paletteCss()
    expect(css).toContain(`--driving-fill: ${PALETTE.light['driving-fill']};`)
    expect(css).toContain("@media (prefers-color-scheme: dark)")
    expect(css).toContain(":root:not([data-theme='light'])")
    expect(css).toContain(":root[data-theme='dark']")
  })

  it.each(['light', 'dark'] as const)('keeps the guide spokes at 2.2:1 or more against every band they cross (%s)', (theme) => {
    const p = PALETTE[theme]
    const opacity = GUIDE_OPACITY[theme]
    for (const band of ['slate-soft', 'teal-soft'] as const) {
      expect(contrast(blend(p[GUIDE_TOKEN], p[band], opacity), p[band])).toBeGreaterThanOrEqual(2.2)
    }
    expect(paletteCss()).toContain(`--guide-opacity: ${opacity};`)
  })
})
