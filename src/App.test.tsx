import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App, UNDO_LIMIT } from './App'
import { EXAMPLE_DIAGRAM, EXAMPLES, STRESS_DIAGRAM } from './model/example'
import { layoutDiagram } from './layout/layout'
import { layoutOnion } from './layout/onion'
import { layoutClean } from './layout/clean'

// Spies on the real implementation (never a stub) so every other test in this file still gets real layouts —
// only the two describes below ever inspect these mocks' own call counts.
vi.mock('./layout/onion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout/onion')>()
  return { ...actual, layoutOnion: vi.fn(actual.layoutOnion) }
})
vi.mock('./layout/clean', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout/clean')>()
  return { ...actual, layoutClean: vi.fn(actual.layoutClean) }
})
import { newCleanMap, newOnionMap, parseHexa, toHexa, toMap } from './model/hexa'
import { diagramOf, UNTITLED_HEXAGON } from './model/map'
import { autosave, MAP_KEY, useSaveFailed } from './model/persistence'
import { wireAutosave } from './model/autosaveWiring'
import { VERSION, type CleanFile, type HexaMap, type OnionFile } from './model/schema'
import { useMapStore } from './model/store'
import { useOnionStore } from './model/onionStore'
import { useCleanStore } from './model/cleanStore'
import { fileSlug } from './ui/exporters'
import { decodeSharePayload, encodeSharePayload, SHARE_HASH_PREFIX } from './ui/shareLink'
import { card, currentDiagram, hexGroup, installCompressionStreamPolyfill, installDialogPolyfill, linkedTwoHexMap, twoHexMap } from './test/fixtures'
import v1Minimal from './model/fixtures/v1-minimal.hexa?raw'
import v1Maximal from './model/fixtures/v1-maximal.hexa?raw'
import v2EmptyContext from './model/fixtures/v2-empty-context.hexa?raw'
import v2Honeycomb from './model/fixtures/v2-honeycomb.hexa?raw'
import v3OnionExample from './model/fixtures/v3-onion-example.hexa?raw'
import v4CleanExample from './model/fixtures/v4-clean-example.hexa?raw'

const scrollIntoView = vi.fn()

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // Every query matches: a narrow viewport, so the editor starts collapsed, yet the full toolbar (min-width query) —
  // its compact form is covered in Toolbar.test.tsx.
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = scrollIntoView
  // jsdom does not implement the Blob-URL APIs the download flow uses.
  URL.createObjectURL ??= vi.fn(() => 'blob:mock')
  URL.revokeObjectURL ??= vi.fn()
  installDialogPolyfill()
})
beforeEach(() => {
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
  scrollIntoView.mockClear()
})
afterEach(cleanup)

const onCanvas = (container: HTMLElement, ref: string) => container.querySelector(`svg.canvas [data-ref="${ref}"]`)!
// The stage's own live region is mounted (usually empty) from the start (F-07) and shares role="status" with
// the undo/status toast and the recovery notice, so a query for "the" status role must pick by class.
const toastEl = () => screen.queryAllByRole('status').find((el) => el.classList.contains('toast')) ?? null
const recoveryEl = () => screen.queryAllByRole('status').find((el) => el.classList.contains('notice')) ?? null

describe('double-click to edit', () => {
  const useCase = EXAMPLE_DIAGRAM.useCases[0]

  it('opens the collapsed editor at the use case card, flashes it and selects its name', () => {
    const { container } = render(<App />)
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)

    const notPrevented = fireEvent.doubleClick(onCanvas(container, useCase.id))

    expect(notPrevented).toBe(false)
    expect(screen.getByRole('button', { name: 'Collapse editor' })).toBeInstanceOf(HTMLButtonElement)
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

    const after = currentDiagram()
    expect(after.ports.some((p) => p.id === port.id)).toBe(false)
    expect(after.adapters.some((a) => a.portId === port.id)).toBe(false)
    expect(selected(container)).toEqual([])
    expect(toastEl()!.textContent).toContain(`Deleted ${port.name}`)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
  })

  it('deletes with Backspace too', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, useCase.id))
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(currentDiagram().useCases.some((u) => u.id === useCase.id)).toBe(false)
  })

  it('never deletes while typing in an editor field', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, useCase.id))
    const input = card(container, useCase.id).querySelector('input')!
    input.focus()
    fireEvent.keyDown(input, { key: 'Backspace' })
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
  })

  it('does nothing on a layer band', () => {
    const { container } = render(<App />)
    const band = container.querySelector<SVGElement>('[data-band="application"]')!
    fireEvent.click(band)
    band.focus()
    fireEvent.keyDown(band, { key: 'Delete' })
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
    expect(toastEl()).toBeNull()
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
  const hasUseCase = () => currentDiagram().useCases.some((u) => u.id === useCase.id)
  // The stage's own (usually empty) live region shares role="status" with the undo toast (F-07); the toast is
  // the one that carries the `.toast` class.
  const toast = () => screen.queryAllByRole('status').find((el) => el.classList.contains('toast')) ?? null

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('appears as a compact status row with Undo and a close button, and leaves after 6 s', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    const row = toast()!
    expect(row.getAttribute('aria-live')).toBe('polite')
    expect(row.classList.contains('toast')).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInstanceOf(HTMLButtonElement)
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInstanceOf(HTMLButtonElement)

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

  const deleteRef = (container: HTMLElement, ref: string) => {
    fireEvent.click(onCanvas(container, ref))
    fireEvent.keyDown(document.body, { key: 'Delete' })
  }
  const waitOutToast = () => {
    act(() => vi.advanceTimersByTime(6000))
    act(() => vi.advanceTimersByTime(150))
  }
  const undoKey = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'z', ctrlKey: true })

  it('steps back through several edits with Ctrl+Z after every toast is gone', () => {
    const { container } = render(<App />)
    const [first, second] = [EXAMPLE_DIAGRAM.adapters[0].id, EXAMPLE_DIAGRAM.adapters[1].id]
    const present = (id: string) => currentDiagram().adapters.some((a) => a.id === id)
    deleteRef(container, first)
    deleteRef(container, second)
    waitOutToast()
    expect(toast()).toBeNull()

    undoKey()
    expect(present(second)).toBe(true)
    expect(present(first)).toBe(false)
    undoKey()
    expect(present(first)).toBe(true)
  })

  it('shares one stack between the toast Undo button and the shortcut', () => {
    const { container } = render(<App />)
    const [first, second] = [EXAMPLE_DIAGRAM.adapters[0].id, EXAMPLE_DIAGRAM.adapters[1].id]
    const present = (id: string) => currentDiagram().adapters.some((a) => a.id === id)
    deleteRef(container, first)
    deleteRef(container, second)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(present(second)).toBe(true)
    expect(present(first)).toBe(false)
    undoKey()
    expect(present(first)).toBe(true)
  })

  it('drops the toast when the shortcut undoes the edit it reports', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    undoKey()
    expect(toast()).toBeNull()
  })

  it('remembers only the last 20 edits', () => {
    useMapStore.getState().replace(toMap(STRESS_DIAGRAM))
    const { container } = render(<App />)
    const { domain, useCases, ports, adapters, actors, externals } = STRESS_DIAGRAM
    const refs = [domain, useCases, ports, adapters, actors, externals].flatMap((items) => items.map((i) => i.id))
    expect(refs.length).toBeGreaterThan(UNDO_LIMIT + 1)
    const deleted = refs.slice(0, UNDO_LIMIT + 1)
    for (const ref of deleted) deleteRef(container, ref)
    for (let i = 0; i < UNDO_LIMIT + 5; i++) undoKey()
    const remaining = new Set(Array.from(container.querySelectorAll('svg.canvas [data-ref]'), (el) => el.getAttribute('data-ref')))
    expect(remaining.has(deleted[0])).toBe(false)
    expect(remaining.has(deleted[1])).toBe(true)
  })

  it('undoes across a document swap back into the previous kind', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: /Onion/ }))
    expect(useOnionStore.getState().map.title).toBe('Untitled architecture')
    undoKey()
    expect(hasUseCase()).toBe(false)
    undoKey()
    expect(hasUseCase()).toBe(true)
  })

  it('refuses to undo once an unrecorded edit touched the document, and keeps that edit', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    fireEvent.change(screen.getByLabelText('Map title'), { target: { value: 'Retitled' } })
    undoKey()
    expect(useMapStore.getState().map.title).toBe('Retitled')
    expect(hasUseCase()).toBe(false)
    undoKey()
    expect(hasUseCase()).toBe(false)
  })

  const rename = (title: string) => {
    const field = screen.getByLabelText('Diagram title')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: title } })
    fireEvent.blur(field)
  }
  const titleOf = (kind: 'Onion' | 'Clean') => (kind === 'Onion' ? useOnionStore : useCleanStore).getState().map.title

  it.each(['Onion', 'Clean'] as const)('steps back through several %s edits under the undo gate', (kind) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: kind }))
    rename('First')
    rename('Second')
    waitOutToast()
    undoKey()
    expect(titleOf(kind)).toBe('First')
    undoKey()
    expect(titleOf(kind)).toBe('Untitled architecture')
  })

  it.each(['Overview', 'Detailed'])('keeps the history when the view switches to %s without an edit', (view) => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(screen.getByRole('radio', { name: view === 'Overview' ? 'Detailed' : 'Overview' }))
    fireEvent.click(screen.getByRole('radio', { name: view }))
    undoKey()
    expect(hasUseCase()).toBe(true)
  })

  it('keeps the history when an element is only selected, not edited', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.adapters[0].id))
    undoKey()
    expect(hasUseCase()).toBe(true)
  })

  it.each(['Onion', 'Clean'] as const)('keeps the %s history when the view switches without an edit', (kind) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: kind }))
    rename('Renamed')
    waitOutToast()
    fireEvent.click(screen.getByRole('radio', { name: 'Overview' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Detailed' }))
    undoKey()
    expect(titleOf(kind)).toBe('Untitled architecture')
  })

  it('undoes an edit made after a cross-kind swap, then the swap, then the edit before it', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    rename('Renamed')
    waitOutToast()
    undoKey()
    expect(titleOf('Onion')).toBe('Untitled architecture')
    undoKey()
    expect(hasUseCase()).toBe(false)
    undoKey()
    expect(hasUseCase()).toBe(true)
  })

  it('never steps back past an unrecorded edit into older history', () => {
    const { container } = render(<App />)
    const [first, second] = [EXAMPLE_DIAGRAM.adapters[0].id, EXAMPLE_DIAGRAM.adapters[1].id]
    const present = (id: string) => currentDiagram().adapters.some((a) => a.id === id)
    deleteRef(container, first)
    waitOutToast()
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    fireEvent.change(screen.getByLabelText('Map title'), { target: { value: 'Retitled' } })
    deleteRef(container, second)
    undoKey()
    expect(present(second)).toBe(true)
    undoKey()
    expect(useMapStore.getState().map.title).toBe('Retitled')
    expect(present(first)).toBe(false)
  })

  it('leaves Ctrl+Z to an open menu', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    fireEvent.click(container.ownerDocument.querySelector('[aria-haspopup="menu"]')!)
    expect(screen.getByRole('menu')).toBeTruthy()
    undoKey()
    expect(hasUseCase()).toBe(false)
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

  it('leaves Cmd+Z to the field while typing in an input after the toast is gone', () => {
    const { container } = render(<App />)
    deleteUseCase(container)
    waitOutToast()
    const input = container.querySelector<HTMLInputElement>('.editor input')!
    input.focus()
    undoKey(input)
    expect(hasUseCase()).toBe(false)
  })

  it('keeps an error notice in the fuller layout, without a countdown', async () => {
    render(<App />)
    const file = new File(['{ nope'], 'broken.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
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
  it('labels New, Example and Open with text, and groups the export formats under one Export label', () => {
    render(<App />)
    for (const [name, text] of [['New diagram', 'New'], ['Load an example', 'Example'], ['Open a .hexa file, replacing the map', 'Open…']]) {
      const control = screen.getByLabelText(name)
      expect(control.closest('.icon-button, .tool')!.textContent).toContain(text)
    }
    const group = screen.getByRole('group', { name: 'Export' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['.hexa', 'SVG', 'PNG'])
    expect(group.querySelector('svg')).toBeNull()
  })

  it('links to the source repository in a new tab', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: 'View the source on GitHub' })
    expect(link.getAttribute('href')).toBe('https://github.com/Hyperxq/domainrings')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    expect(link.closest('.toolbar')).not.toBeNull()
    expect(link.querySelector('svg.icon-solid')).not.toBeNull()
  })
})

