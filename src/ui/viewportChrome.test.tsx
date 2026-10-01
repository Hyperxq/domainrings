import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { useFreezeWhilePanelOpen, ZoomControls } from './viewportChrome'
import type { Viewport } from './viewport'
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
  const setup = (initialView: 'auto' | Viewport = 'auto') =>
    renderHook(
      (p: { panelOpen: boolean; visible: typeof visibleIn }) => {
        const [view, setView] = useState<'auto' | Viewport>(initialView)
        useFreezeWhilePanelOpen({ panelOpen: p.panelOpen, view, viewport: view === 'auto' ? FIT : view, setView, visible: p.visible, interest })
        return { view, setView }
      },
      { initialProps: { panelOpen: false, visible: visibleIn } },
    )

  it('freezes an auto view when the panel opens and the interest stays visible', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleIn })
    expect(result.current.view).toEqual(FIT)
    expect(result.current.view).not.toBe('auto')
  })

  it('leaves an auto view alone when the panel would cover the interest', () => {
    const { result, rerender } = setup()
    rerender({ panelOpen: true, visible: visibleOut })
    expect(result.current.view).toBe('auto')
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
