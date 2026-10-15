import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import type { StoredFile } from '../model/fileFormat'
import { decodeSharePayload, SHARE_HASH_PREFIX } from './shareLink'
import { useNoticeStore } from './state/noticeStore'
import { usePreferencesStore } from './state/preferencesStore'
import { useShareLink } from './useShareLink'

vi.mock('./shareLink', async (importOriginal) => ({ ...(await importOriginal<typeof import('./shareLink')>()), decodeSharePayload: vi.fn() }))

const file = toMap(EXAMPLE_DIAGRAM) as StoredFile
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const setHash = (hash: string) => history.replaceState(null, '', `/${hash}`)
const fireHashChange = () => act(() => void window.dispatchEvent(new HashChangeEvent('hashchange')))

const parseSource = vi.fn<(text: string, label: string) => Promise<StoredFile | undefined>>()
const swap = vi.fn()
const mount = () => renderHook((actions: Parameters<typeof useShareLink>[0]) => useShareLink(actions), { initialProps: { parseSource, swap } })

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(decodeSharePayload).mockReset().mockResolvedValue('{}')
  parseSource.mockReset().mockResolvedValue(file)
  swap.mockReset()
  useNoticeStore.setState({ notice: null })
  usePreferencesStore.setState({ viewOnly: false, mode: 'detailed' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('opening a link on mount', () => {
  it('opens an embedded link for reading and cleans the address', async () => {
    setHash(`${SHARE_HASH_PREFIX}abc&view=overview`)
    mount()
    await settle()
    expect(decodeSharePayload).toHaveBeenCalledWith('abc')
    expect(swap).toHaveBeenCalledWith(file, 'Opened from a link.')
    expect(usePreferencesStore.getState()).toMatchObject({ viewOnly: true, mode: 'overview' })
    expect(location.hash).toBe('')
  })

  it('does nothing without a link', async () => {
    const { result } = mount()
    await wait(500)
    expect(swap).not.toHaveBeenCalled()
    expect(result.current.opening).toBe(false)
  })
})

describe('the opening indicator', () => {
  it('shows only once a slow decode has outlasted the delay, and clears the moment the map opens', async () => {
    const decode = deferred<string>()
    vi.mocked(decodeSharePayload).mockReturnValue(decode.promise)
    setHash(`${SHARE_HASH_PREFIX}abc`)
    const { result } = mount()
    await wait(149)
    expect(result.current.opening).toBe(false)
    await wait(1)
    expect(result.current.opening).toBe(true)
    decode.resolve('{}')
    await settle()
    expect(swap).toHaveBeenCalledOnce()
    expect(result.current.opening).toBe(false)
  })

  it('never shows for a link that opens instantly', async () => {
    setHash(`${SHARE_HASH_PREFIX}abc`)
    const { result } = mount()
    await wait(1000)
    expect(swap).toHaveBeenCalledOnce()
    expect(result.current.opening).toBe(false)
  })

  it('shows while a remote file is being fetched', async () => {
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => response.promise))
    history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
    const { result } = mount()
    await wait(150)
    expect(result.current.opening).toBe(true)
    response.resolve(new Response('{}'))
    await settle()
    expect(swap).toHaveBeenCalledOnce()
    expect(result.current.opening).toBe(false)
  })

  const slowFailures: [string, () => () => void][] = [
    [
      'an undecodable payload',
      () => {
        const decode = deferred<string | undefined>()
        vi.mocked(decodeSharePayload).mockReturnValue(decode.promise)
        setHash(`${SHARE_HASH_PREFIX}abc`)
        return () => decode.resolve(undefined)
      },
    ],
    [
      'a link the parser refuses',
      () => {
        const parsed = deferred<StoredFile | undefined>()
        parseSource.mockReturnValue(parsed.promise)
        setHash(`${SHARE_HASH_PREFIX}abc`)
        return () => parsed.resolve(undefined)
      },
    ],
    [
      'an unreachable file',
      () => {
        const response = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn(() => response.promise))
        history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
        return () => response.reject(new Error('offline'))
      },
    ],
    [
      'a file the server refuses',
      () => {
        const response = deferred<Response>()
        vi.stubGlobal('fetch', vi.fn(() => response.promise))
        history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
        return () => response.resolve(new Response('nope', { status: 404 }))
      },
    ],
  ]
  it.each(slowFailures)('clears for %s', async (_name, arrange) => {
    const fail = arrange()
    const { result } = mount()
    await wait(150)
    expect(result.current.opening).toBe(true)
    fail()
    await settle()
    expect(swap).not.toHaveBeenCalled()
    expect(result.current.opening).toBe(false)
  })
})

describe('a share link pasted into an open tab', () => {
  it('opens the map when the address changes to a share link', async () => {
    const { result } = mount()
    await settle()
    setHash(`${SHARE_HASH_PREFIX}abc&view=detailed`)
    fireHashChange()
    await settle()
    expect(decodeSharePayload).toHaveBeenCalledWith('abc')
    expect(swap).toHaveBeenCalledWith(file, 'Opened from a link.')
    expect(usePreferencesStore.getState().mode).toBe('detailed')
    expect(location.hash).toBe('')
    expect(result.current.opening).toBe(false)
  })

  it('shows the indicator for a slow decode, as on load', async () => {
    const decode = deferred<string>()
    vi.mocked(decodeSharePayload).mockReturnValue(decode.promise)
    const { result } = mount()
    setHash(`${SHARE_HASH_PREFIX}abc`)
    fireHashChange()
    await wait(150)
    expect(result.current.opening).toBe(true)
    decode.resolve('{}')
    await settle()
    expect(result.current.opening).toBe(false)
  })

  it('ignores an address change that is not a share link', async () => {
    mount()
    setHash('#section')
    fireHashChange()
    await settle()
    expect(decodeSharePayload).not.toHaveBeenCalled()
    expect(swap).not.toHaveBeenCalled()
    expect(location.hash).toBe('#section')
  })

  it('opens it with the latest actions, since the undo snapshot they carry changes on every render', async () => {
    const latestSwap = vi.fn()
    const { rerender } = mount()
    rerender({ parseSource, swap: latestSwap })
    setHash(`${SHARE_HASH_PREFIX}abc`)
    fireHashChange()
    await settle()
    expect(latestSwap).toHaveBeenCalledOnce()
    expect(swap).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', async () => {
    const { unmount } = mount()
    unmount()
    setHash(`${SHARE_HASH_PREFIX}abc`)
    fireHashChange()
    await settle()
    expect(swap).not.toHaveBeenCalled()
  })

  it('opens a link once when its address change is reported while the load that started on it is still running', async () => {
    const decode = deferred<string>()
    vi.mocked(decodeSharePayload).mockReturnValue(decode.promise)
    setHash(`${SHARE_HASH_PREFIX}abc`)
    mount()
    fireHashChange()
    decode.resolve('{}')
    await settle()
    expect(swap).toHaveBeenCalledOnce()
  })

  it('does not treat cleaning its own address as a new link', async () => {
    const hashChanged = vi.fn()
    window.addEventListener('hashchange', hashChanged)
    setHash(`${SHARE_HASH_PREFIX}abc`)
    mount()
    await settle()
    await wait(100)
    window.removeEventListener('hashchange', hashChanged)
    expect(hashChanged).not.toHaveBeenCalled()
    expect(swap).toHaveBeenCalledOnce()
  })
})
