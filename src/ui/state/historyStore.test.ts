import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM } from '../../model/example'
import { toHexa, toMap } from '../../model/hexa'
import { useMapStore } from '../../model/store'
import { UNDO_LIMIT, useHistoryStore } from './historyStore'

const history = () => useHistoryStore.getState()
const current = () => {
  const { map, focus } = useMapStore.getState()
  return { map, focus }
}
const rename = (title: string) => useMapStore.getState().setMeta(useMapStore.getState().focus, { title })
/** Edits the document and returns the snapshot from just before, as a recorded step holds it. */
const edit = (title: string) => {
  const before = current()
  rename(title)
  return before
}

beforeEach(() => useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM)))

describe('history store: steps', () => {
  it('keeps the newest UNDO_LIMIT steps and evicts the oldest past it', () => {
    const befores = Array.from({ length: UNDO_LIMIT + 3 }, (_, i) => edit(`Step ${i}`))
    for (const before of befores) history().record(before)

    const { stack } = history()
    expect(stack).toHaveLength(UNDO_LIMIT)
    expect(stack[0]).toBe(befores[3])
    expect(stack.at(-1)).toBe(befores.at(-1))
  })

  it('starts over when a step does not lead back from the document the last one left', () => {
    const first = edit('First')
    history().record(first)
    history().settle(useMapStore.getState().map, first.focus)
    rename('Unrecorded')
    const second = edit('Second')

    history().record(second)

    expect(history().stack).toEqual([second])
  })

  it('undo puts the recorded document back and pops the step', () => {
    const before = edit('Edited')
    history().record(before)
    history().settle(useMapStore.getState().map, before.focus)

    const entry = history().undo(useMapStore.getState().map)

    expect(entry).toBe(before)
    expect(toHexa(useMapStore.getState().map)).toBe(toHexa(before.map))
    expect(history().stack).toHaveLength(0)
  })

  it('refuses to undo once the document changed in a way no step tracks, and drops the history', () => {
    const before = edit('Tracked')
    history().record(before)
    history().settle(useMapStore.getState().map, before.focus)
    rename('Untracked')
    const edited = useMapStore.getState().map

    expect(history().undo(edited)).toBe('unavailable')

    expect(history().stack).toHaveLength(0)
    expect(useMapStore.getState().map).toBe(edited)
  })

  it('refuses to undo before any step has trusted a document', () => {
    history().settle(useMapStore.getState().map, useMapStore.getState().focus)
    expect(history().undo(useMapStore.getState().map)).toBe('unavailable')
  })
})

describe('history store: field sessions', () => {
  const field = document.createElement('input')
  beforeEach(() => document.body.append(field))
  afterEach(() => field.remove())

  it('turns a focus-to-blur edit into a single step holding the document from before it', () => {
    const before = current()
    history().beginField(before, field)
    rename('T')
    rename('Ti')
    rename('Tit')
    history().endField()

    expect(history().stack).toEqual([before])
    expect(history().pending).toBeNull()
  })

  it('records nothing when the session left the document as it found it', () => {
    history().beginField(current(), field)
    history().endField()
    expect(history().stack).toHaveLength(0)
  })

  it('keeps an open session recording across an undo while its field still has focus', () => {
    const step = edit('Edited')
    history().record(step)
    history().settle(useMapStore.getState().map, step.focus)
    field.focus()
    history().beginField(current(), field)

    history().undo(useMapStore.getState().map)

    const { pending } = history()
    expect(pending?.field).toBe(field)
    expect(pending?.before.map).toBe(useMapStore.getState().map)
  })

  it('ends an open session at an undo when its field has lost focus', () => {
    const step = edit('Edited')
    history().record(step)
    history().settle(useMapStore.getState().map, step.focus)
    field.blur()
    history().beginField(current(), field)

    history().undo(useMapStore.getState().map)

    expect(history().pending).toBeNull()
  })

  it('ends an open session at an undo when its field left the page', () => {
    const step = edit('Edited')
    history().record(step)
    history().settle(useMapStore.getState().map, step.focus)
    field.focus()
    history().beginField(current(), field)
    field.remove()

    history().undo(useMapStore.getState().map)

    expect(history().pending).toBeNull()
  })
})
