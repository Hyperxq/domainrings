import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newCleanMap } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import { CleanEditor } from './CleanEditor'

const state = () => useCleanStore.getState()

beforeEach(() => {
  state().replace(newCleanMap('Fresh architecture'))
})
afterEach(cleanup)

const renderEditor = () => render(<CleanEditor open onToggle={() => {}} />)
const section = (container: HTMLElement, title: string) => within(container).getByText(title).closest('details')!

describe('CleanEditor', () => {
  it('renders one fold per ring, innermost-first, each starting with 0 sectors', () => {
    const { container } = renderEditor()
    for (const title of ['Entities', 'Use Cases', 'Interface Adapters', 'Frameworks & Drivers']) {
      expect(section(container, title).querySelector('summary')!.textContent).toBe(`${title}· 0`)
    }
  })

  it('adds a sector to the ring whose "+" was clicked, immediately focused for renaming (REQ-03)', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add sector to Entities' }))

    expect(state().map.sectors).toHaveLength(1)
    expect(state().map.sectors[0].ringRole).toBe('domain')
    expect((document.activeElement as HTMLElement).classList.contains('name')).toBe(true)

    fireEvent.change(document.activeElement!, { target: { value: 'Order Management' } })
    expect(state().map.sectors[0].name).toBe('Order Management')
  })

  it('an empty sector is a valid, displayable state (REQ-03/REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    const { container } = renderEditor()
    const domainFold = section(container, 'Entities')
    expect(within(domainFold).getByDisplayValue('Billing')).toBeTruthy()
    expect(within(domainFold).getByText('No elements yet.')).toBeTruthy()
  })

  it('adding an element via a sector\'s "+" attaches it to that sector, immediately focused for renaming (REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))

    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].sectorId).toBe(state().map.sectors[0].id)
    expect((document.activeElement as HTMLElement).classList.contains('name')).toBe(true)

    fireEvent.change(document.activeElement!, { target: { value: 'Invoice' } })
    expect(state().map.elements[0].name).toBe('Invoice')
  })

  it('removing a sector removes it and cascade-prunes its own elements', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const elementId = state().addElement({ name: 'Invoice', sectorId })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove sector Billing' }))

    expect(state().map.sectors.find((s) => s.id === sectorId)).toBeUndefined()
    expect(state().map.elements.find((e) => e.id === elementId)).toBeUndefined()
  })

  it('removing an element removes it from its sector', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const elementId = state().addElement({ name: 'Invoice', sectorId })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove element Invoice' }))

    expect(state().map.elements.find((e) => e.id === elementId)).toBeUndefined()
  })

  it('the dependency create form only offers inward-or-same targets, sector-transparent (REQ-06), and creates one on submit', () => {
    const domainSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Order', sectorId: domainSector })
    state().addElement({ name: 'OrderController', sectorId: outerSector })
    const { container } = renderEditor()
    const depSection = section(container, 'Dependencies')
    const fromSelect = within(depSection).getByLabelText('From element') as HTMLSelectElement
    fireEvent.change(fromSelect, { target: { value: state().map.elements[0].id } })
    // Order is domain (inward): OrderController (outer) must never appear as a "To element" choice.
    const toSelectAfterDomainFrom = within(depSection).getByLabelText('To element') as HTMLSelectElement
    expect(within(toSelectAfterDomainFrom).queryByRole('option', { name: 'OrderController' })).toBeNull()

    fireEvent.change(fromSelect, { target: { value: state().map.elements[1].id } })
    const toSelect = within(depSection).getByLabelText('To element') as HTMLSelectElement
    expect(within(toSelect).getByRole('option', { name: 'Order' })).toBeTruthy()
    fireEvent.change(toSelect, { target: { value: state().map.elements[0].id } })
    fireEvent.click(within(depSection).getByRole('button', { name: 'Create dependency' }))

    expect(state().map.dependencies).toHaveLength(1)
  })

  it('the actors form only offers elements in an outer-ring sector and creates one on submit (REQ-07)', () => {
    const domainSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Order', sectorId: domainSector })
    state().addElement({ name: 'OrderController', sectorId: outerSector })
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
