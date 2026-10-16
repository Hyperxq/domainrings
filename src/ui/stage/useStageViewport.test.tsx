import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { hexagonBounds } from '../../layout/lattice'
import { currentHexagon, layoutMap } from '../../layout/map'
import { manyHexagonMap } from '../../test/fixtures'
import { contains, islandInset, visibleRect } from '../viewport'
import { useStageViewport } from './useStageViewport'

const setup = (panelOpen: boolean) => {
  const model = layoutMap(manyHexagonMap(4), { current: 'h1' })
  const hex = currentHexagon(model, 'h1')
  const hook = renderHook(() => useStageViewport({ model, hex, mainRef: { current: null }, revision: 0, panelOpen, inspectorOpen: false, onPanStart: () => {} }))
  return { model, hex, hook }
}

describe('useStageViewport flyToBox', () => {
  it('brings the box into the area the open panel leaves free', () => {
    const { model, hex, hook } = setup(true)
    const box = hexagonBounds(hex)
    act(() => hook.result.current.flyToBox(box))
    const size = { width: model.bounds.width, height: model.bounds.height }
    const free = visibleRect(hook.result.current.viewport, size, islandInset(size, true, false))
    // A fit touches the free area's edge; floating point may overshoot it by a hair.
    const tolerance = 1e-6
    expect(contains({ x: free.x - tolerance, y: free.y - tolerance, width: free.width + 2 * tolerance, height: free.height + 2 * tolerance }, box)).toBe(true)
  })

  it('zooms in on a box smaller than the whole map', () => {
    const { hex, hook } = setup(false)
    const whole = hook.result.current.viewport.scale
    act(() => hook.result.current.flyToBox(hexagonBounds(hex)))
    expect(hook.result.current.viewport.scale).toBeGreaterThan(whole)
  })
})
