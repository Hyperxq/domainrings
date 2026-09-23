import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM } from './model/example'
import { useDiagramStore } from './model/store'

const scrollIntoView = vi.fn()

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // A narrow viewport, so the editor starts collapsed.
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = scrollIntoView
})
beforeEach(() => {
  useDiagramStore.getState().replace(EXAMPLE_DIAGRAM)
  scrollIntoView.mockClear()
})
afterEach(cleanup)

const onCanvas = (container: HTMLElement, ref: string) => container.querySelector(`svg.canvas [data-ref="${ref}"]`)!
const card = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!

describe('double-click to edit', () => {
  const useCase = EXAMPLE_DIAGRAM.useCases[0]

  it('opens the collapsed editor at the use case card, flashes it and selects its name', () => {
    const { container } = render(<App />)
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeTruthy()

    const notPrevented = fireEvent.doubleClick(onCanvas(container, useCase.id))

    expect(notPrevented).toBe(false)
    expect(screen.getByRole('button', { name: 'Collapse editor' })).toBeTruthy()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(scrollIntoView.mock.contexts[0]).toBe(card(container, useCase.id))
    expect(card(container, useCase.id).classList.contains('is-flash')).toBe(true)
    const input = document.activeElement as HTMLInputElement
    expect(card(container, useCase.id).contains(input)).toBe(true)
    expect(input.value).toBe(useCase.name)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, useCase.name.length])
  })

  it('focuses the Layers fieldset of the layer whose title was double-clicked', () => {
    const { container } = render(<App />)
    const title = container.querySelector('svg.canvas text.ring-label[data-layer="application"]')!

    fireEvent.doubleClick(title)

    const fieldset = card(container, 'layer:application')
    expect(fieldset.tagName).toBe('FIELDSET')
    expect(fieldset.contains(document.activeElement)).toBe(true)
  })

  it('reaches the composition root field', () => {
    const { container } = render(<App />)
    fireEvent.doubleClick(onCanvas(container, 'composition'))
    expect(card(container, 'composition').contains(document.activeElement)).toBe(true)
  })

  it('does the same on Enter for a focused element', () => {
    const { container } = render(<App />)
    const node = onCanvas(container, useCase.id) as SVGElement
    node.focus()
    expect(document.activeElement).toBe(node)

    fireEvent.keyDown(node, { key: 'Enter' })

    expect((document.activeElement as HTMLInputElement).value).toBe(useCase.name)
  })
})

describe('selection and delete on the canvas', () => {
  const useCase = EXAMPLE_DIAGRAM.useCases[0]
  const selected = (container: HTMLElement) => [...container.querySelectorAll('svg.canvas [data-selected]')].map((n) => n.getAttribute('data-ref'))

  it('selects a node on click, and Esc or a click on empty canvas clears it', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, useCase.id))
    expect(selected(container)).toEqual([useCase.id])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(selected(container)).toEqual([])

    fireEvent.click(onCanvas(container, useCase.id))
    fireEvent.click(container.querySelector('[data-band="adapters"]')!)
    expect(selected(container)).toEqual([])
  })

  it('deletes the selected element with Delete, offers Undo, and Undo restores the exact diagram', () => {
    const { container } = render(<App />)
    const port = EXAMPLE_DIAGRAM.ports.find((p) => EXAMPLE_DIAGRAM.adapters.some((a) => a.portId === p.id))!
    fireEvent.click(onCanvas(container, port.id))
    fireEvent.keyDown(onCanvas(container, port.id), { key: 'Delete' })

    const after = useDiagramStore.getState().diagram
    expect(after.ports.some((p) => p.id === port.id)).toBe(false)
    expect(after.adapters.some((a) => a.portId === port.id)).toBe(false)
    expect(selected(container)).toEqual([])
    expect(screen.getByRole('status').textContent).toContain(`Deleted ${port.name}`)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useDiagramStore.getState().diagram).toEqual(EXAMPLE_DIAGRAM)
  })

  it('deletes with Backspace too', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, useCase.id))
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(useDiagramStore.getState().diagram.useCases.some((u) => u.id === useCase.id)).toBe(false)
  })

  it('never deletes while typing in an editor field', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, useCase.id))
    const input = card(container, useCase.id).querySelector('input')!
    input.focus()
    fireEvent.keyDown(input, { key: 'Backspace' })
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(useDiagramStore.getState().diagram).toEqual(EXAMPLE_DIAGRAM)
  })

  it('does nothing on a layer band', () => {
    const { container } = render(<App />)
    const band = container.querySelector<SVGElement>('[data-band="application"]')!
    fireEvent.click(band)
    band.focus()
    fireEvent.keyDown(band, { key: 'Delete' })
    expect(useDiagramStore.getState().diagram).toEqual(EXAMPLE_DIAGRAM)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not select when the press turned into a pan', () => {
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    const node = onCanvas(container, useCase.id)
    fireEvent.pointerDown(node, { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 140, clientY: 100 })
    fireEvent.pointerUp(main, { clientX: 140, clientY: 100 })
    fireEvent.click(node)
    expect(selected(container)).toEqual([])
  })
})

