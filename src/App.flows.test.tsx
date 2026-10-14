import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'
import { layoutMap } from './layout/map'
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
  useViewStore.setState({ editorOpen: true, focusedFlow: null, presentStep: null })
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

describe('presenting a flow', () => {
  const marked = (container: HTMLElement) => [...container.querySelectorAll('[data-selected]')].map((n) => n.getAttribute('data-ref'))
  const viewBox = (container: HTMLElement) => canvas(container).getAttribute('viewBox')!.split(' ').map(Number)
  const start = (step = 0) =>
    act(() => {
      useViewStore.getState().focusFlow('uc-place')
      useViewStore.getState().present(step)
    })
  beforeEach(() => usePreferencesStore.setState({ viewOnly: true, highlight: false }))

  it('swaps the Flows list for the walkthrough, and the Present button starts it', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(screen.getByRole('button', { name: '← All flows' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Flows' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Present' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '← All flows' }))
    expect(screen.getByRole('heading', { name: 'Flows' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Present' })).toBeTruthy()
  })

  it('keeps the whole flow emphasised and marks the current step, with a card for it', () => {
    const { container } = render(<App />)
    start()
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    expect(marked(container)).toEqual(['act-web'])
    expect(screen.getByText('STEP 1 · ACTOR')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(marked(container)).toEqual(['a-rest'])
    expect(screen.getByText('STEP 2 · ADAPTER')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(marked(container)).toEqual(['p-orders-api'])
  })

  it('marks nothing on the canvas for a step that lives in another hexagon, but still shows its card', () => {
    const { container } = render(<App />)
    start(6)
    expect(marked(container)).toEqual([])
    expect(screen.getByText('STEP 7 · LINKED PORT')).toBeTruthy()
  })

  it('stops presenting when the author switches to Edit', () => {
    const { container } = render(<App />)
    start()
    act(() => usePreferencesStore.setState({ viewOnly: false }))
    expect(screen.queryByText('STEP 1 · ACTOR')).toBeNull()
    expect(marked(container)).toEqual([])
  })

  describe('on a zoomed canvas', () => {
    let restore: () => void
    beforeEach(() => {
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        cb: ResizeObserverCallback
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb
        }
        observe() {
          this.cb([{ contentRect: { width: 1000, height: 700 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      restore = () => void (globalThis.ResizeObserver = original)
    })
    afterEach(() => restore())

    it('pans each step into view', () => {
      const { container } = render(<App />)
      for (let i = 0; i < 9; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      const map = useMapStore.getState().map
      const hex = layoutMap(map, { mode: 'detailed', current: 'h1', expanded: new Set() }).hexagons.find((h) => h.id === 'h1')!
      const box = (ref: string) => {
        const n = hex.model.nodes.find((node) => node.ref === ref)!
        return { x: n.x - n.width / 2 + hex.centre.x, y: n.y - n.height / 2 + hex.centre.y, width: n.width, height: n.height }
      }
      const shows = (b: ReturnType<typeof box>) => {
        const [x, y, w, h] = viewBox(container)
        return b.x >= x && b.y >= y && b.x + b.width <= x + w && b.y + b.height <= y + h
      }
      expect(shows(box('act-web')) && shows(box('ext-orders-db'))).toBe(false)
      start(0)
      expect(shows(box('act-web'))).toBe(true)
      act(() => useViewStore.getState().present(15))
      expect(shows(box('ext-orders-db'))).toBe(true)
    })
  })
})
