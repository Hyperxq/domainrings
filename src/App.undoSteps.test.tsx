import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM } from './model/example'
import { toHexa, toMap } from './model/hexa'
import { useCleanStore } from './model/cleanStore'
import { useMapStore } from './model/store'
import { useOnionStore } from './model/onionStore'
import { installDialogPolyfill, twoHexMap } from './test/fixtures'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // A narrow viewport: the editor starts collapsed, like App.test.tsx.
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  installDialogPolyfill()
})
beforeEach(() => {
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const toast = () => screen.queryAllByRole('status').find((el) => el.classList.contains('toast')) ?? null
const undoKey = () => fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
const doc = () => toHexa(useMapStore.getState().map)
const expandEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))

/** A whole edit session, the way a person types: focus, one or more keystrokes, blur. */
const session = (field: HTMLElement, ...values: string[]) => {
  fireEvent.focus(field)
  for (const value of values) fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

/** An older undo step (with its toast dismissed), so a test can tell "one step" from "the whole history". */
const recordOlderStep = (container: HTMLElement) => {
  fireEvent.click(container.querySelector(`svg.canvas [data-ref="${EXAMPLE_DIAGRAM.adapters[0].id}"]`)!)
  fireEvent.keyDown(document.body, { key: 'Delete' })
  act(() => vi.advanceTimersByTime(6000))
  act(() => vi.advanceTimersByTime(150))
  return doc()
}

describe('Hexagonal editor field sessions', () => {
  const fields: [string, () => HTMLElement][] = [
    ['map title', () => screen.getByLabelText('Map title')],
    ['hexagon title', () => screen.getByLabelText('Hexagon title')],
    ['hexagon subtitle', () => screen.getAllByLabelText('Subtitle')[0]],
    ['composition root', () => screen.getByLabelText('Composition root')],
    ['ring title', () => screen.getAllByLabelText('Ring title')[0]],
    ['ring subtitle', () => screen.getAllByLabelText('Subtitle')[1]],
    ['item name', () => screen.getAllByLabelText('domain item name')[0]],
    ['item note', () => screen.getAllByLabelText(/^Note for /)[0]],
  ]

  it.each(fields)('records one silent step for the %s, and Undo restores its value', (_name, field) => {
    const { container } = render(<App />)
    const older = recordOlderStep(container)
    expandEditor()
    session(field(), 'Ab', 'Abc', 'Abcd')

    expect(toast()).toBeNull()
    expect(doc()).not.toBe(older)
    undoKey()
    expect(doc()).toBe(older)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  it('records no step for a session that ends where it began', () => {
    const { container } = render(<App />)
    const older = recordOlderStep(container)
    expandEditor()
    const title = screen.getByLabelText('Map title') as HTMLInputElement
    session(title, 'Temporary', title.value)

    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
    expect(older).not.toBe(doc())
  })

  it('keeps the steps of two sessions apart', () => {
    render(<App />)
    expandEditor()
    session(screen.getByLabelText('Map title'), 'One')
    const afterFirst = doc()
    session(screen.getByLabelText('Hexagon title'), 'Two')

    undoKey()
    expect(doc()).toBe(afterFirst)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  const discrete: [string, () => void][] = [
    ['adding an item', () => fireEvent.click(screen.getByRole('button', { name: 'Add domain item' }))],
    ['adding a port', () => fireEvent.click(screen.getByRole('button', { name: 'Add a driving port' }))],
    ['removing an item', () => fireEvent.click(screen.getAllByRole('button', { name: /^Remove use case / })[0])],
    ['changing an item type', () => fireEvent.change(screen.getAllByLabelText('Type')[0], { target: { value: 'valueObject' } })],
    ['changing a use case placement', () => fireEvent.change(screen.getAllByLabelText('Placement')[0], { target: { value: 'nw' } })],
  ]

  it.each(discrete)('records one silent step for %s', (_name, act) => {
    const { container } = render(<App />)
    const older = recordOlderStep(container)
    expandEditor()
    act()

    expect(toast()).toBeNull()
    expect(doc()).not.toBe(older)
    undoKey()
    expect(doc()).toBe(older)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  it('records the name typed into a freshly added port as its own step', () => {
    render(<App />)
    expandEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add a driving port' }))
    const added = doc()
    session(document.activeElement as HTMLElement, 'orders')

    undoKey()
    expect(doc()).toBe(added)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })
})

describe('Hexagonal editor field controls', () => {
  it('only the name and note of an item are text controls, so per-change steps can never fire per keystroke', () => {
    render(<App />)
    expandEditor()
    const cards = document.querySelectorAll('li.item[data-item-id]')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const texts = [...card.querySelectorAll('input, textarea')].map((el) => (el.matches('input.name') ? 'name' : el.tagName.toLowerCase()))
      expect(texts).toEqual(['name', 'textarea'])
    }
  })
})

describe('a field session cut short by unmounting', () => {
  it('is recorded when its item is removed without a blur', () => {
    render(<App />)
    expandEditor()
    const name = screen.getAllByLabelText('use case name')[0] as HTMLInputElement
        fireEvent.focus(name)
    fireEvent.change(name, { target: { value: 'Typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove use case Typed' }))

    undoKey()
    expect(screen.queryByText(/Undo isn't available/)).toBeNull()
    expect(doc()).toContain('Typed')
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  it('is recorded when the current hexagon changes without a blur', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    const pristine = doc()
    expandEditor()
    const name = screen.getAllByLabelText('use case name')[0]
    fireEvent.focus(name)
    fireEvent.change(name, { target: { value: 'Typed' } })
    act(() => useMapStore.getState().setFocus('h2'))

    undoKey()
    expect(screen.queryByText(/Undo isn't available/)).toBeNull()
    expect(doc()).toBe(pristine)
  })
})

describe('an add step absorbing its name', () => {
  it('trusts nothing beyond the name: a later untracked change still refuses Undo', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    fireEvent.pointerOver(container.querySelector('[data-band="domain"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    const input = container.querySelector<HTMLInputElement>('.ringed-inline-name')!
    fireEvent.blur(input)
    fireEvent.change(screen.getByLabelText('Diagram title'), { target: { value: 'Untracked' } })

    undoKey()
    expect(screen.getByText(/Undo isn't available/)).toBeTruthy()
    expect(useOnionStore.getState().map.title).toBe('Untracked')
  })
})

describe('Hexagonal stage edits', () => {
  const hover = (container: HTMLElement, layer: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${layer}"]`)!)
  const addUseCase = (container: HTMLElement) => {
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
  }

  it('records adding an item from the canvas "+" and naming it as one silent step', () => {
    const { container } = render(<App />)
    const older = recordOlderStep(container)
    addUseCase(container)
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'ShipOrder' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(toast()).toBeNull()
    expect(doc()).toContain('ShipOrder')
    undoKey()
    expect(doc()).toBe(older)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  it('leaves no step behind when the new item is cancelled', () => {
    const { container } = render(<App />)
    const older = recordOlderStep(container)
    addUseCase(container)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })

    expect(doc()).toBe(older)
    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })

  it('records removing an item from the canvas as one step', () => {
    const { container } = render(<App />)
    fireEvent.click(container.querySelector(`svg.canvas [data-ref="${EXAMPLE_DIAGRAM.useCases[0].id}"]`)!)
    fireEvent.keyDown(document.body, { key: 'Delete' })

    undoKey()
    expect(doc()).toBe(toHexa(toMap(EXAMPLE_DIAGRAM)))
  })
})

describe('Onion and Clean stage edits', () => {
  const open = (kind: 'Onion' | 'Clean') => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: kind }))
    return container
  }
  const hoverRing = (container: HTMLElement, role: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${role}"]`)!)
  const nameNewElement = (container: HTMLElement, name: string) => {
    const input = container.querySelector<HTMLInputElement>('.ringed-inline-name')!
    fireEvent.change(input, { target: { value: name } })
    fireEvent.blur(input)
  }

  it('records adding an Onion element from the canvas "+" and naming it as one step', () => {
    const container = open('Onion')
    const start = toHexa(useOnionStore.getState().map)
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    nameNewElement(container, 'Order')

    expect(useOnionStore.getState().map.elements[0].name).toBe('Order')
    undoKey()
    expect(toHexa(useOnionStore.getState().map)).toBe(start)
  })

  it('records adding a Clean sector from the canvas "+" as one step', () => {
    const container = open('Clean')
    const start = toHexa(useCleanStore.getState().map)
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add sector to Entities' }))

    undoKey()
    expect(toHexa(useCleanStore.getState().map)).toBe(start)
  })

  it('records adding a Clean element from the canvas "+" and naming it as one step', () => {
    const container = open('Clean')
    act(() => {
      useCleanStore.getState().addSector({ name: 'Orders', ringRole: 'domain' })
    })
    const start = toHexa(useCleanStore.getState().map)
    hoverRing(container, 'domain')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add element to Orders' })[0])
    nameNewElement(container, 'Order')

    expect(useCleanStore.getState().map.elements[0].name).toBe('Order')
    undoKey()
    expect(toHexa(useCleanStore.getState().map)).toBe(start)
  })
})

describe('the undo refusal gate stays a safety net', () => {
  it('never fires across a mix of field and discrete edits in every architecture', () => {
    const { container } = render(<App />)
    const pristine = doc()
    const hover = (layer: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${layer}"]`)!)
    const newDiagram = (kind: 'Onion' | 'Clean') => {
      fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
      fireEvent.click(screen.getByRole('button', { name: kind }))
    }
    const nameInline = (name: string) => {
      const input = container.querySelector<HTMLInputElement>('.ringed-inline-name')!
      fireEvent.change(input, { target: { value: name } })
      fireEvent.blur(input)
    }

    expandEditor()
    session(screen.getByLabelText('Map title'), 'Retitled')
    session(screen.getAllByLabelText('domain item name')[0], 'Renamed')
    fireEvent.click(screen.getByRole('button', { name: 'Add use case' }))
    fireEvent.change(screen.getAllByLabelText('Placement')[0], { target: { value: 'nw' } })
    hover('application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove use case / })[0])

    newDiagram('Onion')
    hover('domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an element to Domain Model' }))
    nameInline('Order')
    session(screen.getByLabelText('Diagram title'), 'Onion title')

    newDiagram('Clean')
    hover('domain')
    fireEvent.click(within(container.querySelector('main')!).getByRole('button', { name: 'Add sector to Entities' }))
    session(screen.getByLabelText('Diagram title'), 'Clean title')

    for (let i = 0; i < 40; i++) undoKey()

    expect(screen.queryByText(/Undo isn't available/)).toBeNull()
    expect(doc()).toBe(pristine)
    expect(useOnionStore.getState().map.elements).toEqual([])
  })
})
