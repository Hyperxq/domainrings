import { describe, expect, it } from 'vitest'
import { bandPath } from './band'
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
