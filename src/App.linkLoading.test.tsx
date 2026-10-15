import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM } from './model/example'
import { toHexa, toMap } from './model/hexa'
import { useMapStore } from './model/store'
import { encodeSharePayload, SHARE_HASH_PREFIX } from './ui/shareLink'
import { useNoticeStore } from './ui/state/noticeStore'
import { usePreferencesStore } from './ui/state/preferencesStore'
import { useViewStore } from './ui/state/viewStore'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
})
beforeEach(() => {
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
  useNoticeStore.setState({ notice: null })
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

describe('opening a link that selects a flow', () => {
  const [first] = toMap(EXAMPLE_DIAGRAM).hexagons
  const twin = { ...first, id: 'h-twin', cell: { q: 1, r: 0 } }
  const shared = { ...toMap(EXAMPLE_DIAGRAM), hexagons: [first, twin] }
  const open = async (options: string) => {
    history.replaceState(null, '', `/${SHARE_HASH_PREFIX}${await encodeSharePayload(shared)}${options}`)
    render(<App />)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
  }

  it('focuses the flow on the first hexagon that holds it', async () => {
    await open('&flow=uc-submit')
    expect(useMapStore.getState().focus).toBe(first.id)
    expect(useViewStore.getState().focusedFlow).toBe('uc-submit')
  })

  it('focuses the flow on the hexagon the link names', async () => {
    await open('&flow=uc-submit&hex=h-twin')
    expect(useMapStore.getState().focus).toBe('h-twin')
    expect(useViewStore.getState().focusedFlow).toBe('uc-submit')
  })

  it('honours the view option together with the flow', async () => {
    await open('&view=detailed&flow=uc-submit')
    expect(usePreferencesStore.getState()).toMatchObject({ viewOnly: true, mode: 'detailed' })
    expect(useViewStore.getState().focusedFlow).toBe('uc-submit')
  })

  it('frames the export to the flow only when the link asks for it', async () => {
    await open('&flow=uc-submit&frame=flow')
    expect(useViewStore.getState().framedFlow).toBe('uc-submit')
    cleanup()
    useViewStore.setState({ framedFlow: null })
    await open('&flow=uc-submit')
    expect(useViewStore.getState().framedFlow).toBeNull()
  })

  it('does not frame an unknown flow', async () => {
    await open('&flow=uc-nope&frame=flow')
    expect(useViewStore.getState().framedFlow).toBeNull()
  })

  it('opens the map without focus when the flow or hexagon is unknown', async () => {
    await open('&flow=uc-nope')
    expect(useViewStore.getState().focusedFlow).toBeNull()
    expect(useMapStore.getState().map).toStrictEqual(shared)
    cleanup()
    await open('&flow=uc-submit&hex=h-nope')
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })
})
