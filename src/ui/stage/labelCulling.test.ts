import { describe, expect, it } from 'vitest'
import { cullLabels, type LabelCandidate } from './labelCulling'

const at = (key: string, x: number, tier: 0 | 1 | 2, extra: Partial<LabelCandidate> = {}): LabelCandidate => ({
  key,
  rect: { x, y: 0, width: 40, height: 12 },
  tier,
  area: 100,
  ...extra,
})

describe('cullLabels', () => {
  it('keeps every label that overlaps nothing', () => {
    expect(cullLabels([at('a', 0, 2), at('b', 100, 2)], 0)).toEqual(new Set(['a', 'b']))
  })

  it('drops the lower tier of two overlapping labels, whatever the input order', () => {
    expect(cullLabels([at('domain', 10, 2), at('port', 0, 0)], 0)).toEqual(new Set(['port']))
    expect(cullLabels([at('adapter', 10, 1), at('port', 0, 0)], 0)).toEqual(new Set(['port']))
  })

  it('prefers the larger box within a tier, then the smaller key', () => {
    expect(cullLabels([at('small', 0, 1, { area: 10 }), at('big', 10, 1, { area: 50 })], 0)).toEqual(new Set(['big']))
    expect(cullLabels([at('b', 0, 1), at('a', 10, 1)], 0)).toEqual(new Set(['a']))
  })

  it('counts the padding as part of the overlap', () => {
    const pair = [at('a', 0, 1), at('b', 43, 1)]
    expect(cullLabels(pair, 0)).toEqual(new Set(['a', 'b']))
    expect(cullLabels(pair, 4)).toEqual(new Set(['a']))
  })

  it('places forced labels first and always keeps them', () => {
    const shown = cullLabels([at('port', 0, 0), at('domain', 10, 2, { forced: true })], 0)
    expect(shown).toEqual(new Set(['domain']))
  })

  it('does not depend on the input order', () => {
    const labels = [at('a', 0, 1), at('b', 20, 1), at('c', 40, 0), at('d', 60, 2)]
    expect(cullLabels([...labels].reverse(), 2)).toEqual(cullLabels(labels, 2))
  })
})