// The learning path (project/pending-changes/ringed-examples-readme): 3 architectures x 3 levels each, grouped
// by architecture in the menu and loaded through the same parseHexa path a user's Open… takes.
describe('the Example menu — learning path (CANVAS-01/02/04, FOCUS-02)', () => {
  const pickExample = (value: string) => fireEvent.change(screen.getByLabelText('Load an example'), { target: { value } })

  it('groups the menu into 3 architectures of 3 levels each, in basic/stress/advanced order', () => {
    render(<App />)
    const select = screen.getByLabelText('Load an example') as HTMLSelectElement
    const groups = Array.from(select.querySelectorAll('optgroup'))
    expect(groups.map((g) => g.label)).toEqual(['Hexagonal', 'Onion', 'Clean'])
    for (const group of groups) expect(group.querySelectorAll('option')).toHaveLength(3)
  })

  for (const example of EXAMPLES) {
    it(`loading "${example.label}" shows the ${example.architecture} view and its own title`, () => {
      const { container } = render(<App />)
      const option = screen.getByRole('option', { name: example.label }) as HTMLOptionElement

      pickExample(option.value)

      expect(toastEl()!.textContent).toContain(`Loaded the ${example.label} example.`)
      if (example.architecture === 'Hexagonal') {
        expect(useMapStore.getState().map.kind).toBe('hexagonal')
        expect(container.querySelectorAll('svg.canvas [data-hex]').length).toBeGreaterThan(0)
      } else {
        expect(container.querySelector('svg.canvas')!.getAttribute('aria-label')).toBe(example.label)
      }
    })
  }

  it('renders the Hexagonal advanced example as several bounded contexts, non-overlapping, connected by links', () => {
    const { container } = render(<App />)
    const option = screen.getByRole('option', { name: 'E-commerce — Hexagonal (advanced)' }) as HTMLOptionElement
    pickExample(option.value)

    const groups = container.querySelectorAll('svg.canvas [data-hex]')
    expect(groups).toHaveLength(4)
    expect(container.querySelectorAll('svg.canvas [data-map-link]').length).toBeGreaterThan(0)
    // jsdom's getBoundingClientRect is a zero-box stub; the real non-overlap guarantee is proven at the layout
    // level (layout/map.test.ts CANVAS-01.1). Here we only pin that every hexagon renders as its own distinct
    // group with its own transform, which is what the DOM identity contract (SEAM-05) actually promises.
    const transforms = new Set(Array.from(groups).map((g) => g.getAttribute('transform')))
    expect(transforms.size).toBe(groups.length)
  })

  it('Undo after loading an example restores the previous document', () => {
    render(<App />)
    const before = useMapStore.getState().map
    const option = screen.getByRole('option', { name: 'Stress test' }) as HTMLOptionElement

    pickExample(option.value)
    expect(useMapStore.getState().map).not.toBe(before)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map).toBe(before)
  })
})

describe('refused imports leave the current map untouched (MIG-02, MIG-03)', () => {
  it('refuses a structurally invalid v2 file, naming the reason, without touching the current map', async () => {
    render(<App />)
    const before = useMapStore.getState().map
    const broken = JSON.stringify({ app: 'domainrings', version: 2, kind: 'hexagonal', title: 'Bad', contexts: [{ id: 'c1' }], hexagons: [], links: [] })
    const file = new File([broken], 'broken.hexa', { type: 'application/json' })

    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.getByRole('alert').textContent).toContain('broken.hexa could not be opened')
  })

  it('refuses a file made by a newer version, naming it as newer rather than damaged, without touching the current map', async () => {
    render(<App />)
    const before = useMapStore.getState().map
    const newer = JSON.stringify({ app: 'domainrings', version: 99 })
    const file = new File([newer], 'future.hexa', { type: 'application/json' })

    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })

    expect(useMapStore.getState().map).toBe(before)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('future.hexa was made by a newer version of domainrings.')
    expect(alert.textContent).toMatch(/newer version/)
    expect(alert.textContent).not.toMatch(/damaged/)
    expect(alert.textContent).not.toContain('Fix these problems')
  })
})

describe('notices never overlap', () => {
  it('stacks the recovery and error notices as siblings in one positioned column instead of overlapping', async () => {
    render(<App boot={{ recovery: 'kept', unreadableText: '{not valid json' }} />)
    const broken = JSON.stringify({ app: 'domainrings', version: 2, kind: 'hexagonal', title: 'Bad', contexts: [{ id: 'c1' }], hexagons: [], links: [] })
    const file = new File([broken], 'broken.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })

    const recovery = recoveryEl()!
    const error = screen.getByRole('alert')
    expect(error.textContent).not.toContain(recovery.textContent)
    const column = recovery.closest('.notices')
    expect(column).not.toBeNull()
    expect(error.closest('.notices')).toBe(column)
    expect([...column!.children]).toEqual([error, recovery])
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
    useMapStore.getState().replace(toMap({ ...EXAMPLE_DIAGRAM, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }))
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

describe('appearance menu', () => {
  const root = document.documentElement
  const choose = (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
  }
  const checked = (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    const state = screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    return state
  }

  afterEach(() => {
    delete root.dataset.theme
    delete root.dataset.palette
    localStorage.removeItem('domainrings:theme')
    localStorage.removeItem('domainrings:palette')
  })

  it('starts from what the boot script applied to the document', () => {
    root.dataset.theme = 'light'
    root.dataset.palette = 'moss'
    render(<App />)
    expect(checked(/^Light/)).toBe('true')
    expect(checked(/^Moss/)).toBe('true')
  })

  it('choosing Dark sets data-theme and remembers it', () => {
    render(<App />)
    choose(/^Dark/)
    expect(root.dataset.theme).toBe('dark')
    expect(localStorage.getItem('domainrings:theme')).toBe('dark')
    expect(checked(/^Dark/)).toBe('true')
  })

  it('choosing System drops both the attribute and the stored theme, so the OS decides again', () => {
    root.dataset.theme = 'light'
    localStorage.setItem('domainrings:theme', 'light')
    render(<App />)
    choose(/^System/)
    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('domainrings:theme')).toBeNull()
    expect(checked(/^System/)).toBe('true')
  })

  it('choosing a palette sets data-palette and remembers it; Default drops both', () => {
    render(<App />)
    choose(/^Ink/)
    expect(root.dataset.palette).toBe('ink')
    expect(localStorage.getItem('domainrings:palette')).toBe('ink')
    expect(checked(/^Ink/)).toBe('true')

    choose(/^Default/)
    expect(root.dataset.palette).toBeUndefined()
    expect(localStorage.getItem('domainrings:palette')).toBeNull()
    expect(checked(/^Default/)).toBe('true')
  })
})

describe('linking on the canvas', () => {
  const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
  const current = EXAMPLE_DIAGRAM.ports.find((p) => p.id === adapter.portId)!
  const others = EXAMPLE_DIAGRAM.ports.filter((p) => p.side === 'driven' && p.id !== current.id)
  const svgOf = (container: HTMLElement) => container.querySelector('svg.canvas')!
  const targets = (container: HTMLElement) => [...new Set([...container.querySelectorAll('svg.canvas [data-link-target]')].map((n) => n.getAttribute('data-ref')))]
  const linking = (container: HTMLElement) => svgOf(container).hasAttribute('data-link-mode')
  const startWithL = (container: HTMLElement) => {
    fireEvent.click(onCanvas(container, adapter.id))
    fireEvent.keyDown(document.body, { key: 'l' })
  }

  it('offers a "Link to…" chip for a selection that can link, and none for a use case', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, adapter.id))
    expect(screen.getByRole('button', { name: `Link ${adapter.name} to…` })).toBeInstanceOf(HTMLButtonElement)
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.useCases[0].id))
    expect(screen.queryByRole('button', { name: /^Link .* to…$/ })).toBeNull()
  })

  it('enters link mode with L: only the valid targets are marked, and a hint says what to do', () => {
    const { container } = render(<App />)
    startWithL(container)
    expect(linking(container)).toBe(true)
    expect(targets(container).sort()).toEqual(others.map((p) => p.id).sort())
    expect(toastEl()!.textContent).toContain(`Choose a target for ${adapter.name} · Esc to cancel`)
  })

  it('hangs the chip off the port box, not off the port\'s declaration in the domain', () => {
    // A driven port is laid out twice under one ref: its `driven-ports/` declaration in the domain and the box on the wall.
    const port = STRESS_DIAGRAM.ports.find((p) => p.side === 'driven')!
    act(() => useMapStore.getState().restore({ map: toMap(STRESS_DIAGRAM), focus: toMap(STRESS_DIAGRAM).hexagons[0].id }))
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, port.id))
    const chip = screen.getByRole('button', { name: `Link ${port.name} to…` })
    const stage = container.querySelector<HTMLElement>('main.stage')!.style
    const scale = parseFloat(stage.backgroundSize) / 20
    const toScreenX = (x: number) => x * scale + parseFloat(stage.backgroundPosition)
    const nodes = layoutDiagram(STRESS_DIAGRAM).nodes.filter((n) => n.ref === port.id)
    const box = nodes.find((n) => n.kind === 'port')!
    const declaration = nodes.find((n) => n.kind === 'portDecl')!
    const left = parseFloat(chip.style.left)
    expect(Math.abs(left - toScreenX(box.x))).toBeLessThan(box.width * scale)
    expect(Math.abs(left - toScreenX(declaration.x))).toBeGreaterThan(box.width * scale)
  })

  it('enters link mode from the chip too', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, adapter.id))
    fireEvent.click(screen.getByRole('button', { name: `Link ${adapter.name} to…` }))
    expect(linking(container)).toBe(true)
  })

  it('links on a click on a target, keeps the source selected, and Undo puts the old link back', () => {
    const { container } = render(<App />)
    startWithL(container)
    fireEvent.click(onCanvas(container, others[0].id))
    expect(currentDiagram().adapters.find((a) => a.id === adapter.id)!.portId).toBe(others[0].id)
    expect(linking(container)).toBe(false)
    expect(onCanvas(container, adapter.id).hasAttribute('data-selected')).toBe(true)
    expect(toastEl()!.textContent).toContain(`Linked ${adapter.name} → ${others[0].name}`)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
  })

  it('cancels on Esc without changing anything', () => {
    const { container } = render(<App />)
    startWithL(container)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(linking(container)).toBe(false)
    expect(targets(container)).toEqual([])
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
  })

  it('cancels on a click on anything that is not a target', () => {
    const { container } = render(<App />)
    startWithL(container)
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.useCases[0].id))
    expect(linking(container)).toBe(false)
    expect(currentDiagram()).toEqual(EXAMPLE_DIAGRAM)
  })

  it('ignores L while typing in a field', () => {
    const { container } = render(<App />)
    fireEvent.click(onCanvas(container, adapter.id))
    const input = container.querySelector<HTMLInputElement>('.editor input')!
    input.focus()
    fireEvent.keyDown(input, { key: 'l' })
    expect(linking(container)).toBe(false)
  })
})

// twoHexMap's two hexagons each carry the EXAMPLE_DIAGRAM shape: h1's driven ports (p-repo, p-notify, p-users)
// and driving port (p-submit) collide by id with h2's own — the exact scenario crossHexagonPorts' hexagonId-keyed
// pairing (not bare ref) must survive (REQ-LNK-01, REQ-LNK-01.2, ADR-02).
describe('Links: create from either entry point (REQ-LNK-01, REQ-LNK-01.2, ADR-02)', () => {
  it('creates an identical link whether started from the canvas chip or the Links section, and Undo restores either', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)

    // Entry point 1: the canvas "Link to…" chip, starting from a driven port on h1.
    fireEvent.click(onCanvas(container, 'p-repo'))
    fireEvent.keyDown(document.body, { key: 'l' })
    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-submit"]')!)

    expect(useMapStore.getState().map.links).toHaveLength(1)
    const canvasLink = useMapStore.getState().map.links[0]
    expect(canvasLink).toMatchObject({ from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } })
    expect(toastEl()!.querySelector('p')!.textContent).toBe('Linked Chat feedback slice · FeedbackRepository → Second slice · submitChatFeedback.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map.links).toEqual([])

    // Entry point 2: the Links editor section's own create form.
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    fireEvent.change(screen.getByLabelText('Driven port'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Driving port'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))

    expect(useMapStore.getState().map.links).toHaveLength(1)
    const editorLink = useMapStore.getState().map.links[0]
    expect({ from: editorLink.from, to: editorLink.to }).toStrictEqual({ from: canvasLink.from, to: canvasLink.to })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map.links).toEqual([])
  })

  it('creates the driven→driving link when the canvas chip is started from the driving end (REQ-LNK-01.1b)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)

    fireEvent.click(onCanvas(container, 'p-submit'))
    fireEvent.keyDown(document.body, { key: 'l' })
    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-repo"]')!)

    expect(useMapStore.getState().map.links).toEqual([{ id: 'link1', from: { hexagonId: 'h2', portId: 'p-repo' }, to: { hexagonId: 'h1', portId: 'p-submit' } }])
  })
})

