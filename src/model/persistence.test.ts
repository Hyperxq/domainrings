import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { autosave, browserStorage, loadMap, MAP_KEY, V1_KEY } from './persistence'
import { readPref } from '../ui/prefs'
import { parseHexa, toHexa, toMap } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'
import type { HexaMap } from './schema'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  }
}

describe('loadMap', () => {
  const stored: HexaMap = { ...toMap(EXAMPLE_DIAGRAM), title: 'Stored' }

  it('returns the stored map when valid, with recovery none', () => {
    expect(loadMap(memoryStorage({ [MAP_KEY]: toHexa(stored) }))).toEqual({ map: stored, recovery: 'none' })
  })

  it.each([
    ['nothing stored', memoryStorage()],
    ['corrupt JSON', memoryStorage({ [MAP_KEY]: '{oops' })],
    ['schema-invalid data', memoryStorage({ [MAP_KEY]: JSON.stringify({ app: 'domainrings', version: 2 }) })],
    ['no storage available', undefined],
  ])('falls back to the migrated example with %s', (_, storage) => {
    expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
  })

  it('falls back when reading storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') } }
    expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
  })
})

describe('autosave', () => {
  afterEach(() => vi.useRealTimers())

  it('writes once, after the debounce, only to the map key, with the latest map', () => {
    vi.useFakeTimers()
    const map = toMap(EXAMPLE_DIAGRAM)
    const store = createStore(() => ({ map }))
    const storage = memoryStorage()
    autosave(store, storage, 'none', 300)

    store.setState({ map: { ...map, title: 'A' } })
    vi.advanceTimersByTime(200)
    store.setState({ map: { ...map, title: 'B' } })
    vi.advanceTimersByTime(299)
    expect(storage.setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(MAP_KEY, expect.any(String))
    expect(loadMap(storage).map.title).toBe('B')
  })

  it('ignores state changes that do not touch the map', () => {
    vi.useFakeTimers()
    const store = createStore(() => ({ map: toMap(EXAMPLE_DIAGRAM), revision: 0 }))
    const storage = memoryStorage()
    autosave(store, storage, 'none', 300)
    store.setState({ revision: 1 })
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('never writes when recovery is not-kept', () => {
    vi.useFakeTimers()
    const map = toMap(EXAMPLE_DIAGRAM)
    const store = createStore(() => ({ map }))
    const storage = memoryStorage()
    autosave(store, storage, 'not-kept', 300)
    store.setState({ map: { ...map, title: 'A' } })
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

/** One context, cells {0,0}/{1,0}: h1's driven port links to h2's driving port. */
function twoHexagonMap(): HexaMap {
  return {
    version: 2,
    kind: 'hexagonal',
    title: 'Two slices, one link',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Slice A', domain: [], useCases: [], ports: [{ id: 'p-out', name: 'out', side: 'driven' }], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'Slice B', domain: [], useCases: [], ports: [{ id: 'p-in', name: 'in', side: 'driving' }], adapters: [], actors: [], externals: [] },
    ],
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }],
  }
}

describe('a two-hexagon map round-trips through autosave and reload', () => {
  afterEach(() => vi.useRealTimers())

  it('parses, autosaves to domainrings:map only, and reloads deep-equal — domainrings:diagram is never written', () => {
    vi.useFakeTimers()
    const map = twoHexagonMap()
    const parsed = parseHexa(toHexa(map))
    expect(parsed).toEqual({ ok: true, map })

    const store = createStore(() => ({ map: parsed.ok ? parsed.map : map }))
    const storage = memoryStorage()
    autosave(store, storage, 'none', 300)
    store.setState({ map: { ...map, title: 'Renamed' } })
    vi.advanceTimersByTime(300)

    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(MAP_KEY, expect.any(String))
    expect(storage.setItem.mock.calls.some(([key]) => key === V1_KEY)).toBe(false)

    const reloaded = loadMap(storage)
    expect(reloaded).toEqual({ map: { ...map, title: 'Renamed' }, recovery: 'none' })
  })
})

describe('legacy storage keys', () => {
  afterEach(() => localStorage.clear())

  it('moves every legacy key to its new name on first access', () => {
    const legacy = toHexa(toMap({ ...EXAMPLE_DIAGRAM, title: 'Legacy' })).replace('"domainrings"', '"archviz"')
    localStorage.setItem('archviz:diagram', legacy)
    localStorage.setItem('archviz:theme', 'dark')
    localStorage.setItem('archviz:highlight', 'false')
    localStorage.setItem('other', 'kept')

    const storage = browserStorage()

    expect(storage?.getItem('domainrings:theme')).toBe('dark')
    expect(readPref('domainrings:highlight', true)).toBe(false)
    expect(Object.keys(localStorage).sort()).toEqual(['domainrings:diagram', 'domainrings:highlight', 'domainrings:theme', 'other'])
  })

  it('keeps a value already stored under the new name and drops the legacy one', () => {
    localStorage.setItem('archviz:theme', 'dark')
    localStorage.setItem('domainrings:theme', 'light')

    browserStorage()

    expect(localStorage.getItem('domainrings:theme')).toBe('light')
    expect(localStorage.getItem('archviz:theme')).toBeNull()
  })
})