describe('undo toast', () => {
  const useCase = EXAMPLE_DIAGRAM.useCases[0]
  const deleteUseCase = (container: HTMLElement) => {
    fireEvent.click(onCanvas(container, useCase.id))
    fireEvent.keyDown(document.body, { key: 'Delete' })
  }
  const hasUseCase = () => useDiagramStore.getState().diagram.useCases.some((u) => u.id === useCase.id)
  const toast = () => screen.queryByRole('status')

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('appears as a compact status row with Undo and a close button, and leaves after 6 s', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    const row = toast()!
    expect(row.getAttribute('aria-live')).toBe('polite')
    expect(row.classList.contains('toast')).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()

    act(() => vi.advanceTimersByTime(5900))
    expect(toast()).not.toBeNull()
    act(() => vi.advanceTimersByTime(100))
    act(() => vi.advanceTimersByTime(150))
    expect(toast()).toBeNull()
  })

  it('pauses while hovered and resumes where it left off', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.pointerEnter(toast()!)
    act(() => vi.advanceTimersByTime(10000))
    expect(toast()).not.toBeNull()
    fireEvent.pointerLeave(toast()!)
    act(() => vi.advanceTimersByTime(1900))
    expect(toast()).not.toBeNull()
    act(() => vi.advanceTimersByTime(100))
    act(() => vi.advanceTimersByTime(150))
    expect(toast()).toBeNull()
  })

  it('restarts the countdown for a new notice', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    act(() => vi.advanceTimersByTime(5000))
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.adapters[0].id))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    act(() => vi.advanceTimersByTime(5000))
    expect(toast()!.textContent).toContain(EXAMPLE_DIAGRAM.adapters[0].name)
  })

  it('closes on Esc', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(150))
    expect(toast()).toBeNull()
  })

  it.each([{ metaKey: true }, { ctrlKey: true }])('undoes with %o+Z while the toast is up', (modifier) => {
    const { container } = render(<App />)
    deleteUseCase(container)
    expect(hasUseCase()).toBe(false)
    fireEvent.keyDown(document.body, { key: 'z', ...modifier })
    expect(hasUseCase()).toBe(true)
    expect(toast()).toBeNull()
  })

  it('leaves Cmd+Z to the field while typing in an input', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    const input = container.querySelector<HTMLInputElement>('.editor input')!
    input.focus()
    fireEvent.keyDown(input, { key: 'z', metaKey: true })
    expect(hasUseCase()).toBe(false)
    expect(toast()).not.toBeNull()
  })

  it('keeps an error notice in the fuller layout, without a countdown', async () => {
    render(<App />)
    const file = new File(['{ nope'], 'broken.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Import a .hexa file'), { target: { files: [file] } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const alert = screen.getByRole('alert')
    expect(alert.classList.contains('toast')).toBe(false)
    act(() => vi.advanceTimersByTime(20000))
    expect(screen.getByRole('alert')).toBe(alert)
  })
})

describe('toolbar', () => {
  it('labels New, Example and Import with text, and groups the export formats under one Export label', () => {
    render(<App />)
    for (const [name, text] of [['New diagram', 'New'], ['Load an example', 'Example'], ['Import a .hexa file', 'Import']]) {
      const control = screen.getByLabelText(name)
      expect(control.closest('.icon-button, .tool')!.textContent).toContain(text)
    }
    const group = screen.getByRole('group', { name: 'Export' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['.hexa', 'SVG', 'PNG'])
    expect(group.querySelector('svg')).toBeNull()
  })
})

describe('legend island', () => {
  const legendButton = () => document.querySelector<HTMLButtonElement>('.legend .legend-head')!
  const headings = () => [...document.querySelectorAll('.legend h3')].map((h) => h.textContent)

  beforeEach(() => localStorage.removeItem('domainrings:legend-open'))

  it('reads as a help panel when closed, and shows its close control when open', () => {
    render(<App />)
    const button = legendButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('title')).toBe('Show legend')
    expect(button.textContent).toBe('Legend')
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Hide legend' }).getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem('domainrings:legend-open')).toBe('true')
  })

  it('closes on Esc while focus is inside it', () => {
    render(<App />)
    fireEvent.click(legendButton())
    const checkbox = screen.getByLabelText('Include legend in export')
    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: 'Escape' })
    expect(legendButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('never shows an empty section', () => {
    useDiagramStore.getState().replace({ ...EXAMPLE_DIAGRAM, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] })
    render(<App />)
    fireEvent.click(legendButton())
    expect(headings()).toEqual(['Colour · layer', 'Stroke · role'])
  })

  it('explains the glyphs present in the diagram even in Overview, where the canvas hides them', () => {
    localStorage.setItem('domainrings:overview', 'true')
    render(<App />)
    fireEvent.click(legendButton())
    expect(headings()).toContain('Glyph · type')
    expect([...document.querySelectorAll('.legend-tags li')].map((li) => li.textContent)).toContain('◆ aggregate')
    localStorage.removeItem('domainrings:overview')
  })
})
