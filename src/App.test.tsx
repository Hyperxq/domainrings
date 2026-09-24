import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM, TWO_SLICES_MAP } from './model/example'
import { layoutDiagram } from './layout/layout'
import { toHexa, toMap } from './model/hexa'
import { diagramOf, UNTITLED_HEXAGON } from './model/map'
import { useMapStore } from './model/store'
import { fileSlug } from './ui/exporters'
import { card, currentDiagram, hexGroup, linkedTwoHexMap, twoHexMap } from './test/fixtures'

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

describe('the "Two slices, one link (preview)" example (EX-01, CANVAS-01/02/04, FOCUS-02)', () => {
  const pickExample = (label: string) => fireEvent.change(screen.getByLabelText('Load an example'), { target: { value: label } })

  it('loads TWO_SLICES_MAP with the first hexagon current, and fits the view (no pan/zoom override)', () => {
    render(<App />)
    const option = screen.getByRole('option', { name: 'Two slices, one link (preview)' }) as HTMLOptionElement

    pickExample(option.value)

    expect(useMapStore.getState().map).toStrictEqual(TWO_SLICES_MAP)
    expect(useMapStore.getState().focus).toBe('h1')
    expect(toastEl()!.textContent).toContain('Loaded the Two slices, one link (preview) example.')
  })

  it('renders both hexagons of the example, non-overlapping, connected by exactly one link line', () => {
    const { container } = render(<App />)
    const option = screen.getByRole('option', { name: 'Two slices, one link (preview)' }) as HTMLOptionElement
    pickExample(option.value)

    const groups = container.querySelectorAll('svg.canvas [data-hex]')
    expect(groups).toHaveLength(2)
    expect(container.querySelectorAll('svg.canvas [data-map-link]')).toHaveLength(1)
    const boxOf = (hexId: string) => container.querySelector(`[data-hex="${hexId}"]`)!.getBoundingClientRect()
    // jsdom's getBoundingClientRect is a zero-box stub; the real non-overlap guarantee is proven at the layout
    // level (layout/map.test.ts CANVAS-01.1). Here we only pin that both hexagons render as distinct groups
    // with different transforms, which is what the DOM identity contract (SEAM-05) actually promises.
    expect(boxOf('h1')).toBeDefined()
    expect(container.querySelector('[data-hex="h1"]')!.getAttribute('transform')).not.toBe(container.querySelector('[data-hex="h2"]')!.getAttribute('transform'))
  })
})

describe('refused imports leave the current map untouched (MIG-02, MIG-03)', () => {
  it('refuses a structurally invalid v2 file, naming the reason, without touching the current map', async () => {
    render(<App />)
    const before = useMapStore.getState().map
    const broken = JSON.stringify({ app: 'domainrings', version: 2, kind: 'hexagonal', title: 'Bad', contexts: [{ id: 'c1' }], hexagons: [], links: [] })
    const file = new File([broken], 'broken.hexa', { type: 'application/json' })

    fireEvent.change(screen.getByLabelText('Import a .hexa file'), { target: { files: [file] } })
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

    fireEvent.change(screen.getByLabelText('Import a .hexa file'), { target: { files: [file] } })
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
    fireEvent.change(screen.getByLabelText('Import a .hexa file'), { target: { files: [file] } })
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
    expect(screen.getByRole('button', { name: `Link ${adapter.name} to…` })).toBeTruthy()
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

describe('kind lock on a multi-hexagon map (MIG-04.2)', () => {

  it('disables the kind radios with a hint, and clicking one still leaves the map hexagonal', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)

    const clean = screen.getByRole('radio', { name: 'Clean' })
    expect(clean.getAttribute('aria-disabled')).toBe('true')
    const hintId = clean.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(document.getElementById(hintId!)!.textContent).toBe('A map with more than one hexagon is always hexagonal.')

    fireEvent.click(clean)

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
  })

  it('takes the hint out of flow (so a multi-hexagon toolbar never overflows) but still surfaces it as a title on the locked fieldset (REQ-04.2)', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)

    const clean = screen.getByRole('radio', { name: 'Clean' })
    const hintId = clean.getAttribute('aria-describedby')!
    expect(document.getElementById(hintId)!.classList.contains('visually-hidden')).toBe(true)
    expect(clean.closest('fieldset')!.getAttribute('title')).toBe('A map with more than one hexagon is always hexagonal.')
  })

  it('leaves the kind radios enabled, with no hint, on a single-hexagon map', () => {
    render(<App />)

    const clean = screen.getByRole('radio', { name: 'Clean' })
    expect(clean.getAttribute('aria-disabled')).toBeNull()
    expect(clean.getAttribute('aria-describedby')).toBeNull()
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
    expect(recoveryEl()).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(recoveryEl()).toBeNull()
    vi.useRealTimers()
  })

  it('keeps the recovery notice on screen through a later status toast and starting a link (REQ-03.2)', () => {
    const { container } = render(<App boot={{ recovery: 'kept', unreadableText: '{x' }} />)
    expect(screen.getByRole('button', { name: 'Download saved copy' })).toBeTruthy()

    // An ordinary status toast (here: an edit) must not replace the recovery notice.
    fireEvent.click(onCanvas(container, EXAMPLE_DIAGRAM.useCases[0].id))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(screen.getByRole('button', { name: 'Download saved copy' })).toBeTruthy()

    // Starting a link — the other path that used to clear any non-error notice — must not clear it either.
    const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
    fireEvent.click(onCanvas(container, adapter.id))
    fireEvent.keyDown(document.body, { key: 'l' })
    const recoverySection = screen.getByRole('button', { name: 'Download saved copy' }).closest('section')!
    expect(recoverySection).toBeTruthy()

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
      fireEvent.change(screen.getByLabelText('Import a .hexa file'), { target: { files: [file] } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect((screen.getByRole('radio', { name: 'Map' }) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByRole('radio', { name: 'Hexagon' }) as HTMLInputElement).checked).toBe(false)
    })
  })
})
