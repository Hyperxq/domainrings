import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { autosave, browserStorage, loadMap, LEGACY_KEY, MAP_KEY, UNREADABLE_KEY, V1_KEY } from './persistence'
import { readPref } from '../ui/prefs'
import { parseHexa, toHexa, toMap } from './hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, SEED_VERSION, TWO_SLICES_MAP } from './example'
import { useMapStore } from './store'
import { twoHexagonMap } from '../test/fixtures'
import type { Diagram, HexaMap } from './schema'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  }
}

/** A v1 file as an old build would have written it: `app`/`seedVersion` envelope around the diagram fields. */
const v1Text = (diagram: Diagram, opts: { app?: string; seedVersion?: number } = {}) =>
  JSON.stringify({ app: opts.app ?? 'domainrings', seedVersion: opts.seedVersion ?? SEED_VERSION, ...diagram })

describe('loadMap', () => {
  const stored: HexaMap = { ...toMap(EXAMPLE_DIAGRAM), title: 'Stored' }

  it('returns the stored own-slot map when valid, with recovery none', () => {
    expect(loadMap(memoryStorage({ [MAP_KEY]: toHexa(stored) }))).toEqual({ map: stored, recovery: 'none' })
  })

  it('falls back to the migrated example when nothing is stored anywhere', () => {
    expect(loadMap(memoryStorage())).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
  })

  it('falls back to the migrated example when no storage is available', () => {
    expect(loadMap(undefined)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
  })

  it('falls back to the migrated example when reading storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
    expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
  })

  describe('fallback chain: own slot, then v1, then legacy, then example', () => {
    it('migrates an edited v1 autosave when the own slot is empty', () => {
      const edited: Diagram = { ...RETIRED_SEEDS[1], title: 'My own slice' }
      expect(loadMap(memoryStorage({ [V1_KEY]: v1Text(edited) }))).toEqual({ map: toMap(edited), recovery: 'none' })
    })

    it('falls further back to the legacy (pre-rename) slot when own and v1 are both empty', () => {
      const edited: Diagram = { ...RETIRED_SEEDS[0], title: 'From the very old build' }
      const storage = memoryStorage({ [LEGACY_KEY]: v1Text(edited, { app: 'archviz' }) })
      expect(loadMap(storage)).toEqual({ map: toMap(edited), recovery: 'none' })
    })

    it('never reads the v1 or legacy slot when the own slot has a valid map', () => {
      const storage = memoryStorage({ [MAP_KEY]: toHexa(stored), [V1_KEY]: v1Text(EXAMPLE_DIAGRAM) })
      expect(loadMap(storage)).toEqual({ map: stored, recovery: 'none' })
      expect(storage.getItem).not.toHaveBeenCalledWith(V1_KEY)
    })

    it('prefers the v1 slot over the legacy slot', () => {
      const fromV1: Diagram = { ...RETIRED_SEEDS[2], title: 'From v1' }
      const fromLegacy: Diagram = { ...RETIRED_SEEDS[2], title: 'From legacy' }
      const storage = memoryStorage({ [V1_KEY]: v1Text(fromV1), [LEGACY_KEY]: v1Text(fromLegacy, { app: 'archviz' }) })
      expect(loadMap(storage)).toEqual({ map: toMap(fromV1), recovery: 'none' })
    })

    it('never calls setItem for any key while loading, however far it falls back', () => {
      const storage = memoryStorage({ [V1_KEY]: v1Text(EXAMPLE_DIAGRAM) })
      loadMap(storage)
      expect(storage.setItem).not.toHaveBeenCalled()
    })
  })

  describe('stale-seed replacement — v1 and legacy slots only, never the own slot', () => {
    it.each(RETIRED_SEEDS.map((seed, i) => [`v${i + 1}`, seed] as const))('replaces an untouched %s v1 seed with the current example', (_, seed) => {
      expect(loadMap(memoryStorage({ [V1_KEY]: v1Text(seed, { seedVersion: 1 }) }))).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
    })

    it('keeps an old seed the user edited', () => {
      const edited = { ...RETIRED_SEEDS[1], title: 'My own slice' }
      expect(loadMap(memoryStorage({ [V1_KEY]: v1Text(edited, { seedVersion: 1 }) }))).toEqual({ map: toMap(edited), recovery: 'none' })
    })

    it('never touches a v1 diagram saved under the current seed version', () => {
      expect(loadMap(memoryStorage({ [V1_KEY]: v1Text(RETIRED_SEEDS[1]) }))).toEqual({ map: toMap(RETIRED_SEEDS[1]), recovery: 'none' })
    })

    it('also replaces an untouched, unversioned legacy seed', () => {
      const legacyText = JSON.stringify({ app: 'archviz', ...RETIRED_SEEDS[0] })
      expect(loadMap(memoryStorage({ [LEGACY_KEY]: legacyText }))).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'none' })
    })

    it('never applies the stale-seed check to a map already saved by this version', () => {
      const seedAsMap = toMap(RETIRED_SEEDS[0])
      expect(loadMap(memoryStorage({ [MAP_KEY]: toHexa(seedAsMap) }))).toEqual({ map: seedAsMap, recovery: 'none' })
    })
  })

  describe('unreadable own slot (AUTO-03)', () => {
    it.each([
      ['not valid JSON', '{oops'],
      ['the wrong format', JSON.stringify({ hello: 'world' })],
      ['schema-invalid data', JSON.stringify({ app: 'domainrings', version: 2 })],
      ['made by a newer version', JSON.stringify({ app: 'domainrings', version: 99 })],
    ])('keeps a read-back-verified copy and shows the example when the own slot is %s', (_, text) => {
      const storage = memoryStorage({ [MAP_KEY]: text })
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'kept', unreadableText: text })
      expect(storage.getItem(UNREADABLE_KEY)).toBe(text)
    })

    it('never falls through to a valid v1 slot when the own slot is unreadable', () => {
      const storage = memoryStorage({ [MAP_KEY]: '{oops', [V1_KEY]: v1Text(EXAMPLE_DIAGRAM) })
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'kept', unreadableText: '{oops' })
    })

    it('does not write the copy again when it already matches what is kept', () => {
      const storage = memoryStorage({ [MAP_KEY]: '{oops', [UNREADABLE_KEY]: '{oops' })
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'kept', unreadableText: '{oops' })
      expect(storage.setItem).not.toHaveBeenCalled()
    })

    it('replaces an earlier kept copy with newly unreadable text — only the latest is kept', () => {
      const storage = memoryStorage({ [MAP_KEY]: '{new-oops', [UNREADABLE_KEY]: '{old-oops' })
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'kept', unreadableText: '{new-oops' })
      expect(storage.getItem(UNREADABLE_KEY)).toBe('{new-oops')
    })

    it('reports not-kept and turns autosave off when the copy cannot be written', () => {
      const storage = { getItem: (k: string) => (k === MAP_KEY ? '{oops' : null), setItem: () => { throw new Error('quota exceeded') } }
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'not-kept' })
    })

    it('reports not-kept when the write silently does not persist', () => {
      const storage = { getItem: (k: string) => (k === MAP_KEY ? '{oops' : null), setItem: () => {} }
      expect(loadMap(storage)).toEqual({ map: toMap(EXAMPLE_DIAGRAM), recovery: 'not-kept' })
    })
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

  it('never writes its own slot on boot alone, without any edit (AUTO-01.4)', () => {
    vi.useFakeTimers()
    const storage = memoryStorage({ [V1_KEY]: v1Text(EXAMPLE_DIAGRAM) })
    const boot = loadMap(storage)
    const store = createStore(() => ({ map: boot.map }))
    autosave(store, storage, boot.recovery, 300)
    vi.advanceTimersByTime(1000)
    expect(storage.getItem(MAP_KEY)).toBeNull()
  })
})

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

