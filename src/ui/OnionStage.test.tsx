import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { layoutOnion } from '../layout/onion'
import { newOnionMap } from '../model/hexa'
import { useOnionStore } from '../model/onionStore'
import { OnionStage } from './OnionStage'

const state = () => useOnionStore.getState()

// RingedStage (the shared Onion/Clean viewport chrome) observes its own size, same as Hexagonal's own Stage.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => {
  state().replace(newOnionMap('Fresh architecture'))
})
afterEach(cleanup)

/** The stage as the app wires it: laid out fresh from the live store on every render, exactly like App.tsx's own
 * `layoutOnion(onionMap)` recompute — a plain fixed `model` prop would go stale the instant a test mutates the
 * store (Stage.test.tsx's own Harness solves the same problem for Hexagonal). */
function Harness({ onReject = () => {} }: { onReject?: (message: string) => void } = {}) {
  const doc = useOnionStore((s) => s.map)
  const svgRef = createRef<SVGSVGElement>()
  return <OnionStage model={layoutOnion(doc)} doc={doc} svgRef={svgRef} onReject={onReject} />
}

const renderStage = (props?: { onReject?: (message: string) => void }) => render(<Harness {...props} />)

/** Reveals a ring's own "+" affordances (mirrors Hexagonal's own Stage.test.tsx `hover` helper) — hovering its
 * band, same as a real pointer resting on the ring. */
const hoverRing = (container: HTMLElement, role: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${role}"]`)!)

describe('OnionStage "+" affordances only show for the hovered/focused ring or element (no clutter, REQ-05/REQ-07)', () => {
  it('offers no "+" at all until a ring is hovered or focused', () => {
    const { container } = renderStage()
    expect(container.querySelectorAll('[data-plus]')).toHaveLength(0)
  })

  it('hovering a ring reveals only its own "+", not another ring\'s', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    expect(screen.getByRole('button', { name: 'Add an element to Domain Model' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an element to Infrastructure' })).toBeNull()
  })

  it('a pointer-driven focus does not reveal "+" buttons, only a real keyboard focus does', () => {
    const { container } = renderStage()
    const band = container.querySelector('[data-band="domain"]')!
    fireEvent.pointerDown(band, { button: 0 })
    fireEvent.focus(band)
    expect(screen.queryByRole('button', { name: 'Add an element to Domain Model' })).toBeNull()
    fireEvent.pointerUp(band)
    fireEvent.focus(band)
    expect(screen.getByRole('button', { name: 'Add an element to Domain Model' })).toBeTruthy()
  })

  it('hovering the "+" itself does not hide it, but leaving the canvas entirely does', () => {
    const { container } = renderStage()
    const svg = container.querySelector('svg.canvas')!
    hoverRing(container, 'domain')
    const plus = screen.getByRole('button', { name: 'Add an element to Domain Model' })
    // The pointer moving off the ring onto the "+" itself never leaves the svg's own bounds (both live inside
    // it) — only the "+" glyph's own pointerover must not blank out whatever revealed it.
    fireEvent.pointerOver(plus)
    expect(screen.getByRole('button', { name: 'Add an element to Domain Model' })).toBeTruthy()
    fireEvent.pointerLeave(svg, { relatedTarget: null })
    expect(screen.queryByRole('button', { name: 'Add an element to Domain Model' })).toBeNull()
  })
})

describe('OnionStage', () => {
  it('a ring\'s "+" adds a named element there, immediately open for renaming (REQ-07)', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].ringRole).toBe('domain')
    const field = screen.getByLabelText('element name') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Order' } })
    fireEvent.blur(field)
    expect(state().map.elements[0].name).toBe('Order')
  })

  it('cancelling a new element\'s name (Esc) removes it', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    expect(state().map.elements).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('element name'), { key: 'Escape' })
    expect(state().map.elements).toHaveLength(0)
  })

  it('an outer-ring element offers an actor and an external "+" while it is hovered; an inner one offers neither (REQ-05)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    renderStage()
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Controller (outer)' }))
    expect(screen.getByRole('button', { name: 'Add an actor for Controller' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an external system for Controller' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an actor for Order' })).toBeNull()
  })

  it('an actor "+" creates the endpoint already targeting that outer-ring element', () => {
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    renderStage()
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Controller (outer)' }))
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

  it('marks only the valid targets with data-link-target while linking, not the source or an outward element (REQ-04)', () => {
    const outerId = state().addElement({ name: 'Controller', ringRole: 'outer' })
    const appId = state().addElement({ name: 'OrderService', ringRole: 'application' })
    const domainId = state().addElement({ name: 'Order', ringRole: 'domain' })
    const { container } = renderStage()
    const markedRef = (ref: string) => container.querySelector(`[data-ref="${ref}"]`)!.hasAttribute('data-link-target')

    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from Controller' }))

    expect(markedRef(appId)).toBe(true)
    expect(markedRef(domainId)).toBe(true)
    expect(markedRef(outerId)).toBe(false)
  })

  it('choosing an invalid (outward) target while linking calls onReject, leaving the document unchanged (REQ-04)', () => {
    state().addElement({ name: 'Order', ringRole: 'domain' })
    state().addElement({ name: 'OrderService', ringRole: 'application' })
    state().addElement({ name: 'Controller', ringRole: 'outer' })
    const onReject = vi.fn()
    renderStage({ onReject })
    const before = state().map
    fireEvent.click(screen.getByRole('button', { name: 'OrderService (application)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from OrderService' }))
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' })) // outward — invalid target

    expect(state().map).toBe(before)
    expect(state().map.dependencies).toEqual([])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0]).toMatch(/same ring or a more inward one/)
  })
})
