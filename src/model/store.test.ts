import { beforeEach, describe, expect, it } from 'vitest'
import { useMapStore } from './store'
import { toMap } from './hexa'
import { diagramOf } from './map'
import { MapSchema, type HexaMap, type Link } from './schema'
import { EXAMPLE_DIAGRAM } from './example'

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
})