describe('Links: edit and delete from the Links section (REQ-LNK-02, REQ-LNK-04)', () => {
  it('editing an end’s adapter shows an undo toast, and Undo restores the exact previous map (REQ-LNK-02.1, 02.3)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    render(<App />)
    const beforeEdit = useMapStore.getState().map
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))

    fireEvent.change(screen.getByLabelText('Driven port adapter'), { target: { value: 'a-knex' } })

    expect(useMapStore.getState().map.links[0].from.adapterId).toBe('a-knex')
    expect(toastEl()!.textContent).toMatch(/^Updated the link /)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(beforeEdit)
  })

  it('deleting a link shows an undo toast and removes it from the canvas; Undo restores it with its original ends and adapter (REQ-LNK-04.1, 04.2)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = render(<App />)
    const beforeDelete = useMapStore.getState().map
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))

    fireEvent.click(screen.getByRole('button', { name: /Delete link/ }))

    expect(useMapStore.getState().map.links).toEqual([])
    expect(container.querySelectorAll('svg.canvas [data-map-link]')).toHaveLength(0)
    expect(toastEl()!.textContent).toMatch(/^Deleted the link /)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(beforeDelete)
    expect(container.querySelectorAll('svg.canvas [data-map-link]')).toHaveLength(1)
  })
})

describe('current hexagon (FOCUS-03, FOCUS-06)', () => {
  it('double-clicking a non-current hexagon focuses it and puts the caret in its Hexagon title field (FOCUS-03.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)

    fireEvent.doubleClick(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    const input = document.activeElement as HTMLInputElement
    expect(card(container, 'hexagon').contains(input)).toBe(true)
    expect(input.value).toBe('Second slice')
  })

  it('a real double-click gesture (click, click, dblclick) on a non-current hexagon reveals the Hexagon title field, not the item under the pointer (FOCUS-03.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)
    const target = hexGroup(container, 'h2').querySelector('.node[data-ref]')!

    fireEvent.click(target, { detail: 1 })
    fireEvent.click(target, { detail: 2 })
    fireEvent.doubleClick(target)

    expect(useMapStore.getState().focus).toBe('h2')
    const input = screen.getByLabelText('Hexagon title') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Second slice')
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
  })

  it('undo restores both the map and whichever hexagon was current at edit time (FOCUS-06.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)
    const beforeEdit = useMapStore.getState().map
    const useCase = EXAMPLE_DIAGRAM.useCases[0]

    fireEvent.click(onCanvas(container, useCase.id))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(diagramOf(useMapStore.getState().map, 'h1').useCases.some((u) => u.id === useCase.id)).toBe(false)

    fireEvent.click(hexGroup(container, 'h2'))
    expect(useMapStore.getState().focus).toBe('h2')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(beforeEdit)
    expect(useMapStore.getState().focus).toBe('h1')
  })

  it('undoing a swap clears a stale selection left on the hexagon that comes back current, so Delete has nothing to act on (FOCUS-06.2)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)
    fireEvent.click(hexGroup(container, 'h2'))
    expect(useMapStore.getState().focus).toBe('h2')
    const useCase = EXAMPLE_DIAGRAM.useCases[0]
    fireEvent.click(hexGroup(container, 'h2').querySelector(`[data-ref="${useCase.id}"]`)!)
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(diagramOf(useMapStore.getState().map, 'h2').useCases.some((u) => u.id === useCase.id)).toBe(true)
  })
})

describe('link pruning (LINK-01, LINK-02)', () => {
  it('deleting the linked port removes the link, shows the deletion toast naming both, and Undo restores port + link + focus (LINK-01.1, 01.5)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = render(<App />)
    const beforeEdit = useMapStore.getState().map

    fireEvent.click(onCanvas(container, 'p-repo'))
    fireEvent.keyDown(document.body, { key: 'Delete' })

    expect(useMapStore.getState().map.links).toEqual([])
    expect(toastEl()!.querySelector('p')!.textContent).toBe('Deleted FeedbackRepository and its link to Second slice.')

    fireEvent.click(hexGroup(container, 'h2'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(beforeEdit)
    expect(useMapStore.getState().focus).toBe('h1')
  })

  it('moving the linked port to the other side removes the link and shows the move toast (LINK-01.2)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const select = container.querySelector(`[data-item-id="p-repo"] select`) as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'driving' } })

    expect(useMapStore.getState().map.links).toEqual([])
    expect(toastEl()!.querySelector('p')!.textContent).toBe('Moved FeedbackRepository and removed its link to Second slice.')
  })

  it('the map link never responds to hover, click, double-click or Delete (LINK-02.1)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = render(<App />)
    const line = container.querySelector('svg.canvas [data-map-link]')!
    const selectedRefs = () => [...container.querySelectorAll('svg.canvas [data-selected]')].map((n) => n.getAttribute('data-ref'))
    const useCase = EXAMPLE_DIAGRAM.useCases[0]

    fireEvent.click(onCanvas(container, useCase.id))
    expect(selectedRefs()).toEqual([useCase.id])

    fireEvent.pointerOver(line)
    expect(hexGroup(container, 'h1').hasAttribute('data-hover')).toBe(false)

    fireEvent.click(line)
    expect(selectedRefs()).toEqual([useCase.id])

    fireEvent.doubleClick(line)
    screen.getByRole('button', { name: 'Expand editor' })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(selectedRefs()).toEqual([])
    const beforeMap = useMapStore.getState().map

    fireEvent.click(line)
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(useMapStore.getState().map).toBe(beforeMap)
  })
})

