import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useFreezeWhilePanelOpen, useViewportInteractions, ZoomControls } from './viewportChrome'
import { zoomAt, type Viewport } from './viewport'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'
import { useMapStore } from '../model/store'
import { manyHexagonMap } from '../test/fixtures'

afterEach(cleanup)

const renderControls = (canExpandAll = false) => render(<ZoomControls canExpandAll={canExpandAll} viewport={{ x: 0, y: 0, scale: 1 }} zoomFloor={0.1} centre={{ x: 0, y: 0 }} setView={() => {}} fullscreen={false} setFullscreen={() => {}} />)

describe('ZoomControls view-only toggle', () => {
  it('sits in the zoom group, off by default, and flips the preference on press', () => {
    renderControls()
    const toggle = screen.getByRole('button', { name: 'View only' })
    expect(toggle.closest('[aria-label="Zoom"]')).not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(usePreferencesStore.getState().viewOnly).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(usePreferencesStore.getState().viewOnly).toBe(false)
  })

  it('reflects a stored preference', () => {
    usePreferencesStore.setState({ viewOnly: true })
    renderControls()
    expect(screen.getByRole('button', { name: 'View only' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ZoomControls expand and collapse all', () => {
  it('sits in the zoom group as icon buttons with names and tooltips, each setting its own direction', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    renderControls(true)
    const expand = screen.getByRole('button', { name: 'Expand all' })
    const collapse = screen.getByRole('button', { name: 'Collapse all' })
    for (const button of [expand, collapse]) {
      expect(button.closest('[aria-label="Zoom"]')).not.toBeNull()
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button.textContent).toBe('')
    }
    expect(expand.getAttribute('title')).toBe('Show every hexagon in full')
    expect(collapse.getAttribute('title')).toBe('Show only the current hexagon in full')
    fireEvent.click(expand)
    expect([...useViewStore.getState().expanded]).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    fireEvent.click(collapse)
    expect(useViewStore.getState().expanded.size).toBe(0)
  })

  it('sits next to fit and the view-only eye', () => {
    renderControls(true)
    const names = [...screen.getByRole('group', { name: 'Zoom' }).querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    const at = names.indexOf('Expand all')
    expect(names.slice(at - 1, at + 3)).toEqual(['Fit diagram to screen', 'Expand all', 'Collapse all', 'View only'])
  })

  it('stands apart from the view controls: a divider on each side and an icon no other zoom button uses', () => {
    renderControls(true)
    const expand = screen.getByRole('button', { name: 'Expand all' })
    const collapse = screen.getByRole('button', { name: 'Collapse all' })
    expect(expand.previousElementSibling?.className).toBe('divider')
    expect(collapse.nextElementSibling?.className).toBe('divider')
    const iconOf = (b: Element) => b.querySelector('svg')?.innerHTML
    const others = [...screen.getByRole('group', { name: 'Zoom' }).querySelectorAll('button')].filter((b) => b !== expand && b !== collapse).map(iconOf)
    expect(others).not.toContain(iconOf(expand))
    expect(others).not.toContain(iconOf(collapse))
  })

  it('shows neither when the map has nothing to expand', () => {
    renderControls()
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull()
  })
})

describe('useFreezeWhilePanelOpen', () => {
  const FIT: Viewport = { x: 0, y: 0, scale: 1 }
  const interest = { x: 10, y: 10, width: 50, height: 50 }
  const visibleIn = { x: 0, y: 0, width: 100, height: 100 }
  const visibleOut = { x: 0, y: 0, width: 30, height: 30 }
  const SMALL = { width: 800, height: 600 }
  const BIG = { width: 1400, height: 600 }
  type Props = { panelOpen: boolean; visible: typeof visibleIn; size?: typeof SMALL }
  const setup = (initialView: 'auto' | Viewport = 'auto') =>
    renderHook(
      (p: Props) => {
        const [view, setView] = useState<'auto' | Viewport>(initialView)
        useFreezeWhilePanelOpen({ panelOpen: p.panelOpen, view, viewport: view === 'auto' ? FIT : view, setView, visible: p.visible, interest, size: p.size ?? SMALL })
        return { view, setView }
      },
      { initialProps: { panelOpen: false, visible: visibleIn } as Props },
    )

  it('freezes an auto view when the panel opens and the interest stays visible', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    expect(result.current.view).toEqual(FIT)
    expect(result.current.view).not.toBe('auto')
  })

  it('pans the least that brings the interest into the area the panel leaves, keeping the zoom', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: { x: 30, y: 0, width: 100, height: 100 } })
    expect(result.current.view).toEqual({ x: -20, y: 0, scale: 1 })
    rerender({ panelOpen: false, visible: visibleIn })
    expect(result.current.view).toBe('auto')
  })

  it('leaves an auto view alone when the interest cannot fit the area the panel leaves at this zoom', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleOut })
    expect(result.current.view).toBe('auto')
  })

  it('goes back to auto when the stage is resized while the view is frozen', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    expect(result.current.view).not.toBe('auto')
    rerender({ panelOpen: true, visible: visibleIn, size: BIG })
    expect(result.current.view).toBe('auto')
  })

  it('keeps a view the author changed while the panel was open when the stage is resized', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    const manual = { ...FIT, scale: 2 }
    act(() => result.current.setView(manual))
    rerender({ panelOpen: true, visible: visibleIn, size: BIG })
    expect(result.current.view).toBe(manual)
  })

  it('returns to auto on close when the freeze is still in place', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    rerender({ panelOpen: false, visible: visibleIn })
    expect(result.current.view).toBe('auto')
  })

  it('keeps a view the author changed while the panel was open', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    const manual = { ...FIT, scale: 2 }
    act(() => result.current.setView(manual))
    rerender({ panelOpen: false, visible: visibleIn })
    expect(result.current.view).toBe(manual)
  })

  it('never touches a view that was manual before the panel opened', () => {
    const manual = { ...FIT, scale: 2 }
    const { result, rerender } = setup(manual)
    rerender({ panelOpen: true, visible: visibleIn })
    rerender({ panelOpen: false, visible: visibleIn })
    expect(result.current.view).toBe(manual)
  })
})

