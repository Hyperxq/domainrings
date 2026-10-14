import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLES } from './model/example'
import type { HexaMap } from './model/schema'
import { useMapStore } from './model/store'
import { usePreferencesStore } from './ui/state/preferencesStore'
import { useViewStore } from './ui/state/viewStore'
import { installDialogPolyfill } from './test/fixtures'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  installDialogPolyfill()
})
beforeEach(() => {
  useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap)
  useViewStore.setState({ editorOpen: true, focusedFlow: null })
})
afterEach(cleanup)

const canvas = (container: HTMLElement) => container.querySelector('svg.canvas')!

describe('flows in View mode', () => {
  it('shows the Flows panel instead of the editor in View mode, and the editor in Edit mode', () => {
    usePreferencesStore.setState({ viewOnly: true })
    render(<App />)
    expect(screen.getByRole('complementary', { name: 'Flows' })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Diagram editor' })).toBeNull()
    act(() => usePreferencesStore.setState({ viewOnly: false }))
    expect(screen.queryByRole('complementary', { name: 'Flows' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Diagram editor' })).toBeTruthy()
  })

  it('dims everything outside the focused flow through the dependency-chain emphasis', () => {
    usePreferencesStore.setState({ viewOnly: true, highlight: false })
    const { container } = render(<App />)
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
    act(() => useViewStore.getState().focusFlow('uc-place'))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    const chained = (hex: string) => [...new Set([...container.querySelectorAll(`[data-hex="${hex}"] [data-chain][data-ref]`)].map((n) => n.getAttribute('data-ref')))]
    expect(chained('h1')).toContain('uc-place')
    expect(chained('h1')).not.toContain('d-order')
    expect(container.querySelector('.map-link[data-chain]')).not.toBeNull()
    act(() => useViewStore.getState().focusFlow(null))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('stops dimming the canvas once the author switches to Edit', () => {
    usePreferencesStore.setState({ viewOnly: true, highlight: false })
    const { container } = render(<App />)
    act(() => useViewStore.getState().focusFlow('uc-place'))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    act(() => usePreferencesStore.setState({ viewOnly: false }))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })
})