describe('autosave failure notice', () => {
  afterEach(() => useSaveFailed.setState({ failed: false }))

  it('tells the author their latest changes may not be saved, and that the next successful save clears it', () => {
    useSaveFailed.setState({ failed: true })
    render(<App />)
    const notice = recoveryEl()!
    expect(notice.textContent).toContain("latest changes couldn't be saved")
    expect(notice.textContent).toContain('next successful save')
    expect(notice.closest('.notices')).not.toBeNull()
  })

  it('clears once a save succeeds', () => {
    useSaveFailed.setState({ failed: true })
    render(<App />)
    act(() => useSaveFailed.setState({ failed: false }))
    expect(recoveryEl()).toBeNull()
  })

  it('shows nothing while saves succeed', () => {
    render(<App />)
    expect(recoveryEl()).toBeNull()
  })

  describe('through the real boot wiring', () => {
    afterEach(() => vi.useRealTimers())

    it('shows the notice when a storage write throws after an edit', () => {
      vi.useFakeTimers()
      const storage = { setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError') }) }
      onTestFinished(wireAutosave(storage as unknown as Storage, 'none'))
      render(<App />)
      expect(recoveryEl()).toBeNull()
      act(() => useMapStore.getState().setMapMeta({ title: 'Edited' }))
      act(() => vi.advanceTimersByTime(1000))
      expect(recoveryEl()!.textContent).toContain("latest changes couldn't be saved")
    })

    it.each([
      ['no storage', undefined],
      ['a storage that throws', { setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }],
    ])('leaves no save-failed flag behind once disposed with %s', (_, storage) => {
      vi.useFakeTimers()
      const dispose = wireAutosave(storage as unknown as Storage | undefined, 'none')
      act(() => useMapStore.getState().setMapMeta({ title: 'Edited' }))
      act(() => vi.advanceTimersByTime(1000))
      expect(useSaveFailed.getState().failed).toBe(true)
      dispose()
      expect(useSaveFailed.getState().failed).toBe(false)
    })

    it('shows the notice again when re-wired without storage after a dispose', () => {
      wireAutosave(undefined, 'none')()
      expect(useSaveFailed.getState().failed).toBe(false)
      onTestFinished(wireAutosave(undefined, 'none'))
      expect(useSaveFailed.getState().failed).toBe(true)
    })

    it('shows the notice from the start when the browser gives no storage at all', () => {
      onTestFinished(wireAutosave(undefined, 'none'))
      render(<App />)
      expect(recoveryEl()!.textContent).toContain("latest changes couldn't be saved")
    })
  })
})

describe('boot recovery notice', () => {
  const KEPT_MESSAGE = "Your last session couldn't be restored, so the example is open. Your saved work is kept in this browser; nothing was deleted."
  const NOT_KEPT_MESSAGE = "Your last session couldn't be restored and a copy couldn't be kept, so autosave is off."

  it('does not show a notice on an ordinary boot', () => {
    render(<App />)
    expect(screen.queryByText(KEPT_MESSAGE)).toBeNull()
    expect(screen.queryByText(NOT_KEPT_MESSAGE)).toBeNull()
  })

  it('shows the kept-copy notice as a status region, with a working Download saved copy action', async () => {
    render(<App boot={{ recovery: 'kept', unreadableText: '{not valid json' }} />)
    const status = recoveryEl()!
    expect(status.querySelector('p')!.textContent).toBe(KEPT_MESSAGE)

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Download saved copy' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toMatch(/\.hexa$/)
    expect(await captured!.text()).toBe('{not valid json')

    createSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('shows the not-kept notice with no download action', () => {
    render(<App boot={{ recovery: 'not-kept' }} />)
    expect(recoveryEl()!.textContent).toBe(NOT_KEPT_MESSAGE)
    expect(screen.queryByRole('button', { name: 'Download saved copy' })).toBeNull()
  })

  it('stays on screen until dismissed, unlike an ordinary status toast', () => {
    vi.useFakeTimers()
    render(<App boot={{ recovery: 'kept', unreadableText: '{x' }} />)
    act(() => vi.advanceTimersByTime(20000))
    expect(recoveryEl()!.textContent).toContain(KEPT_MESSAGE)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(recoveryEl()).toBeNull()
    vi.useRealTimers()
  })

  it('keeps the recovery notice on screen through a later status toast and starting a link (REQ-03.2)', () => {
    const { container } = render(<App boot={{ recovery: 'kept', unreadableText: '{x' }} />)
    expect(screen.getByRole('button', { name: 'Download saved copy' })).toBeInstanceOf(HTMLButtonElement)

    // An ordinary status toast (here: an edit) must not replace the recovery notice.
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.useCases[0].id))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(screen.getByRole('button', { name: 'Download saved copy' })).toBeInstanceOf(HTMLButtonElement)

    // Starting a link — the other path that used to clear any non-error notice — must not clear it either.
    const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
    fireEvent.click(onCanvas(container, adapter.id))
    fireEvent.keyDown(document.body, { key: 'l' })
    const recoverySection = screen.getByRole('button', { name: 'Download saved copy' }).closest('section')!
    expect(recoverySection).toBe(recoveryEl())

    fireEvent.click(recoverySection.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!)
    expect(screen.queryByRole('button', { name: 'Download saved copy' })).toBeNull()
  })
})

describe('export scope (EXPORT-03)', () => {

  it('hides the Export scope choice on a single-hexagon map', () => {
    render(<App />)
    expect(screen.queryByRole('group', { name: 'Export scope' })).toBeNull()
  })

  it('shows the Export scope choice, defaulted to Map, on a multi-hexagon map', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    expect((screen.getByRole('radio', { name: 'Map' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Hexagon' }) as HTMLInputElement).checked).toBe(false)
  })

  it('always saves the whole map as .hexa, regardless of the chosen export scope', async () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save as .hexa file' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toMatch(/\.hexa$/)
    const parsed = JSON.parse(await captured!.text())
    expect(parsed.hexagons).toHaveLength(2)

    createSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('names the .hexa file after the map title, even when it differs from the current hexagon title (pin — App.tsx exportAs line 160)', () => {
    render(<App />)
    const mapTitleInput = screen.getByLabelText('Map title') as HTMLInputElement

    fireEvent.change(mapTitleInput, { target: { value: 'Renamed whole map' } })

    expect(useMapStore.getState().map.title).toBe('Renamed whole map')
    expect(currentDiagram().title).toBe(EXAMPLE_DIAGRAM.title)

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock')
    fireEvent.click(screen.getByRole('button', { name: 'Save as .hexa file' }))

    expect((clickSpy.mock.instances[0] as HTMLAnchorElement).download).toBe(`${fileSlug('Renamed whole map')}.hexa`)
    createSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('anchors the legend to the current hexagon, not always the first, on screen and in a hexagon-scope export (EXPORT-02)', async () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<App />)
    const translateOf = (el: Element) => {
      const [, x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(el.getAttribute('transform')!)!
      return { x: Number(x), y: Number(y) }
    }
    const legendTranslate = () => translateOf(container.querySelector('svg.canvas [data-legend]')!)

    // On screen: switching the current hexagon must move the legend by the same amount the hexagons
    // themselves are shifted apart — anchoring it under h1 forever would leave it stuck in place.
    const legendUnderH1 = legendTranslate()
    fireEvent.click(hexGroup(container, 'h2'))
    expect(useMapStore.getState().focus).toBe('h2')
    const legendUnderH2 = legendTranslate()
    const centreShift = translateOf(hexGroup(container, 'h2')).x - translateOf(hexGroup(container, 'h1')).x
    expect(centreShift).toBeGreaterThan(0)
    expect(legendUnderH2.x - legendUnderH1.x).toBeCloseTo(centreShift, 5)

    // In a hexagon-scope export, the legend must lie inside the exported frame, not the first hexagon's.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const markup = await captured!.text()
    const [, vxStr, vyStr, vwStr, vhStr] = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(markup)!
    const viewBox = { x: Number(vxStr), y: Number(vyStr), width: Number(vwStr), height: Number(vhStr) }
    const [, lxStr, lyStr] = /<g[^>]*data-legend[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)"/.exec(markup)!
    const legendInExport = { x: Number(lxStr), y: Number(lyStr) }

    expect(legendInExport.x).toBeGreaterThanOrEqual(viewBox.x)
    expect(legendInExport.x).toBeLessThanOrEqual(viewBox.x + viewBox.width)
    expect(legendInExport.y).toBeGreaterThanOrEqual(viewBox.y)
    expect(legendInExport.y).toBeLessThanOrEqual(viewBox.y + viewBox.height)

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports only the current hexagon (scope Hexagon) or the whole map (scope Map), each with its own title (EXPORT-01/02)', async () => {
    useMapStore.getState().replace({ ...twoHexMap(), title: 'Whole map title' })
    render(<App />)
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    const viewBoxWidth = (markup: string) => Number(/viewBox="[-\d.]+ [-\d.]+ ([-\d.]+) /.exec(markup)![1])

    // Scope defaults to Map, current hexagon (h1) unchanged: both hexagons' own headings should appear.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const mapMarkup = await captured!.text()
    expect(mapMarkup).toContain('Second slice') // h2's own heading — proves the whole map, not just h1, was exported
    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug('Whole map title')}.svg` })

    // Switch to Hexagon scope: only h1 (the current hexagon) should export, under its OWN title/filename.
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const hexMarkup = await captured!.text()
    expect(hexMarkup).not.toContain('Second slice')
    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug(EXAMPLE_DIAGRAM.title)}.svg` })
    expect(viewBoxWidth(hexMarkup)).toBeLessThan(viewBoxWidth(mapMarkup))

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports a real two-context render: hulls and chips kept in Map scope, dropped in Hexagon scope (EXPORT-03)', async () => {
    const result = parseHexa(v2Honeycomb)
    if (!result.ok || result.map.kind !== 'hexagonal') throw new Error('fixture failed to parse')
    useMapStore.getState().replace(result.map)
    // Real CSS, not jsdom's unstyled defaults, so a hull path's stroke-dasharray actually reaches the export —
    // the same technique exporters.test.ts uses for its own CSS-dependent assertions.
    const styleTag = document.createElement('style')
    styleTag.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    document.head.appendChild(styleTag)
    onTestFinished(() => styleTag.remove())
    render(<App />)
    expect(document.querySelectorAll('svg.canvas [data-hull]').length).toBe(2)

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    onTestFinished(() => void vi.unstubAllGlobals())
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    onTestFinished(() => clickSpy.mockRestore())
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    onTestFinished(() => createSpy.mockRestore())
    // A hull path carries both fill-rule="evenodd" (also true of a hexagon's own ring paths) AND the hull's own
    // dashed stroke — only the combination is unique to a hull once class/data-hull are stripped on export.
    const hullPathCount = (markup: string) =>
      (markup.match(/<path[^>]*>/g) ?? []).filter((p) => p.includes('fill-rule="evenodd"') && p.includes('stroke-dasharray="4 4"')).length

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const mapMarkup = await captured!.text()
    expect(mapMarkup).toContain('>Core<')
    expect(mapMarkup).toContain('>Context 2<')
    expect(hullPathCount(mapMarkup)).toBeGreaterThanOrEqual(2)
    expect(mapMarkup).not.toMatch(/data-hull|data-chip|data-hulls|data-legend/)

    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const hexMarkup = await captured!.text()
    expect(hexMarkup).not.toContain('>Core<')
    expect(hexMarkup).not.toContain('>Context 2<')
    expect(hullPathCount(hexMarkup)).toBe(0)
  })

  it('names a blank-titled hexagon export after the untitled hexagon, not the whole map (EXPORT-02.2)', async () => {
    const map = twoHexMap()
    useMapStore.getState().replace({ ...map, hexagons: [map.hexagons[0], { ...map.hexagons[1], title: '' }] })
    const { container } = render(<App />)
    fireEvent.click(hexGroup(container, 'h2'))
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug(UNTITLED_HEXAGON)}.svg` })
    const markup = await captured!.text()
    expect(markup).toContain(`<title>${UNTITLED_HEXAGON}</title>`)

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  describe('resets on replace', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('resets the export scope to Map whenever the map is replaced (import)', async () => {
      useMapStore.getState().replace(twoHexMap())
      render(<App />)
      fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
      expect((screen.getByRole('radio', { name: 'Hexagon' }) as HTMLInputElement).checked).toBe(true)

      const file = new File([toHexa(twoHexMap())], 'two.hexa', { type: 'application/json' })
      fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect((screen.getByRole('radio', { name: 'Map' }) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByRole('radio', { name: 'Hexagon' }) as HTMLInputElement).checked).toBe(false)
    })
  })
})

describe('grow the map (GROW-01..04, ADR-02)', () => {
  const growEast = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' }))
  }

  it('opens the new hexagon’s title field, focused, and announces the grow via a toast', () => {
    render(<App />)
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))

    const input = screen.getByRole('textbox', { name: 'Hexagon title' }) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe(UNTITLED_HEXAGON)
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)
    expect(useMapStore.getState().focus).toBe(useMapStore.getState().map.hexagons[1].id)
    expect(toastEl()!.textContent).toContain(`Added ${UNTITLED_HEXAGON} to Context 1. It is now the current hexagon.`)
  })

  it('growing into a new context appends it, without touching the existing one', () => {
    render(<App />)
    const before = useMapStore.getState().map
    growEast()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in a new bounded context' }))

    expect(useMapStore.getState().map.contexts).toHaveLength(before.contexts.length + 1)
    expect(useMapStore.getState().map.contexts[0]).toStrictEqual(before.contexts[0])
  })

  it('Undo removes the grown hexagon and restores the previous focus (map and focus toStrictEqual)', () => {
    render(<App />)
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().focus).toBe(beforeFocus)
    expect(screen.queryByRole('textbox', { name: 'Hexagon title' })).toBeNull()
  })

  it('Ctrl+Z still undoes the grow after the new hexagon was named', () => {
    render(<App />)
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMapStore.getState().map.hexagons.at(-1)!.title).toBe('Billing')

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    expect(useMapStore.getState().map.hexagons).toHaveLength(1)
  })

  it('Esc while naming removes the grown hexagon, exactly as Undo would (GROW-03.2)', () => {
    render(<App />)
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().focus).toBe(beforeFocus)
    expect(screen.queryByRole('textbox', { name: 'Hexagon title' })).toBeNull()
  })

  it('leaves no undo step behind for a grow that Esc already unwound', () => {
    const { container } = render(<App />)
    const adapter = EXAMPLE_DIAGRAM.adapters[0].id
    fireEvent.click(onCanvas(container, adapter))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Hexagon title' }), { key: 'Escape' })

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    expect(currentDiagram().adapters.some((a) => a.id === adapter)).toBe(true)
  })

  it('committing a typed title on Enter sets it and closes the field', () => {
    render(<App />)
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })

    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('textbox', { name: 'Hexagon title' })).toBeNull()
    expect(useMapStore.getState().map.hexagons.at(-1)?.title).toBe('Billing')
  })

  it('the Hexagon-section "Add hexagon" button grows into the same context (GROW-04.1)', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon' }))

    expect(useMapStore.getState().map.hexagons).toHaveLength(2)
    expect(useMapStore.getState().map.hexagons[1].contextId).toBe(useMapStore.getState().map.hexagons[0].contextId)
    // Both the canvas's inline naming field and the Editor's own Hexagon-title field share the "Hexagon title"
    // accessible name (the same underlying value, shown in two places at once) — scope to the canvas-only one.
    expect(container.querySelector('main.stage .inline-name')).toBeInstanceOf(HTMLInputElement)
  })
})

describe('renaming a bounded context (NAME-01..03)', () => {
  /** Grows into a new context (via the canvas) and commits the new hexagon's default title, so a second context
   * exists — the chip only renders from two contexts up (CB-01.1) — without leaving any toast/undo state behind. */
  const growSecondContext = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in a new bounded context' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Hexagon title' }), { key: 'Enter' })
  }

  it('updates the chip immediately and is undoable in one step (NAME-02.1, NAME-03.1)', () => {
    render(<App />)
    growSecondContext()
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const contextId = useMapStore.getState().map.contexts[0].id
    const beforeMap = useMapStore.getState().map
    const input = screen.getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Billing' } })

    expect(document.querySelector(`[data-chip="${contextId}"]`)!.textContent).toBe('Billing')

    fireEvent.blur(input)

    expect(toastEl()!.textContent).toContain('Renamed Context 1 to Billing.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(beforeMap)
    expect(document.querySelector(`[data-chip="${contextId}"]`)!.textContent).toBe('Context 1')
  })

  it('lets two contexts share the exact same name, both chips showing it (NAME-01.2)', () => {
    render(<App />)
    growSecondContext()
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const [c1, c2] = useMapStore.getState().map.contexts.map((c) => c.id)
    const input1 = screen.getByLabelText('Name for Context 1')
    const input2 = screen.getByLabelText('Name for Context 2')

    fireEvent.focus(input1)
    fireEvent.change(input1, { target: { value: 'Billing' } })
    fireEvent.blur(input1)
    fireEvent.focus(input2)
    fireEvent.change(input2, { target: { value: 'Billing' } })
    fireEvent.blur(input2)

    expect(document.querySelector(`[data-chip="${c1}"]`)!.textContent).toBe('Billing')
    expect(document.querySelector(`[data-chip="${c2}"]`)!.textContent).toBe('Billing')
  })

  it('reverts the chip to the "Context {n}" placeholder as soon as the name is cleared (NAME-02.3)', () => {
    render(<App />)
    growSecondContext()
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const contextId = useMapStore.getState().map.contexts[0].id
    const input = screen.getByLabelText('Name for Context 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Billing' } })
    expect(document.querySelector(`[data-chip="${contextId}"]`)!.textContent).toBe('Billing')

    fireEvent.change(input, { target: { value: '' } })

    expect(document.querySelector(`[data-chip="${contextId}"]`)!.textContent).toBe('Context 1')
  })

  it('does not toast or offer undo when a blur never changed the name', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const input = screen.getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.blur(input)

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('survives a real autosave/reload cycle (NAME-02.2)', () => {
    vi.useFakeTimers()
    const storage = { setItem: vi.fn() }
    autosave(useMapStore, storage, 'none', { delay: 400 })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const input = screen.getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.blur(input)
    act(() => vi.advanceTimersByTime(1000))

    expect(storage.setItem).toHaveBeenCalledWith(MAP_KEY, expect.stringContaining('Billing'))
    const written = storage.setItem.mock.calls.at(-1)![1] as string
    const reopened = parseHexa(written)
    expect(reopened.ok && reopened.map.kind === 'hexagonal' && reopened.map.contexts.map((c) => c.name)).toContain('Billing')
    vi.useRealTimers()
  })
})

describe('delete a hexagon (DEL-01..06)', () => {
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
  const deleteButton = () => screen.getByRole('button', { name: 'Delete hexagon' })

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is aria-disabled on a single-hexagon map (DEL-01.2)', () => {
    render(<App />)
    openEditor()
    expect(deleteButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('deletes the current hexagon, prunes its link, and shows the exact sticky toast text (DEL-02.1)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    render(<App />)
    openEditor()
    const removedTitle = currentDiagram().title

    fireEvent.click(deleteButton())

    expect(useMapStore.getState().map.hexagons.map((h) => h.id)).toEqual(['h2'])
    expect(useMapStore.getState().map.links).toEqual([])
    expect(toastEl()!.textContent).toContain(`Deleted ${removedTitle} and its 1 link`)
  })

  it('keeps the sticky delete notice on screen well past the 6 s auto-dismiss window (DEL-02)', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    openEditor()
    fireEvent.click(deleteButton())

    // Two acts: the first flushes the 6 s timer's state change, the second would run the 150 ms leave timer it schedules.
    act(() => vi.advanceTimersByTime(20000))
    act(() => vi.advanceTimersByTime(1000))

    expect(toastEl()).not.toBeNull()
    expect(toastEl()!.classList.contains('is-leaving')).toBe(false)
  })

  it('does not dismiss the sticky delete notice on Esc, unlike an ordinary status toast (DEL-02)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    render(<App />)
    openEditor()

    fireEvent.click(deleteButton())
    expect(toastEl()).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(150))

    expect(toastEl()).not.toBeNull()
  })

  it('shows "Deleted {title}" with no link count for an unlinked hexagon (DEL-02.2)', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    openEditor()
    const removedTitle = currentDiagram().title

    fireEvent.click(deleteButton())

    expect(toastEl()!.querySelector('p')!.textContent).toBe(`Deleted ${removedTitle}`)
  })

  it('clears the sticky toast on the map’s next edit, not on the timer', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    openEditor()
    fireEvent.click(deleteButton())
    expect(toastEl()).not.toBeNull()

    act(() => useMapStore.getState().setMeta(useMapStore.getState().focus, { title: 'Edited' }))

    expect(toastEl()).toBeNull()
  })

  it('Undo restores the hexagon, its links, its context, and prior focus (DEL-05.1)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    fireEvent.click(deleteButton())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().focus).toBe(beforeFocus)
  })

})

describe('import a hexagon from file (IMP-01..07)', () => {
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
  const openImportMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add hexagon from file…' }))
  // toMap always yields kind hexagonal now (REQ-06) — no `kind` param left to vary.
  const oneHexFile = () => toHexa(toMap({ ...EXAMPLE_DIAGRAM, title: 'Legacy System' }))
  const pickFile = async (text: string, name = 'legacy.hexa') => {
    const file = new File([text], name, { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Add hexagon from a .hexa file'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })
    return file
  }

  it('imports into the current hexagon’s own bounded context, focuses the imported hexagon, and shows the exact toast text', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    const file = await pickFile(oneHexFile())

    expect(useMapStore.getState().map.hexagons).toHaveLength(2)
    expect(useMapStore.getState().map.contexts).toStrictEqual(before.contexts)
    const imported = useMapStore.getState().map.hexagons.at(-1)!
    expect(imported.contextId).toBe(before.hexagons[0].contextId)
    expect(useMapStore.getState().focus).toBe(imported.id)
    expect(toastEl()!.querySelector('p')!.textContent).toBe(`Added ${imported.title} from ${file.name}.`)
  })

  it('imports into a new bounded context, appending it without touching the existing one (IMP-01.4)', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(oneHexFile())

    expect(useMapStore.getState().map.contexts).toHaveLength(before.contexts.length + 1)
    expect(useMapStore.getState().map.contexts[0]).toStrictEqual(before.contexts[0])
    const imported = useMapStore.getState().map.hexagons.at(-1)!
    expect(imported.contextId).toBe(useMapStore.getState().map.contexts.at(-1)!.id)
  })

  it('leaves the export scope untouched, only changing which hexagon is current (IMP-01.3)', async () => {
    useMapStore.getState().replace(twoHexMap())
    useMapStore.getState().setFocus('h2')
    render(<App />)
    openEditor()
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(oneHexFile())

    expect((screen.getByRole('radio', { name: 'Hexagon' }) as HTMLInputElement).checked).toBe(true)
    const imported = useMapStore.getState().map.hexagons.at(-1)!
    expect(useMapStore.getState().focus).toBe(imported.id)
  })

  it('refuses a file with more than one hexagon before any conversion question, leaving the map untouched (IMP-04)', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(toHexa(twoHexMap()), 'two.hexa')

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('This file has 2 hexagons. Add hexagon from file… takes one; use Open to replace the map.')
  })

  it('an invalid file is refused the same way Open refuses one, without opening any dialog (IMP-07)', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile('{ nope', 'broken.hexa')

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('broken.hexa could not be opened')
  })

  it('Undo restores the map and focus to what they were before the import', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(oneHexFile())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().focus).toBe(beforeFocus)
  })

  it('refuses a v3 Onion file, leaving the map untouched (REQ-03)', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v3OnionExample, 'sample.hexa')

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('sample.hexa is an Onion file. Add hexagon from file… only accepts a Hexagonal map.')
  })

  it('refuses a Clean file the same way, naming it by its own kind (REQ-05)', async () => {
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v4CleanExample, 'sample.hexa')

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('sample.hexa is a Clean file. Add hexagon from file… only accepts a Hexagonal map.')
  })
})

// --- The two end-to-end author journeys, starting from New, UI only --------------------------------------------

describe('journey', () => {
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
  const openImportMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add hexagon from file…' }))
  const pickFile = async (text: string, name: string) => {
    const file = new File([text], name, { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Add hexagon from a .hexa file'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })
  }
  /** Save via the toolbar's ".hexa" export, capturing the downloaded text exactly as the "Two slices" export test
   * does (App.test.tsx's own precedent, `createSpy`/`captured` pattern) — the design's own suggested approach. */
  const saveHexa = async (): Promise<string> => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as .hexa file' }))
    const text = await captured!.text()
    createSpy.mockRestore()
    clickSpy.mockRestore()
    return text
  }
  const reopen = async (text: string) => {
    const file = new File([text], 'reopened.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('from New, three slice files land in two bounded contexts and the saved map reopens whole (IMP-01.4, CB-04.3)', async () => {
    render(<App />)
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))
    expect(useMapStore.getState().map.hexagons).toHaveLength(1)

    // v1-minimal and v1-maximal both join the map's OWN starting context — two of them end up in one shared
    // context — while v2-empty-context.hexa lands in a fresh, second context, giving exactly two bounded contexts
    // with hexagons, however many hexagons each one ends up holding.
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v1Minimal, 'v1-minimal.hexa')
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)

    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v1Maximal, 'v1-maximal.hexa')
    expect(useMapStore.getState().map.hexagons).toHaveLength(3)
    expect(useMapStore.getState().map.contexts).toHaveLength(1)

    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(v2EmptyContext, 'legacy.hexa')
    expect(useMapStore.getState().map.hexagons).toHaveLength(4)
    expect(useMapStore.getState().map.contexts).toHaveLength(2)

    expect(document.querySelectorAll('[data-hull]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-chip]')).toHaveLength(2)

    // Name one context (NAME-01).
    const input = screen.getByLabelText('Name for Context 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Core' } })
    fireEvent.blur(input)
    expect(useMapStore.getState().map.contexts.find((c) => c.id === useMapStore.getState().map.hexagons[0].contextId)?.name).toBe('Core')

    const beforeSave = useMapStore.getState().map
    const savedText = await saveHexa()
    const savedJson = JSON.parse(savedText)
    expect(savedJson.contexts).toHaveLength(2)
    expect(savedJson.contexts.some((c: { name?: string }) => c.name === 'Core')).toBe(true)
    expect(savedJson.hexagons).toHaveLength(4)
    expect(savedJson.hexagons.map((h: { title: string }) => h.title).sort()).toEqual(['Invoicing', 'Maximal', 'Minimal', 'Untitled architecture'])

    await reopen(savedText)

    expect(useMapStore.getState().map).toStrictEqual(beforeSave)
  })

  it('from New, the author grows two bounded contexts and four hexagons', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))
    const title = useMapStore.getState().map.hexagons[0].title || 'Untitled hexagon'

    const growFirstFreeSide = () => fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^Add hexagon to the .* of ${title}$`) })[0])
    const commitInlineName = () => fireEvent.keyDown(screen.getByRole('textbox', { name: 'Hexagon title' }), { key: 'Enter' })

    // grow same x2: two more hexagons join the map's own starting context.
    growFirstFreeSide()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    commitInlineName()
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)

    const secondTitle = useMapStore.getState().map.hexagons[1].title || 'Untitled hexagon'
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^Add hexagon to the .* of ${secondTitle}$`) })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    commitInlineName()
    expect(useMapStore.getState().map.hexagons).toHaveLength(3)
    expect(useMapStore.getState().map.contexts).toHaveLength(1)

    // grow new x1: a fourth hexagon starts a second bounded context.
    const thirdTitle = useMapStore.getState().map.hexagons[2].title || 'Untitled hexagon'
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^Add hexagon to the .* of ${thirdTitle}$`) })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in a new bounded context' }))
    commitInlineName()

    expect(useMapStore.getState().map.hexagons).toHaveLength(4)
    expect(useMapStore.getState().map.contexts).toHaveLength(2)
    expect(document.querySelectorAll('[data-hull]')).toHaveLength(2)

    const beforeSave = useMapStore.getState().map
    const savedText = await saveHexa()

    await reopen(savedText)

    expect(useMapStore.getState().map).toStrictEqual(beforeSave)
  })

  it('a full links session — create from both entry points, edit an adapter, tag a pattern, delete with undo, export, save and reopen', async () => {
    // Two driven ports on h1 (same context c1 as h2, a different one c2 as h3), so one link can be created from
    // the canvas chip within a context and the other from the Links section across contexts (pattern-eligible).
    const journeyMap: HexaMap = {
      version: VERSION,
      kind: 'hexagonal',
      title: 'Release journey',
      contexts: [{ id: 'c1' }, { id: 'c2' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: 'Slice A',
          domain: [],
          useCases: [],
          ports: [
            { id: 'p-out', name: 'Repository', side: 'driven', wall: 'e' },
            { id: 'p-out2', name: 'Notifier', side: 'driven', wall: 'ne' },
          ],
          adapters: [{ id: 'a1', name: 'Knex', portId: 'p-out' }],
          actors: [],
          externals: [],
        },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: 'Slice B',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-in', name: 'Submit', side: 'driving', wall: 'w' }],
          adapters: [],
          actors: [],
          externals: [],
        },
        {
          id: 'h3',
          contextId: 'c2',
          cell: { q: 2, r: 0 },
          title: 'Slice C',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-in2', name: 'Receive', side: 'driving' }],
          adapters: [],
          actors: [],
          externals: [],
        },
      ],
      links: [],
    }
    useMapStore.getState().replace(journeyMap)
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const { container } = render(<App />)

    // Entry point 1: the canvas chip — h1's p-out (driven) to h2's p-in (driving), same context, no pattern.
    fireEvent.click(onCanvas(container, 'p-out'))
    fireEvent.keyDown(document.body, { key: 'l' })
    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-in"]')!)
    expect(useMapStore.getState().map.links).toHaveLength(1)
    const link1 = useMapStore.getState().map.links[0].id

    // Entry point 2: the Links editor section's create form — h1's p-out2 (driven) to h3's p-in2 (driving),
    // crossing contexts, so it is eligible for a pattern tag.
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    fireEvent.change(screen.getByLabelText('Driven port'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Driving port'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    expect(useMapStore.getState().map.links).toHaveLength(2)
    const link2 = useMapStore.getState().map.links.find((l) => l.id !== link1)!.id

    // Edit link1's adapter (REQ-LNK-02.1).
    const row1 = () => container.querySelector<HTMLElement>(`[data-item-id="${link1}"]`)!
    fireEvent.change(within(row1()).getByLabelText('Driven port adapter'), { target: { value: 'a1' } })
    expect(useMapStore.getState().map.links.find((l) => l.id === link1)?.from.adapterId).toBe('a1')

    // Tag link2's pattern (REQ-LNK-02.2) — its row only offers a Pattern control because it crosses contexts.
    const row2 = () => container.querySelector<HTMLElement>(`[data-item-id="${link2}"]`)!
    fireEvent.change(within(row2()).getByLabelText('Pattern'), { target: { value: 'acl' } })
    expect(useMapStore.getState().map.links.find((l) => l.id === link2)?.pattern).toBe('acl')
    expect(within(row1()).queryByLabelText('Pattern')).toBeNull() // same-context row never offers one (REQ-LNK-06.2)

    // Delete link2, then Undo — it must reappear with its ends and its pattern intact (REQ-LNK-04.2).
    const beforeDelete = useMapStore.getState().map
    fireEvent.click(within(row2()).getByRole('button', { name: /Delete link/ }))
    expect(useMapStore.getState().map.links).toHaveLength(1)
    expect(container.querySelectorAll('svg.canvas [data-map-link]')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map).toBe(beforeDelete)
    expect(useMapStore.getState().map.links.find((l) => l.id === link2)?.pattern).toBe('acl')
    expect(container.querySelectorAll('svg.canvas [data-map-link]')).toHaveLength(2)

    // Export as SVG: the routed link and its pattern label survive, with no leftover motion class/style (REQ-LNK-08.1).
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const svgText = await captured!.text()
    expect(svgText).toContain('>acl<')
    expect(svgText).toMatch(/<path/)
    expect(svgText).not.toMatch(/\s(class|style)=/)
    expect(svgText).not.toMatch(/transition|animation|@keyframes/)
    expect(svgText).not.toMatch(/data-map-link|data-link-pattern/)
    createSpy.mockRestore()
    clickSpy.mockRestore()

    // Save and reopen: every link's ends, adapter, and pattern survive exactly (REQ-LNK-08.2, 08.3).
    const beforeSave = useMapStore.getState().map
    const savedText = await saveHexa()
    expect(JSON.parse(savedText).version).toBe(4)

    await reopen(savedText)

    expect(useMapStore.getState().map).toStrictEqual(beforeSave)
    vi.unstubAllGlobals()
  })
})

