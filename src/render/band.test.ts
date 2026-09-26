import { describe, expect, it } from 'vitest'
import { bandPath, sectorDividers } from './band'
import { layoutDiagram } from '../layout/layout'
import { EXAMPLE_DIAGRAM } from '../model/example'

describe('bandPath', () => {
  it('cuts each ring band out of its inner ring, one subpath each', () => {
    const m = layoutDiagram(EXAMPLE_DIAGRAM)
    m.rings.forEach((ring, i) => {
      const d = bandPath(m.shape, ring, m.rings[i + 1])
      const subpaths = d.match(/M/g)?.length ?? 0
      expect(subpaths).toBe(i < m.rings.length - 1 ? 2 : 1)
    })
  })
})

describe('sectorDividers (REQ-08: one radial line per sector boundary)', () => {
  it('draws one M...L... segment per boundary angle', () => {
    const d = sectorDividers({ apex: 100 }, undefined, [0, Math.PI / 2, Math.PI])
    expect(d.match(/M/g)?.length).toBe(3)
  })

  it('each divider runs from the inner ring\'s own edge out to this ring\'s own edge', () => {
    expect(sectorDividers({ apex: 100 }, { apex: 40 }, [0])).toBe('M40 0L100 0')
  })

  it('with no inner ring (the innermost ring), dividers start at the centre', () => {
    expect(sectorDividers({ apex: 100 }, undefined, [0])).toBe('M0 0L100 0')
  })

  it('produces no path at all for zero boundaries (a ring with 0 or 1 sector has no dividers)', () => {
    expect(sectorDividers({ apex: 100 }, undefined, [])).toBe('')
  })
})
