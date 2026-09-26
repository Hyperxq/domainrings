import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newOnionMap } from '../model/hexa'
import { useOnionStore } from '../model/onionStore'
import { OnionEditor } from './OnionEditor'

const state = () => useOnionStore.getState()

beforeEach(() => {
  state().replace(newOnionMap('Fresh architecture'))
})
afterEach(cleanup)

const renderEditor = () => render(<OnionEditor open onToggle={() => {}} />)
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
