import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM } from './model/example'
import { toHexa, toMap } from './model/hexa'
import { useMapStore } from './model/store'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('opening a remote link', () => {
  it('covers the canvas with a status while the file is fetched, then lets the new map through', async () => {
    vi.useFakeTimers()
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (respond = resolve))))
    history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
    const shared = toMap({ ...EXAMPLE_DIAGRAM, title: 'Linked map' })

    render(<App />)
    expect(screen.queryByText('Opening the linked map…')).toBeNull()
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)))
    expect(screen.getByText('Opening the linked map…').closest('[role="status"]')).not.toBeNull()

    respond(new Response(toHexa(shared)))
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    expect(screen.queryByText('Opening the linked map…')).toBeNull()
    expect(useMapStore.getState().map).toStrictEqual(shared)
  })
})
