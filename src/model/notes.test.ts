import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM } from './example'
import { notesOf } from './notes'

describe('notesOf', () => {
  it('maps every element that carries a note to its text, across collections and the composition root', () => {
    const notes = notesOf({
      domain: [{ id: 'd1', note: 'rule' }, { id: 'd2' }],
      useCases: [{ id: 'u1', note: 'sig\nstep' }],
      ports: [{ id: 'p1', note: '  ' }],
      actors: [{ id: 'a1', note: 'who' }],
      composition: { note: 'wiring' },
    })
    expect(Object.fromEntries(notes)).toEqual({ d1: 'rule', u1: 'sig\nstep', a1: 'who', composition: 'wiring' })
  })

  it('reads ringed documents through their elements', () => {
    expect(notesOf({ elements: [{ id: 'e1', note: 'n' }, { id: 'e2', note: '' }] }).get('e1')).toBe('n')
  })

  it('accepts a real diagram', () => {
    expect(notesOf(EXAMPLE_DIAGRAM).get('uc-submit')).toContain('execute(cmd)')
  })
})
