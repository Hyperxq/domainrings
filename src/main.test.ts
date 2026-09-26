import { describe, expect, it, vi } from 'vitest'

// `App` is stubbed out here — this file tests main.tsx's own wiring (autosave subscriptions), not App's render
// tree, so a real mount would only add jsdom polyfill noise (ResizeObserver, matchMedia, …) unrelated to this test.
describe('main: autosave wiring', () => {
  it('wires autosave for every document store — Hexagonal, Onion, and Clean alike', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    vi.resetModules()
    const autosaveSpy = vi.fn((_store: unknown, _storage: unknown, _recovery: unknown) => () => {})
    vi.doMock('./App', () => ({ App: () => null }))
    vi.doMock('./model/persistence', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./model/persistence')>()
      return { ...actual, autosave: autosaveSpy }
    })

    await import('./main')
    const { useMapStore } = await import('./model/store')
    const { useOnionStore } = await import('./model/onionStore')
    const { useCleanStore } = await import('./model/cleanStore')

    const wired = autosaveSpy.mock.calls.map((call) => call[0])
    expect(wired).toContain(useMapStore)
    expect(wired).toContain(useOnionStore)
    expect(wired).toContain(useCleanStore)
    expect(wired).toHaveLength(3)

    vi.doUnmock('./App')
    vi.doUnmock('./model/persistence')
  })
})
