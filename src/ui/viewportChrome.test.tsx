import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ZoomControls } from './viewportChrome'
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

  it('shows neither when the map has nothing to expand', () => {
    renderControls()
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull()
  })
})
