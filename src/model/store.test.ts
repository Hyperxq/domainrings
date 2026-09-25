import { beforeEach, describe, expect, it } from 'vitest'
import { useMapStore } from './store'
import { parseHexa, toHexa, toMap } from './hexa'
import { diagramOf, freeCell, freeSides, neighbour, SIDE_ORDER, UNTITLED_HEXAGON } from './map'
import { MapSchema, type HexaMap, type Link } from './schema'
import { EXAMPLE_DIAGRAM } from './example'
import { linkedTwoHexMap, twoHexMap } from '../test/fixtures'

const state = () => useMapStore.getState()
const currentDiagram = () => diagramOf(state().map, state().focus)

describe('map store', () => {
  beforeEach(() => state().replace(toMap(EXAMPLE_DIAGRAM)))

  it('replace bumps the revision and focuses the first hexagon', () => {
    const before = state().revision
    state().replace(toMap({ ...EXAMPLE_DIAGRAM, title: 'Other' }))
    expect(state().revision).toBe(before + 1)
    expect(state().focus).toBe(state().map.hexagons[0].id)
    expect(currentDiagram().title).toBe('Other')
  })

  it('adds an item to the current hexagon with a fresh id and defaults, returning the id', () => {
    const id = state().addItem(state().focus, 'ports', { side: 'driven' })
    const port = currentDiagram().ports.at(-1)
    expect(port).toMatchObject({ id, side: 'driven' })
    expect(EXAMPLE_DIAGRAM.ports.some((p) => p.id === id)).toBe(false)
  })

  it('updates only the targeted item', () => {
    state().updateItem(state().focus, 'adapters', 'a-knex', { name: 'PgFeedbackRepository' })
    expect(currentDiagram().adapters.map((a) => a.name)).toEqual([
      'feedback.routes/handler/schema',
      'PgFeedbackRepository',
      'EmailSupportNotifier',
      'LegacyUserDirectory · ACL',
    ])
  })

  it('removing a port unlinks the adapters that implemented it', () => {
    state().removeItem(state().focus, 'ports', 'p-repo')
    expect(currentDiagram().ports.some((p) => p.id === 'p-repo')).toBe(false)
    expect(currentDiagram().adapters.find((a) => a.id === 'a-knex')?.portId).toBeUndefined()
    expect(currentDiagram().adapters.find((a) => a.id === 'a-email')?.portId).toBe('p-notify')
  })

  it('removing an adapter unlinks both actors and externals', () => {
    state().addItem(state().focus, 'externals')
    state().updateItem(state().focus, 'externals', currentDiagram().externals.at(-1)!.id, { adapterId: 'a-http' })
    state().removeItem(state().focus, 'adapters', 'a-http')
    expect(currentDiagram().actors[0].adapterId).toBeUndefined()
    expect(currentDiagram().externals.at(-1)?.adapterId).toBeUndefined()
  })

  it('removing a domain parent unlinks its children', () => {
    state().removeItem(state().focus, 'domain', 'd-feedback')
    expect(currentDiagram().domain.every((i) => i.parentId === undefined)).toBe(true)
  })

  it('removing a use case unlinks its ports', () => {
    state().removeItem(state().focus, 'useCases', 'uc-submit')
    expect(currentDiagram().ports.every((p) => p.useCaseId === undefined)).toBe(true)
  })

  it('keeps the map schema-valid across every mutation', () => {
    const hexId = state().focus
    state().removeItem(hexId, 'useCases', 'uc-submit')
    state().removeItem(hexId, 'ports', 'p-submit')
    state().removeItem(hexId, 'adapters', 'a-legacy')
    state().addItem(hexId, 'domain')
    state().setMeta(hexId, { composition: undefined })
    state().setMapMeta({ kind: 'onion' })
    expect(MapSchema.safeParse(state().map).success).toBe(true)
  })

  it('updates hexagon metadata through setMeta', () => {
    state().setMeta(state().focus, { title: 'Billing' })
    expect(currentDiagram()).toMatchObject({ title: 'Billing' })
  })

  it('updates the map title and kind through setMapMeta, on a single-hexagon map', () => {
    state().setMapMeta({ title: 'Billing', kind: 'clean' })
    expect(state().map).toMatchObject({ title: 'Billing', kind: 'clean' })
  })

  it('refuses a kind change on a multi-hexagon map, leaving the map unchanged (MIG-04.2)', () => {
    const twoHex = {
      ...toMap(EXAMPLE_DIAGRAM),
      hexagons: [...toMap(EXAMPLE_DIAGRAM).hexagons, { ...toMap(EXAMPLE_DIAGRAM).hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }],
    }
    state().replace(twoHex)
    const before = state().map
    state().setMapMeta({ kind: 'onion' })
    expect(state().map).toBe(before)
  })

  it('leaves every hexagon but the current one untouched by reference', () => {
    const twoHex = {
      ...toMap(EXAMPLE_DIAGRAM),
      hexagons: [...toMap(EXAMPLE_DIAGRAM).hexagons, { ...toMap(EXAMPLE_DIAGRAM).hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }],
    }
    state().replace(twoHex)
    const untouched = state().map.hexagons[1]
    state().setMeta(state().focus, { title: 'Renamed' })
    expect(state().map.hexagons[1]).toBe(untouched)
  })

  it('restore resets the map and focus without bumping the revision', () => {
    const before = state()
    const snapshot = { map: before.map, focus: before.focus }
    state().setMeta(state().focus, { title: 'Changed' })
    const revisionAfterEdit = state().revision
    state().restore(snapshot)
    expect(state().map).toBe(snapshot.map)
    expect(state().focus).toBe(snapshot.focus)
    expect(state().revision).toBe(revisionAfterEdit)
  })

  it('restore bumps the revision when undoing a swap (swap: true), refitting the view — but not when undoing an edit', () => {
    const before = state()
    const swapSnapshot = { map: before.map, focus: before.focus, swap: true }
    const editSnapshot = { map: before.map, focus: before.focus }
    const revisionBefore = state().revision

    state().restore(swapSnapshot)
    expect(state().revision).toBe(revisionBefore + 1)

    const revisionAfterSwapRestore = state().revision
    state().restore(editSnapshot)
    expect(state().revision).toBe(revisionAfterSwapRestore)
  })

  it('setFocus moves the current hexagon without touching map or revision', () => {
    const twoHex = {
      ...toMap(EXAMPLE_DIAGRAM),
      hexagons: [...toMap(EXAMPLE_DIAGRAM).hexagons, { ...toMap(EXAMPLE_DIAGRAM).hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }],
    }
    state().replace(twoHex)
    const { map: mapBefore, revision: revisionBefore } = state()
    state().setFocus('h2')
    expect(state().focus).toBe('h2')
    expect(state().map).toBe(mapBefore)
    expect(state().revision).toBe(revisionBefore)
  })

  it('setFocus is a no-op for an unknown hexagon id', () => {
    const before = state().focus
    state().setFocus('does-not-exist')
    expect(state().focus).toBe(before)
  })

  describe('link pruning wired into updateItem/removeItem (SEAM-06)', () => {
    const linkedTwoHex = (): HexaMap => {
      const base = toMap(EXAMPLE_DIAGRAM)
      const h1 = base.hexagons[0]
      const link: Link = { id: 'link-1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } }
      return { ...base, hexagons: [{ ...h1, cell: { q: 0, r: 0 } }, { ...h1, id: 'h2', cell: { q: 1, r: 0 } }], links: [link] }
    }

    it('removeItem returns the links it pruned, and removes them from the map', () => {
      state().replace(linkedTwoHex())
      const pruned = state().removeItem('h1', 'ports', 'p-repo')
      expect(pruned).toEqual([{ id: 'link-1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } }])
      expect(state().map.links).toEqual([])
    })

    it('updateItem returns the links a side flip broke, and removes them from the map', () => {
      state().replace(linkedTwoHex())
      const pruned = state().updateItem('h1', 'ports', 'p-repo', { side: 'driving', wall: undefined })
      expect(pruned).toHaveLength(1)
      expect(state().map.links).toEqual([])
    })

    it('updateItem returns no pruned links for an edit that does not touch a linked port', () => {
      state().replace(linkedTwoHex())
      const pruned = state().updateItem('h1', 'adapters', 'a-knex', { name: 'Renamed' })
      expect(pruned).toEqual([])
      expect(state().map.links).toHaveLength(1)
    })

    it('flipping a linked port’s side back after a prune does not restore the link — only undo does (LINK-01.6)', () => {
      state().replace(linkedTwoHex())
      const flipped = state().updateItem('h1', 'ports', 'p-repo', { side: 'driving', wall: undefined })
      expect(flipped).toHaveLength(1)
      expect(state().map.links).toEqual([])

      const flippedBack = state().updateItem('h1', 'ports', 'p-repo', { side: 'driven', wall: 'e' })
      expect(flippedBack).toEqual([])
      expect(state().map.links).toEqual([])
    })
  })

  describe('addHexagon (ADR-02, SEAM-03)', () => {
    it('grows into the same context on the given side, focuses it, and leaves revision untouched', () => {
      const before = state()
      const revisionBefore = before.revision
      const hexId = state().addHexagon(before.focus, { side: 'e', context: 'same' })
      expect(hexId).toBeDefined()
      const grown = state().map.hexagons.find((h) => h.id === hexId)!
      expect(grown.contextId).toBe(before.map.hexagons[0].contextId)
      expect(grown.cell).toStrictEqual(neighbour(before.map.hexagons[0].cell, 'e'))
      expect(grown.title).toBe(UNTITLED_HEXAGON)
      expect(state().map.contexts).toStrictEqual(before.map.contexts)
      expect(state().focus).toBe(hexId)
      expect(state().revision).toBe(revisionBefore)
    })

    it('grows into a new context appended in the same transition when context is "new"', () => {
      const before = state()
      const hexId = state().addHexagon(before.focus, { side: 'w', context: 'new' })
      expect(state().map.contexts).toHaveLength(before.map.contexts.length + 1)
      const newContext = state().map.contexts.at(-1)!
      expect(state().map.hexagons.find((h) => h.id === hexId)?.contextId).toBe(newContext.id)
      expect(state().map.hexagons.filter((h) => h.contextId === newContext.id)).toHaveLength(1)
    })

    it('omitting side falls back to the first free side in SIDE_ORDER', () => {
      const before = state()
      const firstFree = freeSides(before.map, before.map.hexagons[0].cell)[0]
      const hexId = state().addHexagon(before.focus, { context: 'same' })
      const grown = state().map.hexagons.find((h) => h.id === hexId)!
      expect(grown.cell).toStrictEqual(neighbour(before.map.hexagons[0].cell, firstFree))
    })

    it('returns undefined and leaves the map untouched when the hexagon has no free side', () => {
      const before = state()
      const surrounded: HexaMap = {
        ...before.map,
        hexagons: [before.map.hexagons[0], ...SIDE_ORDER.map((s, i) => ({ ...before.map.hexagons[0], id: `ring${i}`, cell: neighbour(before.map.hexagons[0].cell, s) }))],
      }
      state().replace(surrounded)
      const map = state().map
      const hexId = state().addHexagon(state().focus, { context: 'same' })
      expect(hexId).toBeUndefined()
      expect(state().map).toBe(map)
    })

    it('returns undefined on a non-hexagonal map without convert, leaving the map untouched', () => {
      state().setMapMeta({ kind: 'clean' })
      const map = state().map
      const hexId = state().addHexagon(state().focus, { context: 'same' })
      expect(hexId).toBeUndefined()
      expect(state().map).toBe(map)
    })

    it('with convert: true, grows a non-hexagonal map and flips its kind to hexagonal in one notification', () => {
      state().setMapMeta({ kind: 'onion' })
      const hexId = state().addHexagon(state().focus, { context: 'same', convert: true })
      expect(hexId).toBeDefined()
      expect(state().map.kind).toBe('hexagonal')
    })

    it('every output parses MapSchema', () => {
      state().addHexagon(state().focus, { context: 'new' })
      expect(MapSchema.safeParse(state().map).success).toBe(true)
    })

    it('leaves every other hexagon untouched by reference', () => {
      const before = state()
      const untouched = before.map.hexagons[0]
      state().addHexagon(before.focus, { side: 'e', context: 'new' })
      expect(state().map.hexagons[0]).toBe(untouched)
    })

    it('growing twice appends both in creation order, keeping the first hexagon first (REQ-02.2 hardening)', () => {
      const before = state()
      const firstId = before.map.hexagons[0].id
      const grownFirst = state().addHexagon(before.focus, { side: 'e', context: 'same' })!
      const grownSecond = state().addHexagon(before.focus, { side: 'w', context: 'same' })!
      expect(state().map.hexagons.map((h) => h.id)).toEqual([firstId, grownFirst, grownSecond])
    })
  })

  describe('importHexagon (ADR-02, SEAM-03, V3 destination choice)', () => {
    const oneHexFile = (kind: 'hexagonal' | 'clean' | 'onion' = 'hexagonal') => toMap({ ...EXAMPLE_DIAGRAM, kind, title: 'Legacy System' })

    it('returns undefined and leaves the map untouched when the file has more than one hexagon (IMP-04)', () => {
      const before = state().map
      const hexId = state().importHexagon(twoHexMap(), { context: 'same' })
      expect(hexId).toBeUndefined()
      expect(state().map).toBe(before)
    })

    it('imports into a fresh, unnamed context when context is "new", without touching the existing one', () => {
      const before = state().map
      const hexId = state().importHexagon(oneHexFile(), { context: 'new' })
      expect(hexId).toBeDefined()
      expect(state().map.contexts).toHaveLength(before.contexts.length + 1)
      const newContext = state().map.contexts.at(-1)!
      expect(newContext.name).toBeUndefined()
      expect(state().map.hexagons.find((h) => h.id === hexId)?.contextId).toBe(newContext.id)
      expect(state().map.contexts[0]).toStrictEqual(before.contexts[0])
    })

    it('imports into the current hexagon’s own context when context is "same", creating no new context (IMP-01.4)', () => {
      const before = state()
      const hexId = state().importHexagon(oneHexFile(), { context: 'same' })
      expect(state().map.contexts).toStrictEqual(before.map.contexts)
      expect(state().map.hexagons.find((h) => h.id === hexId)?.contextId).toBe(before.map.hexagons[0].contextId)
    })

    it('the imported hexagon’s content matches the source exactly, except id/contextId/cell (IMP-02.1)', () => {
      const file = oneHexFile()
      const hexId = state().importHexagon(file, { context: 'new' })
      expect(diagramOf(state().map, hexId!)).toStrictEqual(diagramOf(file, file.hexagons[0].id))
    })

    it('lands on the first free cell from the current hexagon (IMP-01)', () => {
      const before = state().map
      const expectedCell = freeCell(before, before.hexagons[0].cell)
      const hexId = state().importHexagon(oneHexFile(), { context: 'same' })
      expect(state().map.hexagons.find((h) => h.id === hexId)?.cell).toStrictEqual(expectedCell)
    })

    it('returns undefined on a non-hexagonal map without convert, leaving the map untouched', () => {
      state().setMapMeta({ kind: 'clean' })
      const map = state().map
      const hexId = state().importHexagon(oneHexFile(), { context: 'same' })
      expect(hexId).toBeUndefined()
      expect(state().map).toBe(map)
    })

    it('with convert: true, imports into a non-hexagonal map and flips its kind to hexagonal in one notification', () => {
      state().setMapMeta({ kind: 'onion' })
      const hexId = state().importHexagon(oneHexFile(), { context: 'same', convert: true })
      expect(hexId).toBeDefined()
      expect(state().map.kind).toBe('hexagonal')
    })

    it('focuses the imported hexagon, leaving revision untouched', () => {
      const revisionBefore = state().revision
      const hexId = state().importHexagon(oneHexFile(), { context: 'new' })
      expect(state().focus).toBe(hexId)
      expect(state().revision).toBe(revisionBefore)
    })

    it('every output parses MapSchema', () => {
      state().importHexagon(oneHexFile(), { context: 'new' })
      expect(MapSchema.safeParse(state().map).success).toBe(true)
    })

    it('importing the same file twice, both times into a new context, creates two independent hexagons with distinct ids, cells and contexts (IMP-05.1)', () => {
      const file = oneHexFile()
      const first = state().importHexagon(file, { context: 'new' })!
      const second = state().importHexagon(file, { context: 'new' })!
      const firstHex = state().map.hexagons.find((h) => h.id === first)!
      const secondHex = state().map.hexagons.find((h) => h.id === second)!
      expect(first).not.toBe(second)
      expect(firstHex.cell).not.toStrictEqual(secondHex.cell)
      expect(firstHex.contextId).not.toBe(secondHex.contextId)
    })

    it('never mutates the source file object (IMP-03)', () => {
      const file = oneHexFile()
      const snapshot = structuredClone(file)
      state().importHexagon(file, { context: 'new' })
      expect(file).toStrictEqual(snapshot)
    })

    it('importing the current map’s own just-saved file adds a second, independent hexagon (IMP-05.2)', () => {
      const before = state().map
      const saved = parseHexa(toHexa(before))
      if (!saved.ok) throw new Error('fixture map failed to round-trip through toHexa/parseHexa')
      const hexId = state().importHexagon(saved.map, { context: 'new' })
      expect(hexId).toBeDefined()
      expect(state().map.hexagons).toHaveLength(2)
      const imported = state().map.hexagons.find((h) => h.id === hexId)!
      expect(imported.id).not.toBe(before.hexagons[0].id)
      expect(imported.cell).not.toStrictEqual(before.hexagons[0].cell)
      expect(diagramOf(state().map, hexId!)).toStrictEqual(diagramOf(before, before.hexagons[0].id))
    })

    it('importing the same file twice, both times into "same", places both in the current hexagon’s context, still on distinct cells', () => {
      const file = oneHexFile()
      const contextBefore = state().map.hexagons[0].contextId
      const first = state().importHexagon(file, { context: 'same' })!
      const second = state().importHexagon(file, { context: 'same' })!
      const firstHex = state().map.hexagons.find((h) => h.id === first)!
      const secondHex = state().map.hexagons.find((h) => h.id === second)!
      expect(firstHex.contextId).toBe(contextBefore)
      expect(secondHex.contextId).toBe(contextBefore)
      expect(firstHex.cell).not.toStrictEqual(secondHex.cell)
    })
  })

  describe('removeHexagon (ADR-02, DEL-01..04)', () => {
    it('is a no-op returning [] and leaving the map untouched on the last hexagon (DEL-01)', () => {
      const map = state().map
      const pruned = state().removeHexagon(state().focus)
      expect(pruned).toEqual([])
      expect(state().map).toBe(map)
    })

    it('removes the hexagon, prunes its links, and leaves the revision untouched', () => {
      state().replace(linkedTwoHexMap())
      const revisionBefore = state().revision
      const pruned = state().removeHexagon('h1')
      expect(pruned).toHaveLength(1)
      expect(state().map.hexagons.map((h) => h.id)).toEqual(['h2'])
      expect(state().map.links).toEqual([])
      expect(state().revision).toBe(revisionBefore)
    })

    it('moves focus to the first remaining hexagon when the deleted one was current (DEL-04.1)', () => {
      state().replace(twoHexMap())
      state().setFocus('h1')
      state().removeHexagon('h1')
      expect(state().focus).toBe('h2')
    })

    it('leaves focus untouched when a non-current hexagon is deleted', () => {
      state().replace(twoHexMap())
      state().setFocus('h2')
      state().removeHexagon('h1')
      expect(state().focus).toBe('h2')
    })

    it('every output parses MapSchema', () => {
      state().replace(twoHexMap())
      state().removeHexagon('h1')
      expect(MapSchema.safeParse(state().map).success).toBe(true)
    })
  })

  describe('setContextName (NAME-01, NAME-02)', () => {
    it('names an unnamed context', () => {
      const contextId = state().map.contexts[0].id
      state().setContextName(contextId, 'Billing')
      expect(state().map.contexts.find((c) => c.id === contextId)?.name).toBe('Billing')
    })

    it('renames an already-named context', () => {
      const contextId = state().map.contexts[0].id
      state().setContextName(contextId, 'Billing')
      state().setContextName(contextId, 'Payments')
      expect(state().map.contexts.find((c) => c.id === contextId)?.name).toBe('Payments')
    })

    it('an empty string clears the name key entirely, not just to an empty string', () => {
      const contextId = state().map.contexts[0].id
      state().setContextName(contextId, 'Billing')
      state().setContextName(contextId, '')
      const context = state().map.contexts.find((c) => c.id === contextId)!
      expect('name' in context).toBe(false)
    })

    it('leaves every other context untouched and never bumps the revision', () => {
      const hexId = state().focus
      state().addHexagon(hexId, { side: 'e', context: 'new' })
      const [c1, c2] = state().map.contexts
      const revisionBefore = state().revision

      state().setContextName(c2.id, 'Billing')

      expect(state().map.contexts.find((c) => c.id === c1.id)).toStrictEqual(c1)
      expect(state().map.contexts.find((c) => c.id === c2.id)?.name).toBe('Billing')
      expect(state().revision).toBe(revisionBefore)
      expect(MapSchema.safeParse(state().map).success).toBe(true)
    })
  })
})
