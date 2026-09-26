import { describe, expect, it } from 'vitest'
import { newOnionMap } from '../model/hexa'
import { layoutOnion } from './onion'

describe('layoutOnion (rings only)', () => {
  it('lays out exactly the 4 rings the document declares, innermost-first, each strictly inside the next', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    expect(model.rings).toHaveLength(4)
    expect(model.rings.map((r) => r.role)).toEqual(['domain', 'domainServices', 'application', 'outer'])
    for (let i = 0; i < model.rings.length - 1; i++) {
      expect(model.rings[i].apex).toBeLessThan(model.rings[i + 1].apex)
    }
  })

  it('titles the innermost ring sentence-case and every other ring uppercase', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    expect(model.rings.find((r) => r.role === 'domain')!.title).toBe('Domain Model')
    expect(model.rings.find((r) => r.role === 'outer')!.title).toBe('INFRASTRUCTURE')
  })

  it('bounds fully enclose the outermost ring, with margin', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    const outer = model.rings[model.rings.length - 1]
    expect(model.bounds.x).toBeLessThan(-outer.halfWidth)
    expect(model.bounds.y).toBeLessThan(-outer.apex)
    expect(model.bounds.width).toBeGreaterThan(2 * outer.halfWidth)
    expect(model.bounds.height).toBeGreaterThan(2 * outer.apex)
  })
})
