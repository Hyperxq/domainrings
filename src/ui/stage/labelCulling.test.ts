import { describe, expect, it } from 'vitest'
import { centreZones, cullLabels, type LabelCandidate } from './labelCulling'

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

  describe('against other boxes', () => {
    const box = (owner: string, x: number, width = 30) => ({ owner, rect: { x, y: 0, width, height: 12 } })

    it('drops a label that would cover another label\'s box', () => {
      expect(cullLabels([at('a', 0, 0, { owner: 'a' })], 0, [box('b', 30)])).toEqual(new Set())
      expect(cullLabels([at('a', 0, 0, { owner: 'a' })], 0, [box('b', 50)])).toEqual(new Set(['a']))
    })

    it('counts the padding as part of the overlap with a box', () => {
      const label = [at('a', 0, 0, { owner: 'a' })]
      expect(cullLabels(label, 0, [box('b', 43)])).toEqual(new Set(['a']))
      expect(cullLabels(label, 4, [box('b', 43)])).toEqual(new Set())
    })

    it('lets a label cover its own box', () => {
      expect(cullLabels([at('a', 0, 0, { owner: 'a' })], 0, [box('a', 0)])).toEqual(new Set(['a']))
    })

    it('keeps a forced label over a box, and still blocks the labels it covers', () => {
      const shown = cullLabels([at('sel', 0, 2, { owner: 'sel', forced: true }), at('port', 20, 0, { owner: 'port' })], 0, [box('b', 30)])
      expect(shown).toEqual(new Set(['sel']))
    })

    it('rejects a label over a box far from the origin, past the grid cells', () => {
      const far = { owner: 'b', rect: { x: 1000, y: 500, width: 200, height: 100 } }
      const label = { ...at('a', 1100, 0, { owner: 'a' }), rect: { x: 1100, y: 540, width: 40, height: 12 } }
      expect(cullLabels([label], 0, [far])).toEqual(new Set())
    })
  })
})

describe('centreZones', () => {
  it("shrinks each box to a small zone around its centre, so a label may run over a box's edge but never its centre", () => {
    const [zone] = centreZones([{ owner: 'b', rect: { x: 100, y: 50, width: 80, height: 40 } }], 6)
    expect(zone).toEqual({ owner: 'b', rect: { x: 134, y: 64, width: 12, height: 12 } })
    expect(cullLabels([{ key: 'a', rect: { x: 0, y: 60, width: 120, height: 20 }, tier: 0, area: 1 }], 0, centreZones([{ owner: 'b', rect: { x: 100, y: 50, width: 80, height: 40 } }], 6))).toEqual(new Set(['a']))
    expect(cullLabels([{ key: 'a', rect: { x: 0, y: 60, width: 150, height: 20 }, tier: 0, area: 1 }], 0, centreZones([{ owner: 'b', rect: { x: 100, y: 50, width: 80, height: 40 } }], 6))).toEqual(new Set())
  })

  it('never grows a box smaller than the zone', () => {
    const [zone] = centreZones([{ owner: 'b', rect: { x: 0, y: 0, width: 4, height: 2 } }], 6)
    expect(zone.rect).toEqual({ x: 0, y: 0, width: 4, height: 2 })
  })
})
