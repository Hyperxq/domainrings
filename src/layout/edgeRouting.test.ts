import { describe, expect, it } from 'vitest'
import { edgeControl, routeEdgesAroundLabels } from './edgeRouting'

const rings = [
  { title: 'Domain', apex: 100 },
  { title: 'APPLICATION', apex: 250 },
]

describe('routeEdgesAroundLabels', () => {
  it('keeps the default bow for an arrow that never meets a label', () => {
    const edge = { from: { x: -120, y: 100 }, to: { x: 120, y: 100 } }
    const [routed] = routeEdgesAroundLabels([edge], rings)
    expect(routed.control).toEqual(edgeControl(edge.from, edge.to))
  })

  it('bows an arrow away from a ring title it would otherwise run across', () => {
    // A vertical run through the top of the application band, dead on its own title.
    const edge = { from: { x: 0, y: -240 }, to: { x: 0, y: -120 } }
    const [routed] = routeEdgesAroundLabels([edge], rings)
    expect(routed.control).not.toEqual(edgeControl(edge.from, edge.to))
  })
})