describe('open a map from a self-contained share link (REQ-01, REQ-03, REQ-04)', () => {
  beforeEach(installCompressionStreamPolyfill)
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  it('replaces the map, shows a status notice with undo, and clears the hash (REQ-01.1, REQ-03.1)', async () => {
    const shared = toMap(STRESS_DIAGRAM)
    location.hash = `${SHARE_HASH_PREFIX}${await encodeSharePayload(shared)}`
    const before = useMapStore.getState().map

    render(<App />)
    await act(async () => {
      await vi.waitFor(() => expect(useMapStore.getState().map).toStrictEqual(shared))
    })

    expect(toastEl()!.textContent).toContain('Opened from a link.')
    expect(location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map).toStrictEqual(before)
  })

  it('applies the link exactly once under React StrictMode', async () => {
    const shared = toMap(STRESS_DIAGRAM)
    location.hash = `${SHARE_HASH_PREFIX}${await encodeSharePayload(shared)}`

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await act(async () => {
      await vi.waitFor(() => expect(useMapStore.getState().map).toStrictEqual(shared))
    })

    expect(screen.getAllByRole('status').filter((el) => el.classList.contains('toast'))).toHaveLength(1)
  })
})

describe('open a map from a remote share link (REQ-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  it('fetches the https address, replaces the map, shows a status notice with undo, and clears the address', async () => {
    const shared = toMap(STRESS_DIAGRAM)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(toHexa(shared))))
    history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
    const before = useMapStore.getState().map

    render(<App />)
    await act(async () => {
      await vi.waitFor(() => expect(useMapStore.getState().map).toStrictEqual(shared))
    })

    expect(fetch).toHaveBeenCalledWith('https://example.test/shared.hexa')
    expect(toastEl()!.textContent).toContain('Opened from a link.')
    expect(location.search).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useMapStore.getState().map).toStrictEqual(before)
  })
})

