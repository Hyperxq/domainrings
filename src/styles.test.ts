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

// A ring/sector title's own halo (paint-order: stroke) reads over whatever the title sits ON — its own ring's
// fill, or the domain fill for the innermost/on-domain case — never a fixed canvas colour: the innermost title is
// near-white ink (--domain-ink) on the dark --teal-deep domain fill, so a --card (light, near-white) halo used to
// render white-on-white, blobbing the glyphs together (the reported illegible "Domain Model"/"Entities" title).
describe('a ring/sector title\'s halo matches the band it actually sits on', () => {
  const ruleFor = (selector: string): string => {
    const at = css.indexOf(selector)
    expect(at).toBeGreaterThan(-1)
    const open = css.indexOf('{', at)
    const close = css.indexOf('}', open)
    return css.slice(open, close + 1)
  }
  const propertyIn = (rule: string, prop: string): string => rule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim() ?? ''
  const fillOfRing = (role: string) => propertyIn(ruleFor(`.ring-${role} {`), 'fill')

  it('a ring/sector title on a non-domain band haloes with THAT band\'s own fill', () => {
    for (const role of ['outer', 'adapters', 'application', 'domainServices']) {
      expect(propertyIn(ruleFor(`.ring-label[data-layer='${role}']`), 'stroke')).toBe(fillOfRing(role))
      expect(propertyIn(ruleFor(`.sector-label[data-layer='${role}']`), 'stroke')).toBe(fillOfRing(role))
    }
  })

  it('the innermost title (domain-title / on-domain) haloes with the domain ring\'s own fill', () => {
    const domainFill = fillOfRing('domain')
    // ".domain-title" alone also matches the shared paint-order/stroke-width block above (no `stroke` declared
    // there any more) — anchoring on its own selector GROUP (unique to the halo-colour block) finds the right one.
    for (const selector of ['.canvas .domain-title,\n.canvas .ring-label.on-domain', '.canvas .ring-label.on-domain', '.canvas .sector-label.on-domain']) {
      expect(propertyIn(ruleFor(selector), 'stroke')).toBe(domainFill)
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

describe('dependents emphasis', () => {
  // Dashed map links and port boxes already exist, so the dependents style needs a pattern nothing else uses — colour never carries it.
  it('draws the dependents with a dash pattern of its own, on every stroke the dependencies chain thickens, and nowhere else', () => {
    const rule = (selector: string) => css.match(new RegExp(`svg\\[data-emphasis='dependents'\\] ${selector}[^{]*\\{([^}]*)\\}`))?.[1] ?? ''
    const pattern = rule('\\.edge\\[data-chain\\]').match(/stroke-dasharray:\s*([^;]+)/)?.[1]
    expect(pattern).toBeTruthy()
    for (const selector of ['\\.map-link\\[data-chain\\]', '\\.node\\[data-chain\\] \\.box', '\\.compact-port\\[data-chain\\] circle']) expect(rule(selector)).toContain(`stroke-dasharray: ${pattern}`)
    expect(css.split(`stroke-dasharray: ${pattern}`)).toHaveLength(2)
  })
})
