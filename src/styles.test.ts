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
