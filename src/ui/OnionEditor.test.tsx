import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { countCrossings } from '../layout/crossings'
import { layoutOnion } from '../layout/onion'
import { newOnionMap } from '../model/hexa'
import { useOnionStore } from '../model/onionStore'
import type { OnionFile } from '../model/schema'
import { OnionEditor } from './OnionEditor'

const state = () => useOnionStore.getState()

beforeEach(() => {
  state().replace(newOnionMap('Fresh architecture'))
})
afterEach(cleanup)

const renderEditor = (props?: { onMutate?: (message: string, before: OnionFile) => void }) => render(<OnionEditor open onToggle={() => {}} {...props} />)
const section = (container: HTMLElement, title: string) => within(container).getByText(title).closest('details')!

describe('OnionEditor', () => {
  it('renders one fold per ring, innermost-first, each starting empty', () => {
    const { container } = renderEditor()
    for (const title of ['Domain Model', 'Domain Services', 'Application Services', 'Infrastructure']) {
      expect(section(container, title).querySelector('summary')!.textContent).toBe(`${title}· 0`)
    }
  })

  it('adds an element to the ring whose "+" was clicked, immediately focused for renaming (REQ-07)', () => {
    renderEditor()
    // The "+" sits beside the fold's summary, outside the <details> element itself (same layout as Editor.tsx's
    // Section "+"), so it's looked up unscoped by its own unique aria-label, matching that file's own convention.
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))

    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].ringRole).toBe('domain')
    expect((document.activeElement as HTMLElement).classList.contains('name')).toBe(true)

    fireEvent.change(document.activeElement!, { target: { value: 'Order' } })
    expect(state().map.elements[0].name).toBe('Order')
  })

  it('removing an element removes it from its ring section', () => {
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove element Order' }))
    expect(state().map.elements.find((e) => e.id === id)).toBeUndefined()
  })

  it('the dependency create form only offers inward-or-same targets (REQ-04) and creates one on submit', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'OrderController', ringRole: 'outer' })
    const { container } = renderEditor()
    const depSection = section(container, 'Dependencies')
    const fromSelect = within(depSection).getByLabelText('From element') as HTMLSelectElement
    fireEvent.change(fromSelect, { target: { value: state().map.elements[0].id } })
    // Order is innermost (domain): OrderController (outer) must never appear as a "To element" choice.
    const toSelectAfterDomainFrom = within(depSection).getByLabelText('To element') as HTMLSelectElement
    expect(within(toSelectAfterDomainFrom).queryByRole('option', { name: 'OrderController' })).toBeNull()

    fireEvent.change(fromSelect, { target: { value: state().map.elements[1].id } })
    const toSelect = within(depSection).getByLabelText('To element') as HTMLSelectElement
    expect(within(toSelect).getByRole('option', { name: 'Order' })).toBeTruthy()
    fireEvent.change(toSelect, { target: { value: state().map.elements[0].id } })
    fireEvent.click(within(depSection).getByRole('button', { name: 'Create dependency' }))

    expect(state().map.dependencies).toHaveLength(1)
  })

  it('the actors form only offers outer-ring targets and creates one on submit (REQ-05)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'OrderController', ringRole: 'outer' })
    const { container } = renderEditor()
    const actorsSection = section(container, 'Actors')
    const targetSelect = within(actorsSection).getByLabelText('Target (outer ring)') as HTMLSelectElement
    expect(within(targetSelect).queryByRole('option', { name: 'Order' })).toBeNull()
    fireEvent.change(targetSelect, { target: { value: state().map.elements[1].id } })
    fireEvent.click(within(actorsSection).getByRole('button', { name: 'Add actor' }))

    expect(state().map.actors).toHaveLength(1)
    expect(state().map.actors[0].targetId).toBe(state().map.elements[1].id)
  })
})

describe('OnionEditor — "Tidy ring order" (Decision 3, now an explicit action)', () => {
  it('reduces dependency-edge crossings and reports it for Undo', () => {
    const xId = state().addElement({ name: 'X', ringRole: 'domain' })
    const yId = state().addElement({ name: 'Y', ringRole: 'domain' })
    const zId = state().addElement({ name: 'Z', ringRole: 'domain' })
    const cId = state().addElement({ name: 'C', ringRole: 'outer' })
    const bId = state().addElement({ name: 'B', ringRole: 'outer' })
    const aId = state().addElement({ name: 'A', ringRole: 'outer' })
    state().addDependency(aId, xId)
    state().addDependency(bId, yId)
    state().addDependency(cId, zId)
    const before = state().map
    const crossingsBefore = countCrossings(layoutOnion(before).edges)
    expect(crossingsBefore).toBeGreaterThan(0)

    const onMutate = vi.fn()
    renderEditor({ onMutate })
    fireEvent.click(screen.getByRole('button', { name: 'Tidy ring order' }))

    expect(countCrossings(layoutOnion(state().map).edges)).toBeLessThan(crossingsBefore)
    expect(onMutate).toHaveBeenCalledWith('Tidied ring order.', before)
  })
})

describe('OnionEditor — document title', () => {
  it('renames the document live and reports one undoable edit per rename session', () => {
    const onMutate = vi.fn()
    renderEditor({ onMutate })
    const field = screen.getByLabelText('Diagram title')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'Payments' } })
    expect(state().map.title).toBe('Payments')
    expect(screen.getByRole('heading', { level: 2, name: 'Payments' })).toBeTruthy()
    expect(onMutate).not.toHaveBeenCalled()

    fireEvent.blur(field)
    expect(onMutate).toHaveBeenCalledTimes(1)
    expect(onMutate).toHaveBeenCalledWith('Renamed Fresh architecture to Payments.', expect.objectContaining({ title: 'Fresh architecture' }))
  })

  it('falls back to "Untitled architecture" in the heading when the name is cleared', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Diagram title'), { target: { value: '' } })
    expect(state().map.title).toBe('')
    expect(screen.getByRole('heading', { level: 2, name: 'Untitled architecture' })).toBeTruthy()
  })
})

describe('OnionEditor — element kind', () => {
  const kindSelect = (container: HTMLElement) => within(container).getByLabelText('Order kind') as HTMLSelectElement

  it('offers only its own ring\'s kinds, plus no kind', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    const { container } = renderEditor()
    const options = within(kindSelect(container)).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['No kind', 'entity', 'value object', 'aggregate', 'domain event'])
  })

  it('setting a kind is one undoable step reporting the document as it stood before', () => {
    const id = state().addElement({ name: 'Order', ringRole: 'domain' })
    const onMutate = vi.fn()
    const { container } = renderEditor({ onMutate })
    fireEvent.change(kindSelect(container), { target: { value: 'aggregate' } })

    expect(state().map.elements.find((e) => e.id === id)?.kind).toBe('aggregate')
    expect(onMutate).toHaveBeenCalledTimes(1)
    expect(onMutate.mock.calls[0][0]).toBe('Set Order to aggregate.')
    expect(onMutate.mock.calls[0][1].elements[0].kind).toBeUndefined()
  })

  it('choosing no kind clears it', () => {
    state().addElement({ name: 'Order', ringRole: 'domain', kind: 'entity' })
    const { container } = renderEditor()
    fireEvent.change(kindSelect(container), { target: { value: '' } })
    expect(state().map.elements[0].kind).toBeUndefined()
  })
})