describe('copy the current map as a link (REQ-05, REQ-06)', () => {
  const stubClipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }
  /** High-entropy content (real random bytes, base64-encoded) resists deflate — a reliable way to build a link
   * over the 8,000-char budget without an implausibly large map. */
  const randomPayload = (bytes: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))

  beforeEach(installCompressionStreamPolyfill)
  afterEach(() => vi.unstubAllGlobals())

  it('copies a link to the whole map regardless of the selected export scope, and shows a confirmation (REQ-05.1)', async () => {
    const writeText = stubClipboard()
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Hexagon' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await act(async () => {
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    })

    const url = writeText.mock.calls[0][0] as string
    expect(url).toContain(SHARE_HASH_PREFIX)
    const decoded = await decodeSharePayload(url.slice(url.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length))
    const result = parseHexa(decoded!)
    expect(result.ok && result.map).toEqual(twoHexMap())
    expect(toastEl()!.textContent).toContain('Copied')
  })

  it('refuses an oversized map: nothing is copied, and the notice points to Save (REQ-06.1)', async () => {
    const writeText = stubClipboard()
    const base = twoHexMap()
    // Never mutate `useCases` in place — it's the same array EXAMPLE_DIAGRAM (and every other test) shares.
    const inflated = base.hexagons[0].useCases.map((u, i) => (i === 0 ? { ...u, note: randomPayload(20000) } : u))
    const big = { ...base, hexagons: [{ ...base.hexagons[0], useCases: inflated }, base.hexagons[1]] }
    useMapStore.getState().replace(big)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Use Save'))

    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies a link to the active ONION document, not the Hexagonal map, when Onion is active', async () => {
    const writeText = stubClipboard()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await act(async () => {
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    })

    const url = writeText.mock.calls[0][0] as string
    const decoded = await decodeSharePayload(url.slice(url.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length))
    const result = parseHexa(decoded!)
    expect(result.ok && result.map).toEqual(useOnionStore.getState().map)
  })

  it('copies a link to the active CLEAN document, not the Hexagonal map, when Clean is active', async () => {
    const writeText = stubClipboard()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await act(async () => {
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    })

    const url = writeText.mock.calls[0][0] as string
    const decoded = await decodeSharePayload(url.slice(url.indexOf(SHARE_HASH_PREFIX) + SHARE_HASH_PREFIX.length))
    const result = parseHexa(decoded!)
    expect(result.ok && result.map).toEqual(useCleanStore.getState().map)
  })
})

describe('save the current map as a .hexa file, per kind (mirrors "copy link"\'s REQ-05/06 coverage)', () => {
  /** Same capture pattern as the "export scope" and "journey" describes above — jsdom's Blob has no `.stream()`,
   * so read it via `.text()` instead. */
  const saveHexa = async (): Promise<string> => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as .hexa file' }))
    const text = await captured!.text()
    createSpy.mockRestore()
    clickSpy.mockRestore()
    return text
  }

  it('saves the active ONION document, not the Hexagonal map, when Onion is active', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))

    const text = await saveHexa()

    const result = parseHexa(text)
    expect(result.ok && result.map).toEqual(useOnionStore.getState().map)
  })

  it.each(['Onion', 'Clean'])('renames the active %s document: saved title and file name follow it, and Undo restores the previous name', async (kind) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: kind }))

    const field = screen.getByLabelText('Diagram title')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'Payments Core' } })
    fireEvent.blur(field)

    const downloads: string[] = []
    let captured: Blob | undefined
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    onTestFinished(() => clickSpy.mockRestore())
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    onTestFinished(() => createSpy.mockRestore())
    fireEvent.click(screen.getByRole('button', { name: 'Save as .hexa file' }))
    const text = await captured!.text()
    const saved = parseHexa(text)
    expect(saved.ok && saved.map.title).toBe('Payments Core')
    expect(downloads).toEqual(['payments-core.hexa'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('Diagram title') as HTMLInputElement).value).toBe('Untitled architecture')
  })

  it('saves the active CLEAN document, not the Hexagonal map, when Clean is active', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))

    const text = await saveHexa()

    const result = parseHexa(text)
    expect(result.ok && result.map).toEqual(useCleanStore.getState().map)
  })
})

describe('opening a share link for a non-Hexagonal document routes it to the matching store (regression: only Hexagonal was ever exercised)', () => {
  beforeEach(installCompressionStreamPolyfill)
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  it('opens an Onion share link into the Onion store, leaving the Hexagonal map untouched', async () => {
    const shared = newOnionMap('Shared onion')
    location.hash = `${SHARE_HASH_PREFIX}${await encodeSharePayload(shared)}`
    const hexaBefore = useMapStore.getState().map

    render(<App />)
    await act(async () => {
      await vi.waitFor(() => expect(useOnionStore.getState().map).toStrictEqual(shared))
    })

    expect(toastEl()!.textContent).toContain('Opened from a link.')
    expect(useMapStore.getState().map).toBe(hexaBefore)
  })

  it('opens a Clean share link into the Clean store, leaving the Hexagonal map untouched', async () => {
    const shared = newCleanMap('Shared clean')
    location.hash = `${SHARE_HASH_PREFIX}${await encodeSharePayload(shared)}`
    const hexaBefore = useMapStore.getState().map

    render(<App />)
    await act(async () => {
      await vi.waitFor(() => expect(useCleanStore.getState().map).toStrictEqual(shared))
    })

    expect(toastEl()!.textContent).toContain('Opened from a link.')
    expect(useMapStore.getState().map).toBe(hexaBefore)
  })
})