describe('useViewportInteractions resize', () => {
  const AUTO: Viewport = { x: 0, y: 0, scale: 1 }
  const setup = () =>
    renderHook((p: { size: { width: number; height: number } }) => useViewportInteractions({ mainRef: { current: null }, autoFit: AUTO, wholeFitScale: 0.1, fitKey: 'k', size: p.size }), {
      initialProps: { size: { width: 800, height: 600 } },
    })

  it('keeps the content under the centre of a manual view when the stage resizes', () => {
    const { result, rerender } = setup()
    act(() => result.current.setView({ x: 10, y: 20, scale: 2 }))
    rerender({ size: { width: 1000, height: 700 } })
    expect(result.current.view).toEqual({ x: -40, y: -5, scale: 2 })
  })

  it('leaves an auto view to follow its fit', () => {
    const { result, rerender } = setup()
    rerender({ size: { width: 1000, height: 700 } })
    expect(result.current.view).toBe('auto')
  })

  it('does not shift a manual view for the first measurement', () => {
    const { result, rerender } = renderHook((p: { size: { width: number; height: number } }) => useViewportInteractions({ mainRef: { current: null }, autoFit: AUTO, wholeFitScale: 0.1, fitKey: 'k', size: p.size }), {
      initialProps: { size: { width: 0, height: 0 } },
    })
    act(() => result.current.setView({ x: 10, y: 20, scale: 2 }))
    rerender({ size: { width: 1000, height: 700 } })
    expect(result.current.view).toEqual({ x: 10, y: 20, scale: 2 })
  })
})

describe('useViewportInteractions wheel', () => {
  const AUTO: Viewport = { x: 0, y: 0, scale: 1 }
  let frames: FrameRequestCallback[]
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())
  const nextFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)))

  function Probe({ onRender }: { onRender: () => void }) {
    const mainRef = useRef<HTMLElement>(null)
    const { viewport } = useViewportInteractions({ mainRef, autoFit: AUTO, wholeFitScale: 0.1, fitKey: 'k' })
    onRender()
    return <main ref={mainRef} data-testid="stage" data-viewport={JSON.stringify(viewport)} />
  }
  const shown = () => JSON.parse(screen.getByTestId('stage').dataset.viewport!) as Viewport

  it('folds a burst of wheel events into one view update per frame, each zooming from the previous one', () => {
    let renders = 0
    render(<Probe onRender={() => renders++} />)
    const stage = screen.getByTestId('stage')
    const before = renders
    const cursor = { clientX: 40, clientY: 30 }
    for (const deltaY of [-100, -100, -100]) fireEvent.wheel(stage, { deltaY, ...cursor })
    expect(renders).toBe(before)
    nextFrame()
    expect(renders - before).toBeLessThanOrEqual(2) // the commit, plus the auto-to-manual settle; never one per event
    let expected = AUTO
    for (let i = 0; i < 3; i++) expected = zoomAt(expected, Math.exp(100 * 0.0015), { x: 40, y: 30 }, 0.1)
    const actual = shown()
    expect(actual.scale).toBeCloseTo(expected.scale, 9)
    expect(actual.x).toBeCloseTo(expected.x, 9)
    expect(actual.y).toBeCloseTo(expected.y, 9)
  })

  it('keeps composing from the pending view when a wheel event lands before the previous frame has rendered', () => {
    render(<Probe onRender={() => {}} />)
    const stage = screen.getByTestId('stage')
    fireEvent.wheel(stage, { deltaY: -100 })
    nextFrame()
    fireEvent.wheel(stage, { deltaY: -100 })
    nextFrame()
    expect(shown().scale).toBeCloseTo(Math.exp(200 * 0.0015), 9)
  })
})
