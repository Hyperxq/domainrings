import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { autosave, browserStorage, loadDiagram, STORAGE_KEY } from './persistence'
import { readPref } from '../ui/prefs'
import { toHexa } from './hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, SEED_VERSION, STRESS_DIAGRAM } from './example'
import type { Diagram } from './schema'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  }
}

describe('loadDiagram', () => {
  const stored: Diagram = { ...EXAMPLE_DIAGRAM, title: 'Stored' }

  it('returns the stored diagram when valid', () => {
    expect(loadDiagram(memoryStorage({ [STORAGE_KEY]: toHexa(stored) }))).toEqual(stored)
  })

  it.each([
    ['nothing stored', memoryStorage()],
    ['corrupt JSON', memoryStorage({ [STORAGE_KEY]: '{oops' })],
    ['schema-invalid data', memoryStorage({ [STORAGE_KEY]: JSON.stringify({ app: 'domainrings', version: 9 }) })],
    ['no storage available', undefined],
  ])('falls back to the example with %s', (_, storage) => {
    expect(loadDiagram(storage)).toEqual(EXAMPLE_DIAGRAM)
  })

  it('falls back when reading storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked') } }
    expect(loadDiagram(storage)).toEqual(EXAMPLE_DIAGRAM)
  })
})

describe('seed upgrades', () => {
  const stored = (d: Diagram, seedVersion?: number) =>
    memoryStorage({ [STORAGE_KEY]: seedVersion === undefined ? toHexa(d) : JSON.stringify({ ...JSON.parse(toHexa(d)), seedVersion }) })

  it.each(RETIRED_SEEDS.map((seed, i) => [`v${i + 1}`, seed] as const))('replaces an untouched %s seed with the current one', (_, seed) => {
    expect(loadDiagram(stored(seed))).toEqual(EXAMPLE_DIAGRAM)
  })

  it('recognises the pre-tree seed: Feedback a plain entity, no parents', () => {
    const preTree = {
      ...EXAMPLE_DIAGRAM,
      domain: EXAMPLE_DIAGRAM.domain.map(({ parentId: _p, ...item }) => (item.id === 'd-feedback' ? { ...item, type: 'entity' as const } : item)),
    }
    expect(loadDiagram(stored(preTree))).toEqual(EXAMPLE_DIAGRAM)
  })

  it('recognises the v3 seed, where Feedback was a plain entity', () => {
    const v3 = { ...EXAMPLE_DIAGRAM, domain: EXAMPLE_DIAGRAM.domain.map((i) => (i.id === 'd-feedback' ? { ...i, type: 'entity' as const } : i)) }
    expect(loadDiagram(stored(v3))).toEqual(EXAMPLE_DIAGRAM)
  })

  it('keeps an old seed the user edited', () => {
    const edited = { ...RETIRED_SEEDS[1], title: 'My own slice' }
    expect(loadDiagram(stored(edited))).toEqual(edited)
  })

  it('never touches a diagram saved under the current seed version', () => {
    expect(loadDiagram(stored(RETIRED_SEEDS[1], SEED_VERSION))).toEqual(RETIRED_SEEDS[1])
    expect(loadDiagram(stored(STRESS_DIAGRAM, SEED_VERSION))).toEqual(STRESS_DIAGRAM)
  })
})

describe('autosave', () => {
  afterEach(() => vi.useRealTimers())

  it('writes once, after the debounce, with the latest diagram', () => {
    vi.useFakeTimers()
    const store = createStore(() => ({ diagram: EXAMPLE_DIAGRAM }))
    const storage = memoryStorage()
    autosave(store, storage, 300)

    store.setState({ diagram: { ...EXAMPLE_DIAGRAM, title: 'A' } })
    vi.advanceTimersByTime(200)
    store.setState({ diagram: { ...EXAMPLE_DIAGRAM, title: 'B' } })
    vi.advanceTimersByTime(299)
    expect(storage.setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(loadDiagram(storage).title).toBe('B')
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toMatchObject({ app: 'domainrings', seedVersion: SEED_VERSION })
  })

  it('ignores state changes that do not touch the diagram', () => {
    vi.useFakeTimers()
    const store = createStore(() => ({ diagram: EXAMPLE_DIAGRAM, revision: 0 }))
    const storage = memoryStorage()
    autosave(store, storage, 300)
    store.setState({ revision: 1 })
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe('legacy storage keys', () => {
  afterEach(() => localStorage.clear())

  it('moves every legacy key to its new name on first access', () => {
    const legacy = toHexa({ ...EXAMPLE_DIAGRAM, title: 'Legacy' }).replace('"domainrings"', '"archviz"')
    localStorage.setItem('archviz:diagram', legacy)
    localStorage.setItem('archviz:theme', 'dark')
    localStorage.setItem('archviz:highlight', 'false')
    localStorage.setItem('other', 'kept')

    const storage = browserStorage()

    expect(storage?.getItem('domainrings:theme')).toBe('dark')
    expect(readPref('domainrings:highlight', true)).toBe(false)
    expect(loadDiagram(storage).title).toBe('Legacy')
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
