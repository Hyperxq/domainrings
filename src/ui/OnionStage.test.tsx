import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { layoutOnion } from '../layout/onion'
import { newOnionMap } from '../model/hexa'
import { useOnionStore } from '../model/onionStore'
import { OnionStage } from './OnionStage'

const state = () => useOnionStore.getState()

beforeEach(() => {
  state().replace(newOnionMap('Fresh architecture'))
})
afterEach(cleanup)

/** The stage as the app wires it: laid out fresh from the live store on every render, exactly like App.tsx's own
 * `layoutOnion(onionMap)` recompute — a plain fixed `model` prop would go stale the instant a test mutates the
 * store (Stage.test.tsx's own Harness solves the same problem for Hexagonal). */
function Harness() {
  const doc = useOnionStore((s) => s.map)
  const svgRef = createRef<SVGSVGElement>()
  return <OnionStage model={layoutOnion(doc)} doc={doc} svgRef={svgRef} />
}

const renderStage = () => render(<Harness />)

describe('OnionStage', () => {
  it('offers a "+" for every ring on a fresh map', () => {
    renderStage()
    for (const label of ['Add an element to Domain Model', 'Add an element to Domain Services', 'Add an element to Application Services', 'Add an element to Infrastructure']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('a ring\'s "+" adds a named element there, immediately open for renaming (REQ-07)', () => {
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].ringRole).toBe('domain')
    const field = screen.getByLabelText('element name') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Order' } })
    fireEvent.blur(field)
    expect(state().map.elements[0].name).toBe('Order')
  })

  it('cancelling a new element\'s name (Esc) removes it', () => {
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    expect(state().map.elements).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('element name'), { key: 'Escape' })
    expect(state().map.elements).toHaveLength(0)
  })

  it('an outer-ring element offers an actor and an external "+"; an inner one offers neither (REQ-05)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    renderStage()
    expect(screen.getByRole('button', { name: 'Add an actor for Controller' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an external system for Controller' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an actor for Order' })).toBeNull()
  })

  it('an actor "+" creates the endpoint already targeting that outer-ring element', () => {
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add an actor for Controller' }))
    expect(state().map.actors).toHaveLength(1)
    expect(state().map.actors[0].targetId).toBe(state().map.elements[0].id)
  })

  it('selecting an element with a valid target offers "Depend on…"; choosing that target creates the dependency (REQ-04)', () => {
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from Controller' }))
    fireEvent.click(screen.getByRole('button', { name: 'Order (domain)' }))
    expect(state().map.dependencies).toHaveLength(1)
    expect(state().map.dependencies[0]).toMatchObject({ fromId: outerId, toId: domainId })
  })

  it('the innermost ring never offers "Depend on…" (nothing more inward exists to point to)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Order (domain)' }))
    expect(screen.queryByRole('button', { name: /Depend on…/ })).toBeNull()
  })

  it('choosing an invalid (outward) target while linking cancels the gesture, leaving the document unchanged (REQ-04)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'OrderService', ringRole: 'application' })
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    renderStage()
    const before = state().map
    fireEvent.click(screen.getByRole('button', { name: 'OrderService (application)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from OrderService' }))
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' })) // outward — invalid target

    expect(state().map).toBe(before)
    expect(state().map.dependencies).toEqual([])
  })
})