describe('RT-01: the shipped "Two slices, one link" example round-trips through a reload', () => {
  afterEach(() => vi.useRealTimers())

  it('after loading the example, editing the current hexagon, and autosave running, a reload restores the edit and refocuses the first hexagon', () => {
    vi.useFakeTimers()
    const edited: HexaMap = { ...TWO_SLICES_MAP, hexagons: [{ ...TWO_SLICES_MAP.hexagons[0], title: 'Renamed while editing h1' }, TWO_SLICES_MAP.hexagons[1]] }
    const store = createStore(() => ({ map: TWO_SLICES_MAP }))
    const storage = memoryStorage()
    autosave(store, storage, 'none', 400)

    store.setState({ map: edited })
    vi.advanceTimersByTime(400)

    const reloaded = loadMap(storage)
    expect(reloaded).toEqual({ map: store.getState().map, recovery: 'none' })
    expect(reloaded.map).toStrictEqual(edited)
    if (reloaded.map.kind !== 'hexagonal') throw new Error('expected a hexagonal reload')
    // A fresh boot off the reloaded map always focuses its first hexagon (FOCUS-02), regardless of what was
    // current when the edit was made — through the real replace() action, not just the map's own hexagon order.
    useMapStore.getState().replace(reloaded.map)
    expect(useMapStore.getState().focus).toBe(reloaded.map.hexagons[0].id)
  })
})

describe('legacy storage keys', () => {
  afterEach(() => localStorage.clear())

  it('moves every legacy pref key to its new name, but leaves the diagram slot as a read-only fallback', () => {
    const legacy = v1Text(EXAMPLE_DIAGRAM, { app: 'archviz' })
    localStorage.setItem('archviz:diagram', legacy)
    localStorage.setItem('archviz:theme', 'dark')
    localStorage.setItem('archviz:highlight', 'false')
    localStorage.setItem('other', 'kept')

    const storage = browserStorage()

    expect(storage?.getItem('domainrings:theme')).toBe('dark')
    expect(readPref('domainrings:highlight', true)).toBe(false)
    expect(storage?.getItem(LEGACY_KEY)).toBe(legacy)
    expect(storage?.getItem(V1_KEY)).toBeNull()
    expect(Object.keys(localStorage).sort()).toEqual(['archviz:diagram', 'domainrings:highlight', 'domainrings:theme', 'other'])
  })

  it('keeps a value already stored under the new name and drops the legacy one', () => {
    localStorage.setItem('archviz:theme', 'dark')
    localStorage.setItem('domainrings:theme', 'light')

    browserStorage()

    expect(localStorage.getItem('domainrings:theme')).toBe('light')
    expect(localStorage.getItem('archviz:theme')).toBeNull()
  })
})
