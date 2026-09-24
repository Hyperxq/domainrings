import { toMap } from '../model/hexa'
import { diagramOf } from '../model/map'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { useMapStore } from '../model/store'
import type { HexaMap, Link } from '../model/schema'

/** One context, cells {0,0}/{1,0}: h1's driven port links to h2's driving port — the shape of the shipped example. */
export function twoHexagonMap(): HexaMap {
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

/** Two independent hexagons, each shaped like the example diagram (ids collide by design: EDIT-01 scoping must hold regardless). */
export function twoHexMap(): HexaMap {
  const base = toMap(EXAMPLE_DIAGRAM)
  const h1 = base.hexagons[0]
  return { ...base, links: [], hexagons: [{ ...h1, cell: { q: 0, r: 0 } }, { ...h1, id: 'h2', cell: { q: 1, r: 0 }, title: 'Second slice' }] }
}

const TWO_HEX_LINK: Link = { id: 'link-1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } }

/** twoHexMap with h1's FeedbackRepository port linked to h2's submit port. */
export function linkedTwoHexMap(): HexaMap {
  return { ...twoHexMap(), links: [TWO_HEX_LINK] }
}

export const hexGroup = (container: HTMLElement, hexId: string) => container.querySelector(`[data-hex="${hexId}"]`)!
export const card = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!
export const currentDiagram = () => diagramOf(useMapStore.getState().map, useMapStore.getState().focus)
