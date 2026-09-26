import { describe, expect, it } from 'vitest'
import { newCleanMap } from './hexa'
import { useCleanStore } from './cleanStore'

const state = () => useCleanStore.getState()

describe('clean store', () => {
  it('boots with a fresh Clean map: 4 canonical rings, empty collections, revision 0', () => {
    expect(state().map.kind).toBe('clean')
    expect(state().map.rings.map((r) => r.role)).toEqual(['domain', 'application', 'adapters', 'outer'])
    expect(state().map.sectors).toEqual([])
    expect(state().map.elements).toEqual([])
    expect(state().revision).toBe(0)
  })

  it('replace swaps the map and bumps the revision, mirroring useOnionStore (ADR-02)', () => {
    const before = state().revision
    const next = newCleanMap('Swapped')
    state().replace(next)
    expect(state().map).toBe(next)
    expect(state().revision).toBe(before + 1)
  })

  it('restore without swap puts the map back but leaves the revision alone', () => {
    const original = state().map
    const revisionBefore = state().revision
    state().replace(newCleanMap('Edited'))
    state().restore({ map: original })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionBefore + 1) // the replace() in between already bumped it once
  })

  it('restore with swap: true bumps the revision like replace does', () => {
    const original = state().map
    state().replace(newCleanMap('Edited'))
    const revisionAfterReplace = state().revision
    state().restore({ map: original, swap: true })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionAfterReplace + 1)
  })
})
