import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
const motion = [...css.matchAll(/(?<![-\w])(?:transition|animation)(?:-duration|-timing-function)?\s*:\s*([^;}]+)/g)]
  .map((m) => m[1].trim())
  // The editor's reveal flash is a 1.2 s highlight whose reduced-motion stand-in is an outline, not stillness.
  .filter((value) => !/^none\b/.test(value) && !value.startsWith('flash'))

describe('motion tokens', () => {
  it('reads the motion declarations, not a vacuous subset', () => {
    expect(motion.length).toBeGreaterThanOrEqual(6)
  })

  it('times every transition and animation with the shared duration and easing tokens', () => {
    for (const value of motion) {
      expect(value).not.toMatch(/\d(m?s)\b|(?<![-\w])(ease(-in|-out|-in-out)?|linear)\b|cubic-bezier/)
      expect(value).toMatch(/var\(--motion-(fast|base|ease)\)/)
    }
  })

  it('zeroes every duration token when the user asks for reduced motion', () => {
    const reduce = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)?.[1] ?? ''
    const tokens = [...css.matchAll(/(--motion-(?:fast|base)):/g)].map((m) => m[1])
    expect(new Set(tokens)).toEqual(new Set(['--motion-fast', '--motion-base']))
    for (const token of ['--motion-fast', '--motion-base']) expect(reduce).toMatch(new RegExp(`${token}:\\s*0s`))
  })
})

// An Onion/Clean actor/external's name sits directly on the canvas background, next to its own dot — unlike a
// Hexagonal tone pill, where the SAME `.tone-driving`/`.tone-driven` classes' text sits on top of a solid,
// saturated fill (`--driving-fill`/`--driven-fill`). `--driving-ink`/`--driven-ink` are tuned for contrast
// against THAT fill (near-white in every palette/theme) — reused as-is for text on the plain canvas background,
// they vanish in light theme (near-white on a near-white page). `.node-ringedEndpoint` needs the ordinary,
// theme-aware canvas ink instead, overriding the tone rule.
// A Clean sector's own name used to fade to opacity 0.85 (0.75 on the domain ring) ON TOP OF an already-small,
// already-lighter-weight font — compounding two "make it recede" signals left it nearly invisible at fit
// (reported: "nearly invisible" sector names). --muted/--domain-ink already clear WCAG AA on their own
// (palette.test.ts's TEXT_PAIRS); size and weight alone carry the ring > sector hierarchy now.
describe('a Clean sector label never dims below its own already-validated text colour', () => {
  it('.sector-label and .sector-label.on-domain carry no opacity of their own', () => {
    for (const selector of ['.canvas .sector-label {', '.canvas .sector-label.on-domain {']) {
      const start = css.indexOf(selector)
      expect(start).toBeGreaterThan(-1)
      const rule = css.slice(start, css.indexOf('}', start) + 1)
      expect(rule).not.toMatch(/opacity:\s*0\.\d/)
    }
  })
})

describe('a ringed endpoint\'s own name reads on the canvas, not the tone pill\'s ink', () => {
  it('overrides the tone-driving/tone-driven text colour with the canvas ink for .node-ringedEndpoint', () => {
    const toneRuleIndex = css.indexOf('.canvas .tone-driven text, .canvas .tone-driven tspan { fill: var(--driven-ink); }')
    expect(toneRuleIndex).toBeGreaterThan(-1)
    const overrideIndex = css.indexOf('.node-ringedEndpoint')
    expect(overrideIndex).toBeGreaterThan(toneRuleIndex)
    const overrideRule = css.slice(overrideIndex, css.indexOf('}', overrideIndex) + 1)
    expect(overrideRule).toContain('fill: var(--ink)')
  })
})
