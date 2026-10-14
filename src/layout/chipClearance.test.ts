import { describe, expect, it } from 'vitest'
import { STRESS_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import type { HexaMap } from '../model/schema'
import { chipBox } from './contextChips'
import { hexagonBounds } from './lattice'
import { layoutMap } from './map'

const gap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), a.y - (b.y + b.height), b.y - (a.y + a.height))

/** Two large full hexagons with a compact one between them, in a context whose name is far wider than that hexagon. */
const wideChips = (names: string[]): HexaMap => {
  const base = toMap(STRESS_DIAGRAM)
  const [big] = base.hexagons
  const small = { ...big, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
  const compact = [{ q: 1, r: -1 }, { q: -1, r: 0 }, { q: 1, r: 0 }]
  return {
    ...base,
    contexts: names.map((name, i) => ({ id: `c${i}`, name })),
    hexagons: [
      { ...big, id: 'big', contextId: 'c0', cell: { q: 0, r: 0 } },
      { ...big, id: 'big2', contextId: 'c4', cell: { q: 2, r: -1 } },
      ...compact.map((cell, i) => ({ ...small, id: `s${i}`, title: `S${i}`, contextId: `c${i + 1}`, cell })),
    ],
    links: [],
  }
}

describe('context chips beside a large full hexagon', () => {
  const names = ['Core', 'A bounded context named at great length so its chip is far wider than the hexagon it labels, and then some more words to make it wider still', 'Mid', 'Another very long context name that also runs wide across the map', 'Tail']
  const map = wideChips(names)

  it.each(['detailed', 'overview'] as const)('keep their whole text off every hexagon (%s)', (mode) => {
    const result = layoutMap(map, { mode, current: 'big', expanded: new Set(['big', 'big2']) })
    const failures: string[] = []
    for (const context of result.contexts) {
      const chip = chipBox(context.chip, context.label, context.size)
      for (const h of result.hexagons) if (gap(chip, hexagonBounds(h)) <= 0) failures.push(`${context.id} over ${h.id}`)
    }
    expect(failures).toEqual([])
  })
})
