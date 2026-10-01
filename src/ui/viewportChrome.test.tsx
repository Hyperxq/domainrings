import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ZoomControls } from './viewportChrome'
import { usePreferencesStore } from './state/preferencesStore'

afterEach(cleanup)

const renderControls = () => render(<ZoomControls viewport={{ x: 0, y: 0, scale: 1 }} zoomFloor={0.1} centre={{ x: 0, y: 0 }} setView={() => {}} fullscreen={false} setFullscreen={() => {}} />)

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
