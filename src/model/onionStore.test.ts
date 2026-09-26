import { describe, expect, it } from 'vitest'
import { newOnionMap } from './hexa'
import { useOnionStore } from './onionStore'

const state = () => useOnionStore.getState()

describe('onion store', () => {
  it('starts with a fresh onion map and revision 0', () => {
    expect(state().map.kind).toBe('onion')
    expect(state().revision).toBe(0)
  })

  it('replace swaps the map and bumps the revision, mirroring useMapStore (ADR-02)', () => {
    const before = state().revision
    const next = newOnionMap('Swapped')
    state().replace(next)
    expect(state().map).toBe(next)
    expect(state().revision).toBe(before + 1)
  })

  it('restore without swap puts the map back but leaves the revision alone', () => {
    const original = state().map
    const revisionBefore = state().revision
    state().replace(newOnionMap('Edited'))
    state().restore({ map: original })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionBefore + 1) // the replace() in between already bumped it once
  })

  it('restore with swap: true bumps the revision like replace does', () => {
    const original = state().map
    state().replace(newOnionMap('Edited'))
    const revisionAfterReplace = state().revision
    state().restore({ map: original, swap: true })
    expect(state().map).toBe(original)
    expect(state().revision).toBe(revisionAfterReplace + 1)
  })
})
