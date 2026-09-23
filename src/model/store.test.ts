import { beforeEach, describe, expect, it } from 'vitest'
import { useDiagramStore } from './store'
import { DiagramSchema } from './schema'
import { EXAMPLE_DIAGRAM } from './example'

const state = () => useDiagramStore.getState()
const diagram = () => state().diagram

describe('diagram store', () => {
  beforeEach(() => state().replace(EXAMPLE_DIAGRAM))

  it('adds an item with a fresh id and defaults, returning the id', () => {
    const id = state().addItem('ports', { side: 'driven' })
    const port = diagram().ports.at(-1)
    expect(port).toMatchObject({ id, side: 'driven' })
    expect(EXAMPLE_DIAGRAM.ports.some((p) => p.id === id)).toBe(false)
  })

  it('updates only the targeted item', () => {
    state().updateItem('adapters', 'a-knex', { name: 'PgFeedbackRepository' })
    expect(diagram().adapters.map((a) => a.name)).toEqual([
      'feedback.routes/handler/schema',
      'PgFeedbackRepository',
      'EmailSupportNotifier',
      'LegacyUserDirectory · ACL',
    ])
  })

  it('removing a port unlinks the adapters that implemented it', () => {
    state().removeItem('ports', 'p-repo')
    expect(diagram().ports.some((p) => p.id === 'p-repo')).toBe(false)
    expect(diagram().adapters.find((a) => a.id === 'a-knex')?.portId).toBeUndefined()
    expect(diagram().adapters.find((a) => a.id === 'a-email')?.portId).toBe('p-notify')
  })

  it('removing an adapter unlinks both actors and externals', () => {
    state().addItem('externals')
    state().updateItem('externals', diagram().externals.at(-1)!.id, { adapterId: 'a-http' })
    state().removeItem('adapters', 'a-http')
    expect(diagram().actors[0].adapterId).toBeUndefined()
    expect(diagram().externals.at(-1)?.adapterId).toBeUndefined()
  })

  it('removing a domain parent unlinks its children', () => {
    state().removeItem('domain', 'd-feedback')
    expect(diagram().domain.every((i) => i.parentId === undefined)).toBe(true)
  })

  it('removing a use case unlinks its ports', () => {
    state().removeItem('useCases', 'uc-submit')
    expect(diagram().ports.every((p) => p.useCaseId === undefined)).toBe(true)
  })

  it('keeps the diagram schema-valid across every mutation', () => {
    state().removeItem('useCases', 'uc-submit')
    state().removeItem('ports', 'p-submit')
    state().removeItem('adapters', 'a-legacy')
    state().addItem('domain')
    state().setMeta({ kind: 'onion', composition: undefined })
    expect(DiagramSchema.safeParse(diagram()).success).toBe(true)
  })

  it('updates diagram metadata', () => {
    state().setMeta({ title: 'Billing', kind: 'clean', composition: undefined })
    expect(diagram()).toMatchObject({ title: 'Billing', kind: 'clean' })
    expect(diagram().composition).toBeUndefined()
  })

  it('bumps the revision on replace so views can refit', () => {
    const before = state().revision
    state().replace({ ...EXAMPLE_DIAGRAM, title: 'Other' })
    expect(state().revision).toBe(before + 1)
    expect(diagram().title).toBe('Other')
  })
})
