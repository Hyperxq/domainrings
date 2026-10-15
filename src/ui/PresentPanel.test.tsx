import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EXAMPLES } from '../model/example'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { useMapStore } from '../model/store'
import { threadSlots } from '../model/threads'
import { PresentButton, PresentPanel, StepCard } from './PresentPanel'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const advanced = () => EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
const withTexts = (fields: object) => {
  const map = advanced()
  useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: h.useCases.map((u) => (u.id === 'uc-place' ? { ...u, ...fields } : u)) } : h)) })
}
const present = (step = 0) =>
  act(() => {
    useViewStore.getState().focusFlow('uc-place')
    useViewStore.getState().present(step)
  })
const stepNo = () => useViewStore.getState().presentStep
const current = () => document.querySelector('[aria-current="step"]')!

beforeEach(() => {
  useMapStore.getState().replace(advanced())
  usePreferencesStore.setState({ viewOnly: true })
  useViewStore.setState({ focusedFlow: null, presentStep: null })
})
afterEach(cleanup)

describe('present accent', () => {
  it('wears the presented flow thread colour on the panel and the step card', () => {
    present()
    render(<><PresentPanel /><StepCard /></>)
    const want = `var(--thread-${threadSlots(diagramOf(useMapStore.getState().map, 'h1')).get('uc-place')})`
    for (const el of [document.querySelector('.present-panel'), document.querySelector('.step-card')] as HTMLElement[]) expect(el.style.getPropertyValue('--thread')).toBe(want)
  })
})

describe('PresentPanel', () => {
  it('heads the flow with its name, lists every step with number, name and a role tag, and marks the current one', () => {
    present()
    render(<PresentPanel />)
    expect(screen.getByRole('heading', { name: 'PlaceOrder' })).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(16)
    expect(rows[0].textContent).toMatch(/1.*Web shop.*actor/)
    expect(rows[2].textContent).toMatch(/3.*ordersApi.*driving port/)
    expect(rows[3].textContent).toMatch(/PlaceOrder.*use case/)
    expect(rows[4].textContent).toMatch(/PaymentGateway.*driven port/)
    expect(rows[5].textContent).toMatch(/adapter/)
    expect(rows[6].textContent).toMatch(/chargePayment.*linked port/)
    expect(rows[15].textContent).toMatch(/Postgres.*external/)
    expect(current()).toBe(rows[0])
    expect(screen.getByText('Step 1 of 16 · arrow keys move between steps')).toBeTruthy()
  })

  it('moves between steps with Next and Back, which stop at the ends', () => {
    present()
    render(<PresentPanel />)
    const back = screen.getByRole('button', { name: '← Back' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next →' }) as HTMLButtonElement
    expect(back.disabled).toBe(true)
    fireEvent.click(next)
    expect(stepNo()).toBe(1)
    expect(screen.getByText('Step 2 of 16 · arrow keys move between steps')).toBeTruthy()
    fireEvent.click(back)
    expect(stepNo()).toBe(0)
    present(15)
    expect(next.disabled).toBe(true)
    fireEvent.click(next)
    expect(stepNo()).toBe(15)
  })

  it('moves with the arrow keys, ignores them while typing, and stops at the ends', () => {
    present()
    render(<PresentPanel />)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(stepNo()).toBe(0)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(stepNo()).toBe(2)
    const field = document.body.appendChild(document.createElement('input'))
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(stepNo()).toBe(2)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(stepNo()).toBe(1)
    present(15)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(stepNo()).toBe(15)
    field.remove()
  })

  it('leaves a key whose default was already prevented to whoever prevented it', () => {
    present(1)
    render(<PresentPanel />)
    const claim = (e: Event) => e.preventDefault()
    document.body.addEventListener('keydown', claim)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.body.removeEventListener('keydown', claim)
    expect(stepNo()).toBe(1)
  })

  it('Escape stops presenting but keeps the flow isolated; "All flows" also clears it', () => {
    present(3)
    render(<PresentPanel />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(stepNo()).toBeNull()
    expect(useViewStore.getState().focusedFlow).toBe('uc-place')
    present(3)
    fireEvent.click(screen.getByRole('button', { name: '← All flows' }))
    expect(stepNo()).toBeNull()
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('shows the description and the current step note, and only when written', () => {
    withTexts({ description: 'Takes an order from the shop to the books.', stepNotes: { 'act-web': 'A shopper presses Buy.', 'a-rest': 'Parses the JSON.' } })
    present()
    render(<PresentPanel />)
    expect(screen.getByText('Takes an order from the shop to the books.')).toBeTruthy()
    expect(within(current() as HTMLElement).getByText('A shopper presses Buy.')).toBeTruthy()
    expect(screen.queryByText('Parses the JSON.')).toBeNull()
    act(() => useViewStore.getState().present(1))
    expect(within(current() as HTMLElement).getByText('Parses the JSON.')).toBeTruthy()
    expect(screen.queryByText('A shopper presses Buy.')).toBeNull()
  })

  it('omits the description and the note when empty', () => {
    present()
    const { container } = render(<PresentPanel />)
    expect(container.querySelector('.present-description')).toBeNull()
    expect(container.querySelector('.present-note')).toBeNull()
  })
})

describe('StepCard', () => {
  it('tags an aggregate step with its role', () => {
    const map = advanced()
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, domain: [...h.domain, { id: 'agg', name: 'Order', type: 'aggregate' as const }], useCases: h.useCases.map((u) => (u.id === 'uc-place' ? { ...u, aggregateIds: ['agg'] } : u)) } : h)) })
    present()
    render(<PresentPanel />)
    expect(screen.getAllByRole('listitem')[4].textContent).toMatch(/Order.*aggregate/)
  })

  it('names the step number, its role and the note', () => {
    withTexts({ stepNotes: { 'a-rest': 'Parses the JSON.' } })
    present(1)
    render(<StepCard />)
    expect(screen.getByText('STEP 2 · ADAPTER')).toBeTruthy()
    expect(screen.getByText('orders.routes')).toBeTruthy()
    expect(screen.getByText('Parses the JSON.')).toBeTruthy()
  })

  it('renders nothing when not presenting', () => {
    const { container } = render(<StepCard />)
    expect(container.firstChild).toBeNull()
  })
})

describe('PresentButton', () => {
  it('starts the focused flow at its first step', () => {
    act(() => useViewStore.getState().focusFlow('uc-place'))
    render(<PresentButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(useViewStore.getState()).toMatchObject({ focusedFlow: 'uc-place', presentStep: 0 })
  })

  it('starts the first flow when none is focused', () => {
    render(<PresentButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(useViewStore.getState()).toMatchObject({ focusedFlow: 'uc-place', presentStep: 0 })
  })

  it('is absent in Edit mode, while presenting, and with no use case', () => {
    usePreferencesStore.setState({ viewOnly: false })
    const { container, rerender } = render(<PresentButton />)
    expect(container.firstChild).toBeNull()
    usePreferencesStore.setState({ viewOnly: true })
    present()
    rerender(<PresentButton />)
    expect(container.firstChild).toBeNull()
    act(() => useViewStore.setState({ focusedFlow: null, presentStep: null }))
    const map = advanced()
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] } : h)) })
    rerender(<PresentButton />)
    expect(container.firstChild).toBeNull()
  })
})
