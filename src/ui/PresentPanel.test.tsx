import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EXAMPLES, TWO_SLICES_MAP } from '../model/example'
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
  useViewStore.setState({ focusedFlow: null, presentStep: null, editorOpen: true })
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
  it('collapses to its header and expands again, and the arrow keys and Esc keep working meanwhile', () => {
    present(1)
    render(<PresentPanel />)
    const panel = screen.getByRole('complementary', { name: 'Present' })
    const toggle = screen.getByRole('button', { name: 'Collapse walkthrough' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(useViewStore.getState().editorOpen).toBe(false)
    expect(panel.classList.contains('is-collapsed')).toBe(true)
    expect(panel.querySelector('.editor-body')!.hasAttribute('hidden')).toBe(true)
    expect(panel.querySelector('.present-foot')!.hasAttribute('hidden')).toBe(true)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(stepNo()).toBe(2)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(stepNo()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Expand walkthrough' }))
    expect(panel.classList.contains('is-collapsed')).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(stepNo()).toBeNull()
  })

  it('keeps a long step name whole in its tooltip, since the row cuts it short', () => {
    present()
    render(<PresentPanel />)
    for (const name of document.querySelectorAll('.present-name')) expect(name.getAttribute('title')).toBe(name.textContent)
  })

  it('heads the flow with its name, lists every step with number, name and a role tag, and marks the current one', () => {
    present()
    render(<PresentPanel />)
    expect(screen.getByRole('heading', { name: 'PlaceOrder' })).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(32)
    expect(rows[0].textContent).toMatch(/1.*Web shop.*actor/)
    expect(rows[2].textContent).toMatch(/3.*ordersApi.*driving port/)
    expect(rows[3].textContent).toMatch(/PlaceOrder.*use case/)
    expect(rows[4].textContent).toMatch(/Order.*aggregate/)
    expect(rows[5].textContent).toMatch(/PaymentGateway.*driven port/)
    expect(rows[6].textContent).toMatch(/adapter/)
    expect(rows[7].textContent).toMatch(/chargePayment.*linked port/)
    expect(rows[8].textContent).toMatch(/9.*ChargePayment.*use case/)
    expect(rows[31].textContent).toMatch(/Postgres.*external/)
    expect(current()).toBe(rows[0])
    expect(screen.getByText('Step 1 of 32 · ← → move · Shift+→ skips · Esc exits')).toBeTruthy()
  })

  it('moves between steps with Next and Back, which stop at the ends', () => {
    present()
    render(<PresentPanel />)
    const back = screen.getByRole('button', { name: '← Back' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next →' }) as HTMLButtonElement
    expect(back.disabled).toBe(true)
    fireEvent.click(next)
    expect(stepNo()).toBe(1)
    expect(screen.getByText('Step 2 of 32 · ← → move · Shift+→ skips · Esc exits')).toBeTruthy()
    fireEvent.click(back)
    expect(stepNo()).toBe(0)
    present(31)
    expect(screen.queryByRole('button', { name: 'Next →' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(stepNo()).toBeNull()
    expect(useViewStore.getState().focusedFlow).toBe('uc-place')
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
    present(31)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(stepNo()).toBe(31)
    field.remove()
  })

  it('skips the linked use case the current step is in, by button or Shift+→, and offers it only there', () => {
    present(7)
    render(<PresentPanel />)
    const skip = () => screen.getByRole('button', { name: 'Skip ChargePayment' }) as HTMLButtonElement
    fireEvent.click(skip())
    expect(current().textContent).toMatch(/ShipmentRequester.*driven port/)
    expect(screen.getByRole('button', { name: /^Skip/ }).hasAttribute('disabled')).toBe(true)
    present(9)
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })
    expect(current().textContent).toMatch(/ShipmentRequester.*driven port/)
    present(3)
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })
    expect(stepNo()).toBe(3)
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

  it('Escape and Exit stop presenting but keep the flow isolated; "All flows" also clears it', () => {
    present(3)
    render(<PresentPanel />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(stepNo()).toBeNull()
    expect(useViewStore.getState().focusedFlow).toBe('uc-place')
    present(3)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
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
    expect(screen.getByText('Order').closest('li')!.textContent).toMatch(/aggregate/)
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

  it("starts the first listed flow when the current hexagon has none", () => {
    useMapStore.getState().replace({ ...TWO_SLICES_MAP, hexagons: TWO_SLICES_MAP.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [] } : h)) })
    useMapStore.getState().setFocus('h1')
    render(<PresentButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(useMapStore.getState().focus).toBe('h2')
    expect(useViewStore.getState()).toMatchObject({ focusedFlow: 'uc-receive', presentStep: 0 })
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
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => ({ ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] })) })
    rerender(<PresentButton />)
    expect(container.firstChild).toBeNull()
  })
})