describe('link failures leave the map untouched, with a matching notice and a cleared address (REQ-02, REQ-03.2)', () => {
  beforeEach(installCompressionStreamPolyfill)
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  const cases: { name: string; setup: () => void | Promise<void>; message: string }[] = [
    {
      name: 'undecodable embedded data',
      setup: () => {
        location.hash = `${SHARE_HASH_PREFIX}not-a-real-payload!!`
      },
      message: 'This link could not be read.',
    },
    {
      name: 'invalid map content (remote)',
      setup: () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{ nope')))
        history.replaceState(null, '', '/?src=https://example.test/broken.hexa')
      },
      message: 'This link could not be opened. Fix these problems and try again:',
    },
    {
      name: 'newer-version file (embedded)',
      setup: async () => {
        // toHexa always writes a version this build knows, so a future-version payload is deflated by hand.
        const bytes = new TextEncoder().encode(JSON.stringify({ app: 'domainrings', version: 99 }))
        const stream = new ReadableStream({ start: (c) => (c.enqueue(bytes), c.close()) }).pipeThrough(new CompressionStream('deflate-raw'))
        const deflated = new Uint8Array(await new Response(stream).arrayBuffer())
        location.hash = `${SHARE_HASH_PREFIX}${btoa(String.fromCharCode(...deflated)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
      },
      message: 'This link was made by a newer version of domainrings.',
    },
    {
      name: 'non-https remote address',
      setup: () => {
        vi.stubGlobal('fetch', vi.fn())
        history.replaceState(null, '', '/?src=http://example.test/shared.hexa')
      },
      message: "This link's address is not https, so nothing was fetched.",
    },
    {
      name: 'unreachable remote address',
      setup: () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
        history.replaceState(null, '', '/?src=https://example.test/shared.hexa')
      },
      message: "This link's file could not be reached.",
    },
  ]

  it.each(cases)('$name', async ({ setup, message }) => {
    const before = useMapStore.getState().map
    await setup()

    render(<App />)
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message))

    expect(useMapStore.getState().map).toBe(before)
    expect(location.hash).toBe('')
    expect(location.search).toBe('')
  })

  it('non-https never calls fetch (REQ-02.4)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    history.replaceState(null, '', '/?src=http://example.test/shared.hexa')

    render(<App />)
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not https'))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('an embedded link wins over a remote address when both are present (REQ-04)', () => {
  beforeEach(installCompressionStreamPolyfill)
  afterEach(() => {
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  it('opens the embedded map and never fetches the remote address', async () => {
    const shared = toMap(STRESS_DIAGRAM)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const payload = await encodeSharePayload(shared)
    history.replaceState(null, '', `/?src=https://example.test/other.hexa${SHARE_HASH_PREFIX}${payload}`)

    render(<App />)
    await vi.waitFor(() => expect(useMapStore.getState().map).toStrictEqual(shared))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(location.hash).toBe('')
    expect(location.search).toBe('')
  })
})

describe('the architecture chooser (REQ-01, REQ-02, REQ-06)', () => {
  it('New opens the chooser; picking Hexagonal is pixel-identical to the old direct New', () => {
    const { container } = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    expect(screen.getByRole('dialog').textContent).toContain('Choose an architecture')
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    expect(useMapStore.getState().map.hexagons).toHaveLength(1)
    expect(useMapStore.getState().map.hexagons[0].title).toBe('Untitled architecture')
    expect(container.querySelector('svg.canvas')).toBeInstanceOf(SVGSVGElement)
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('New → Onion mounts its own OnionEditor/OnionStage — a bare 4-ring diagram, no Hexagonal editor/stage — and never touches the Hexagonal store', () => {
    const { container } = render(<App />)
    const hexaMapBefore = useMapStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelectorAll('svg.canvas .ring')).toHaveLength(4)
    // OnionEditor has its own "Expand editor" toggle — what must be absent is anything Hexagonal-only.
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)
    expect(screen.queryByRole('button', { name: 'Add a driving port' })).toBeNull()
    expect(container.querySelector('[data-hex]')).toBeNull()
    expect(useOnionStore.getState().map.kind).toBe('onion')
    expect(useOnionStore.getState().map.rings.map((r) => r.role)).toEqual(['domain', 'domainServices', 'application', 'outer'])
    expect(useOnionStore.getState().map.title).toBe('Untitled architecture')
    // The Hexagonal store was never touched by choosing Onion (App reads it unconditionally but never mutates it).
    expect(useMapStore.getState().map).toBe(hexaMapBefore)
  })

  it('New → Clean mounts its own CleanEditor and a bare 4-ring diagram, no sectors/elements yet, and never touches the other stores', () => {
    const { container } = render(<App />)
    const hexaMapBefore = useMapStore.getState().map
    const onionMapBefore = useOnionStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelectorAll('svg.canvas .ring')).toHaveLength(4)
    // CleanEditor has its own "Expand editor" toggle — what must be absent is anything Hexagonal-only.
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)
    expect(screen.queryByRole('button', { name: 'Add a driving port' })).toBeNull()
    expect(container.querySelector('[data-hex]')).toBeNull()
    expect(useCleanStore.getState().map.kind).toBe('clean')
    expect(useCleanStore.getState().map.rings.map((r) => r.role)).toEqual(['domain', 'application', 'adapters', 'outer'])
    expect(useCleanStore.getState().map.sectors).toEqual([])
    expect(useCleanStore.getState().map.title).toBe('Untitled architecture')
    // Neither other store was touched by choosing Clean.
    expect(useMapStore.getState().map).toBe(hexaMapBefore)
    expect(useOnionStore.getState().map).toBe(onionMapBefore)
  })

  it('Esc on the chooser leaves the current view untouched', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('opening a legacy v2 file whose stored kind is onion renders Hexagonal, ports and adapters intact (REQ-06)', async () => {
    render(<App />)
    const file = new File([v2EmptyContext], 'legacy.hexa', { type: 'application/json' })

    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    expect(useMapStore.getState().map.hexagons[0].ports.length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInstanceOf(HTMLButtonElement)
  })
})

describe('Onion export (REQ-08)', () => {
  const openOnionSample = async () => {
    render(<App />)
    const file = new File([v3OnionExample], 'sample.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('never offers the Hexagon/Map export scope for Onion, even behind a dormant multi-hexagon Hexagonal map', async () => {
    useMapStore.getState().replace(twoHexMap())
    await openOnionSample()
    expect(useOnionStore.getState().map.kind).toBe('onion')
    expect(screen.queryByRole('group', { name: 'Export scope' })).toBeNull()
  })

  it('exports the Onion diagram as SVG showing its rings, elements, dependency arrow, actor and its own legend, named after its own title, with no leftover "+"/"Depend on…" affordances', async () => {
    await openOnionSample()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug('Onion sample')}.svg` })
    const markup = await captured!.text()
    expect(markup).toContain('Domain Model') // innermost ring, drawn as-is
    expect(markup).toContain('INFRASTRUCTURE') // outer ring, upper-cased like every non-innermost ring
    expect(markup).toContain('>Order<') // element
    expect(markup).toContain('>Order</tspan><tspan')
    expect(markup).toContain('>Controller</tspan>') // element ("OrderController" wraps onto two lines, Decision 8)
    expect(markup).toContain('>Web shop<') // actor
    expect(markup).toContain('url(#onion-arrow)') // dependency/endpoint arrow
    expect(markup).not.toMatch(/<circle[^>]*r="10"/) // no leftover ring/endpoint "+" glyph
    expect(markup).not.toContain('Depend on…') // no leftover gesture chip
    expect(markup).toMatch(/data-legend/) // "Include legend in export" defaults on, same as Hexagonal
    expect(markup).toContain('Domain Model') // legend: ring colour row (also the ring's own title, above)
    expect(markup).toContain('Depends on / connects to') // legend: the dependency arrow's own stroke row

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports the Onion diagram as PNG through pngBlob, same as Hexagonal', async () => {
    await openOnionSample()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    // jsdom implements neither image decoding nor a 2D canvas context — stub only those browser gaps so the
    // real pngBlob (src/ui/exporters.ts) still runs its own sizing/draw/encode logic end to end. `decode` isn't
    // defined at all on jsdom's HTMLImageElement, so it's assigned directly rather than spied on.
    ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = vi.fn().mockResolvedValue(undefined)
    const drawImage = vi.fn()
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(['fake-png'], { type: 'image/png' }))
      })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug('Onion sample')}.png` })
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(captured?.type).toBe('image/png')

    delete (HTMLImageElement.prototype as unknown as { decode?: () => Promise<void> }).decode
    contextSpy.mockRestore()
    toBlobSpy.mockRestore()
    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('still exports Hexagonal diagrams exactly as before (regression)', async () => {
    render(<App />)
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug(EXAMPLE_DIAGRAM.title)}.svg` })
    const markup = await captured!.text()
    expect(markup).toContain(EXAMPLE_DIAGRAM.title)

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe('Clean export (REQ-05)', () => {
  const openCleanSample = async () => {
    render(<App />)
    const file = new File([v4CleanExample], 'sample.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Open a .hexa file, replacing the map'), { target: { files: [file] } })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('exports the Clean diagram as SVG showing its rings, sector dividers, elements, dependency arrow, actor, external and its own legend, named after its own title, with no leftover "+"/"Depend on…" affordances', async () => {
    await openCleanSample()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug('Clean sample')}.svg` })
    const markup = await captured!.text()
    expect(markup).toContain('Entities') // innermost ring, drawn as-is
    expect(markup).toContain('FRAMEWORKS &amp; DRIVERS') // outer ring, upper-cased like every non-innermost ring
    expect(markup).toContain('data-sector-divider') // sector wedge dividers (REQ-08)
    expect(markup).toContain('>Order<') // element
    expect(markup).toContain('>Order</tspan><tspan')
    expect(markup).toContain('>Controller</tspan>') // element ("OrderController" wraps onto two lines, Decision 8)
    expect(markup).toContain('>Web shop<') // actor
    expect(markup).toContain('>Payment</tspan><tspan')
    expect(markup).toContain('>gateway</tspan>') // external ("Payment gateway" wraps onto two lines, Decision 8)
    expect(markup).toContain('url(#clean-arrow)') // dependency/endpoint arrow
    expect(markup).not.toMatch(/<circle[^>]*r="10"/) // no leftover ring/sector/element "+" glyph
    expect(markup).not.toContain('Depend on…') // no leftover gesture chip
    expect(markup).toMatch(/data-legend/) // "Include legend in export" defaults on, same as Hexagonal
    expect(markup).toContain('Wedge') // legend: Clean's own sector-wedge row, absent from Onion's legend

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports the Clean diagram as PNG through pngBlob, same as Hexagonal/Onion', async () => {
    await openCleanSample()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    // jsdom implements neither image decoding nor a 2D canvas context — stub only those browser gaps so the
    // real pngBlob (src/ui/exporters.ts) still runs its own sizing/draw/encode logic end to end.
    ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = vi.fn().mockResolvedValue(undefined)
    const drawImage = vi.fn()
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(['fake-png'], { type: 'image/png' }))
      })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clickSpy.mock.instances.at(-1)).toMatchObject({ download: `${fileSlug('Clean sample')}.png` })
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(captured?.type).toBe('image/png')

    delete (HTMLImageElement.prototype as unknown as { decode?: () => Promise<void> }).decode
    contextSpy.mockRestore()
    toBlobSpy.mockRestore()
    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})

// REQ-09: every action that changes an Onion or Clean document shows the same status toast with Undo that
// Hexagonal actions show — through the one mechanism App.tsx now generalizes over all three kinds.
describe('Onion undo (REQ-09)', () => {
  // Onion's editor-panel "+" ("Add element to X") and its canvas "+" ("Add an element to X") differ by the
  // article, so an unscoped query is never ambiguous between the two — unlike Clean's own (see below).
  const openOnion = () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
  }

  it('an editor-panel action (add an element) shows an undo toast, and Undo restores the prior document', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))

    expect(useOnionStore.getState().map.elements).toHaveLength(1)
    expect(toastEl()!.textContent).toContain('Added NewElement to Domain Model.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.elements).toEqual([])
  })

  it('renaming an element from the editor panel shows an undo toast naming both names, and Undo restores the prior name', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))
    const field = screen.getByLabelText('element name') as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'Order' } })
    fireEvent.blur(field)

    expect(useOnionStore.getState().map.elements[0].name).toBe('Order')
    expect(toastEl()!.textContent).toContain('Renamed NewElement to Order.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.elements[0].name).toBe('NewElement')
  })

  it('removing an element from the editor panel shows an undo toast, and Undo restores it', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))
    const id = useOnionStore.getState().map.elements[0].id

    fireEvent.click(screen.getByRole('button', { name: 'Remove element NewElement' }))

    expect(useOnionStore.getState().map.elements).toEqual([])
    expect(toastEl()!.textContent).toContain('Deleted NewElement.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.elements.map((e) => e.id)).toEqual([id])
  })

  it('removing a ring moves its elements inward in one edit, and one Undo brings ring and elements back', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Services' }))
    const id = useOnionStore.getState().map.elements[0].id

    fireEvent.click(screen.getByRole('button', { name: 'Remove ring Domain Services' }))
    expect(useOnionStore.getState().map.rings).toHaveLength(3)
    expect(useOnionStore.getState().map.elements[0].ringRole).toBe('domain')
    expect(toastEl()!.textContent).toContain('Removed Domain Services. Moved 1 element to Domain Model.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.rings).toHaveLength(4)
    expect(useOnionStore.getState().map.elements).toEqual([expect.objectContaining({ id, ringRole: 'domainServices' })])
  })

  it('adding and renaming a ring each undo as one step', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add ring' }))
    expect(useOnionStore.getState().map.rings).toHaveLength(5)

    const field = screen.getAllByLabelText('Ring name')[3] as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'Events' } })
    fireEvent.blur(field)
    expect(toastEl()!.textContent).toContain('Renamed New ring to Events.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.rings[3].name).toBe('New ring')
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(useOnionStore.getState().map.rings).toHaveLength(4)
  })

  it('the canvas Depend-on gesture shows an undo toast, and Undo restores the prior document', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Infrastructure' }))

    fireEvent.click(screen.getByRole('button', { name: 'NewElement (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from NewElement' }))
    fireEvent.click(screen.getByRole('button', { name: 'NewElement (domain)' }))

    expect(useOnionStore.getState().map.dependencies).toHaveLength(1)
    expect(toastEl()!.textContent).toContain('Linked NewElement → NewElement.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useOnionStore.getState().map.dependencies).toEqual([])
  })

  it('choosing an invalid (outward) target on the canvas creates no undo toast', () => {
    openOnion()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Domain Model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Application Services' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Infrastructure' }))

    fireEvent.click(screen.getByRole('button', { name: 'NewElement (application)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from NewElement' }))
    fireEvent.click(screen.getByRole('button', { name: 'NewElement (outer)' })) // outward — invalid target

    expect(useOnionStore.getState().map.dependencies).toEqual([])
    expect(screen.getByRole('alert').textContent).toMatch(/same ring or a more inward one/)
    expect(toastEl()).toBeNull()
  })
})

