import { describe, expect, it } from 'vitest'
import { blend, contrast, GUIDE_OPACITY, GUIDE_TOKEN, PALETTES, paletteCss, TEXT_PAIRS, type PaletteId } from './palette'

const CASES = (Object.keys(PALETTES) as PaletteId[]).flatMap((id) => (['light', 'dark'] as const).map((theme) => [id, theme] as const))

describe('palette', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it('offers the default and two curated alternatives', () => {
    expect(Object.keys(PALETTES)).toEqual(['default', 'ink', 'moss'])
  })

  it.each(CASES)('reaches 4.5:1 for every text-on-fill pair in the %s palette, %s theme', (id, theme) => {
    const table = PALETTES[id][theme]
    const failing = TEXT_PAIRS.map(([text, fill]) => ({ pair: `${text} on ${fill}`, ratio: contrast(table[text], table[fill]) }))
      .filter((p) => p.ratio < 4.5)
      .map((p) => `${p.pair} = ${p.ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('emits both themes: the system default and the explicit override', () => {
    const css = paletteCss()
    expect(css).toContain(`--driving-fill: ${PALETTES.default.light['driving-fill']};`)
    expect(css).toContain("@media (prefers-color-scheme: dark)")
    expect(css).toContain(":root:not([data-theme='light'])")
    expect(css).toContain(":root[data-theme='dark']")
  })

  it('opens with the default palette under bare :root, before any data-palette block', () => {
    const css = paletteCss()
    expect(css.startsWith(':root {')).toBe(true)
    expect(css.indexOf('data-palette')).toBeGreaterThan(css.indexOf(":root[data-theme='dark'] {"))
  })

  it.each(['ink', 'moss'] as const)('keys the %s palette to data-palette, one selector more specific than each default block', (id) => {
    const css = paletteCss()
    const sel = `:root[data-palette='${id}']`
    // Light: beats bare :root; dark (system or explicit): one attribute more than the default dark selectors.
    expect(css).toContain(`${sel} {\n  color-scheme: light;\n  --bg: ${PALETTES[id].light.bg};`)
    expect(css).toContain(
      `@media (prefers-color-scheme: dark) {\n  ${sel}:not([data-theme='light']) {\n  color-scheme: dark;\n  --bg: ${PALETTES[id].dark.bg};`,
    )
    expect(css).toContain(`${sel}[data-theme='dark'] {\n  color-scheme: dark;\n  --bg: ${PALETTES[id].dark.bg};`)
    expect(css).not.toContain(":root[data-palette='default']")
  })

  it.each(CASES)('keeps the guide spokes at 2.2:1 or more against every band they cross (%s, %s)', (id, theme) => {
    const p = PALETTES[id][theme]
    const opacity = GUIDE_OPACITY[theme]
    for (const band of ['slate-soft', 'teal-soft'] as const) {
      expect(contrast(blend(p[GUIDE_TOKEN], p[band], opacity), p[band])).toBeGreaterThanOrEqual(2.2)
    }
    expect(paletteCss()).toContain(`--guide-opacity: ${opacity};`)
  })
})