describe('Clean undo (REQ-09)', () => {
  // Unlike Onion's, Clean's editor-panel "+" and canvas "+" share the exact same aria-label ("Add sector to X",
  // "Add element to X") — every editor-panel query below is scoped to the editor pane to pick the right one.
  const openClean = () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    return within(container.querySelector('aside.editor')!)
  }

  it('an editor-panel action (add a sector) shows an undo toast, and Undo restores the prior document', () => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))

    expect(useCleanStore.getState().map.sectors).toHaveLength(1)
    expect(toastEl()!.textContent).toContain('Added NewSector to Entities.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useCleanStore.getState().map.sectors).toEqual([])
  })

  it('removing a sector cascades its elements, and Undo restores both the sector and its elements', () => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))
    fireEvent.click(editor.getByRole('button', { name: 'Add element to NewSector' }))
    const sectorId = useCleanStore.getState().map.sectors[0].id
    const elementId = useCleanStore.getState().map.elements[0].id

    fireEvent.click(editor.getByRole('button', { name: 'Remove sector NewSector' }))

    expect(useCleanStore.getState().map.sectors).toEqual([])
    expect(useCleanStore.getState().map.elements).toEqual([])
    expect(toastEl()!.textContent).toContain('Deleted NewSector and its 1 element.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useCleanStore.getState().map.sectors.map((s) => s.id)).toEqual([sectorId])
    expect(useCleanStore.getState().map.elements.map((e) => e.id)).toEqual([elementId])
  })

  it('removing an element shows an undo toast, and Undo restores it', () => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))
    fireEvent.click(editor.getByRole('button', { name: 'Add element to NewSector' }))
    const before = useCleanStore.getState().map

    fireEvent.click(editor.getByRole('button', { name: 'Remove element NewElement' }))

    expect(useCleanStore.getState().map.elements).toEqual([])
    expect(toastEl()!.textContent).toContain('Deleted NewElement.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useCleanStore.getState().map).toStrictEqual(before)
  })

  it.each([
    { label: 'element name', was: 'NewElement', now: 'Order', pick: (map: CleanFile) => map.elements[0].name },
    { label: 'sector name', was: 'NewSector', now: 'Billing', pick: (map: CleanFile) => map.sectors[0].name },
  ])('renaming a $label shows an undo toast naming both names, and Undo restores the prior name', ({ label, was, now, pick }) => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))
    fireEvent.click(editor.getByRole('button', { name: 'Add element to NewSector' }))
    const before = useCleanStore.getState().map
    const field = editor.getByLabelText(label)
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: now } })
    fireEvent.blur(field)

    expect(pick(useCleanStore.getState().map)).toBe(now)
    expect(toastEl()!.textContent).toContain(`Renamed ${was} to ${now}.`)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useCleanStore.getState().map).toStrictEqual(before)
  })

  it('the canvas Depend-on gesture shows an undo toast, and Undo restores the prior document', () => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))
    fireEvent.click(editor.getByRole('button', { name: 'Add element to NewSector' })) // domain element — only one sector exists yet
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Frameworks & Drivers' }))
    fireEvent.click(editor.getAllByRole('button', { name: 'Add element to NewSector' })[1]) // outer sector's own "+"

    fireEvent.click(screen.getByRole('button', { name: 'NewElement (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from NewElement' }))
    fireEvent.click(screen.getByRole('button', { name: 'NewElement (domain)' }))

    expect(useCleanStore.getState().map.dependencies).toHaveLength(1)
    expect(toastEl()!.textContent).toContain('Linked NewElement → NewElement.')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(useCleanStore.getState().map.dependencies).toEqual([])
  })

  it('choosing an invalid (outward) target on the canvas creates no undo toast', () => {
    const editor = openClean()
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Entities' }))
    fireEvent.click(editor.getByRole('button', { name: 'Add element to NewSector' })) // domain element — only one sector exists yet
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Use Cases' }))
    fireEvent.click(editor.getAllByRole('button', { name: 'Add element to NewSector' })[1]) // application sector's own "+"
    fireEvent.click(editor.getByRole('button', { name: 'Add sector to Frameworks & Drivers' }))
    fireEvent.click(editor.getAllByRole('button', { name: 'Add element to NewSector' })[2]) // outer sector's own "+"

    fireEvent.click(screen.getByRole('button', { name: 'NewElement (application)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from NewElement' }))
    fireEvent.click(screen.getByRole('button', { name: 'NewElement (outer)' })) // outward — invalid target

    expect(useCleanStore.getState().map.dependencies).toEqual([])
    expect(screen.getByRole('alert').textContent).toMatch(/same ring or a more inward one/)
    expect(toastEl()).toBeNull()
  })
})

// The actions the two kinds share through RingedSections. Each seeds a document that already holds the sample's
// dependency, actor and external (Onion's sample has no external, so one is added), then checks Undo returns the
// exact document from before the edit.
// Fixtures on an older version only validate after parseHexa upgrades them to the current one, which the
// stores' validate-by-reparse edits (add dependency/endpoint) require.
const sample = <T extends OnionFile | CleanFile>(raw: string) => {
  const parsed = parseHexa(raw)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.map as T
}

type EndpointPatch = Pick<Partial<OnionFile>, 'actors' | 'externals'>

describe.each([
  {
    kind: 'Onion',
    doc: () => useOnionStore.getState().map,
    seed: (patch: EndpointPatch) => act(() => useOnionStore.getState().replace({ ...(sample<OnionFile>(v3OnionExample)), externals: [{ id: 'ext-pay', name: 'Payment gateway', targetId: 'el-controller' }], ...patch })),
  },
  {
    kind: 'Clean',
    doc: () => useCleanStore.getState().map,
    seed: (patch: EndpointPatch) => act(() => useCleanStore.getState().replace({ ...(sample<CleanFile>(v4CleanExample)), ...patch })),
  },
])('$kind undo of dependency and endpoint edits (REQ-09)', ({ kind, doc, seed }) => {
  const open = (patch: EndpointPatch = {}) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: kind }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    seed(patch)
    return doc()
  }
  const undoRestores = (before: unknown) => {
    expect(doc()).not.toStrictEqual(before)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(doc()).toStrictEqual(before)
  }

  it('removing a dependency shows an undo toast, and Undo restores it', () => {
    const before = open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete dependency OrderController to Order' }))

    expect(doc().dependencies).toEqual([])
    expect(toastEl()!.textContent).toContain('Deleted the dependency OrderController → Order.')
    undoRestores(before)
  })

  it.each([
    { noun: 'actor', collection: 'actors', field: 0, name: 'New actor' },
    { noun: 'external system', collection: 'externals', field: 1, name: 'New system' },
  ] as const)('adding an $noun shows an undo toast, and Undo removes it', ({ noun, collection, field, name }) => {
    const before = open({ actors: [], externals: [] })
    fireEvent.change(screen.getAllByLabelText('Target (outer ring)')[field], { target: { value: 'el-controller' } })
    fireEvent.click(screen.getByRole('button', { name: `Add ${noun}` }))

    expect(doc()[collection].map((e) => e.name)).toEqual([name])
    expect(toastEl()!.textContent).toContain(`Added ${name} for OrderController.`)
    undoRestores(before)
  })

  it.each([
    { noun: 'actor', collection: 'actors', name: 'Web shop' },
    { noun: 'external system', collection: 'externals', name: 'Payment gateway' },
  ] as const)('removing an $noun shows an undo toast, and Undo restores it', ({ noun, collection, name }) => {
    const before = open()
    fireEvent.click(screen.getByRole('button', { name: `Remove ${noun} ${name}` }))

    expect(doc()[collection]).toEqual([])
    expect(toastEl()!.textContent).toContain(`Removed ${name}.`)
    undoRestores(before)
  })
})

// REQ-09: swap() (New, Open, an Example, a share link) offers Undo whatever kind is active before and after —
// Undo restores the replaced document into its own store and brings back its view (activeKind), not just when
// staying within the kind already on screen.
describe('swap undo across kinds (REQ-09)', () => {
  it('Onion → Hexagonal via New, then Undo restores the Onion document and its view', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    const onionBefore = useOnionStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))
    expect(useMapStore.getState().map.kind).toBe('hexagonal')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useOnionStore.getState().map).toBe(onionBefore)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    expect(screen.getByRole('button', { name: 'Add element to Domain Model' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('from a Clean document, loading an Example then Undo restores the Clean document', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    const cleanBefore = useCleanStore.getState().map

    const option = screen.getByRole('option', { name: 'Chat feedback slice' }) as HTMLOptionElement
    fireEvent.change(screen.getByLabelText('Load an example'), { target: { value: option.value } })
    expect(useMapStore.getState().map).toStrictEqual(EXAMPLES.find((x) => x.id === 'hexagonal-basic')!.map)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useCleanStore.getState().map).toBe(cleanBefore)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    expect(within(container.querySelector('aside.editor')!).getByRole('button', { name: 'Add sector to Entities' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('Hexagonal → Clean via New, then Undo restores the Hexagonal map and its view', () => {
    const { container } = render(<App />)
    const hexBefore = useMapStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    expect(useCleanStore.getState().map.kind).toBe('clean')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(hexBefore)
    expect(container.querySelector('[data-hex]')).not.toBeNull()
  })

  it('Onion → Clean via New, then Undo restores the Onion document and its view', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    const onionBefore = useOnionStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    expect(useCleanStore.getState().map.kind).toBe('clean')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useOnionStore.getState().map).toBe(onionBefore)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    expect(screen.getByRole('button', { name: 'Add element to Domain Model' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('Clean → Onion via New, then Undo restores the Clean document and its view', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    const cleanBefore = useCleanStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    expect(useOnionStore.getState().map.kind).toBe('onion')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useCleanStore.getState().map).toBe(cleanBefore)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    expect(within(container.querySelector('aside.editor')!).getByRole('button', { name: 'Add sector to Entities' })).toBeInstanceOf(HTMLButtonElement)
  })

  it('Hexagonal → Onion via New, then Undo restores the Hexagonal map and its view', () => {
    const { container } = render(<App />)
    const hexBefore = useMapStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    expect(useOnionStore.getState().map.kind).toBe('onion')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toBe(hexBefore)
    expect(container.querySelector('[data-hex]')).not.toBeNull()
  })
})

// `layoutOnion`/`layoutClean` now run growth binary searches (1-3 radial tracks × O(n²) overlap checks, twice —
// raw order vs the crossing-optimised order) — cheap for a fresh empty file, expensive once a document has real
// content. A render that changes neither store's own map must not pay for that again.
describe('Onion/Clean layout is memoised across renders that do not change the document', () => {
  beforeEach(() => localStorage.removeItem('domainrings:legend-open'))

  it('toggling the theme does not recompute the Onion layout', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    vi.mocked(layoutOnion).mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dark' }))

    expect(layoutOnion).not.toHaveBeenCalled()
  })

  it('toggling the legend does not recompute the Clean layout', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'New diagram' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
    vi.mocked(layoutClean).mockClear()

    fireEvent.click(screen.getByTitle('Show legend'))

    expect(layoutClean).not.toHaveBeenCalled()
  })
})

describe('move a hexagon to another bounded context', () => {
  const twoContexts = () => {
    const base = twoHexMap()
    useMapStore.getState().replace({ ...base, contexts: [{ id: 'c1' }, { id: 'c2' }], hexagons: [base.hexagons[0], { ...base.hexagons[1], contextId: 'c2' }] })
  }
  const moveTo = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to context…' }))
    fireEvent.click(screen.getByRole('menuitem', { name }))
  }

  it('moves the current hexagon, toasts its title and destination, and Undo restores map and focus', () => {
    twoContexts()
    render(<App />)
    const before = useMapStore.getState().map
    const title = currentDiagram().title

    moveTo('Context 2')

    expect(useMapStore.getState().map.hexagons[0].contextId).toBe('c2')
    expect(useMapStore.getState().map.contexts.map((c) => c.id)).toEqual(['c2'])
    expect(toastEl()!.querySelector('p')!.textContent).toBe(`Moved ${title} to Context 2.`)
    expect(useMapStore.getState().focus).toBe('h1')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toEqual(before)
    expect(useMapStore.getState().focus).toBe('h1')
  })
})
