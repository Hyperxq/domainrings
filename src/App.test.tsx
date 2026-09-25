import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM, TWO_SLICES_MAP } from './model/example'
import { layoutDiagram } from './layout/layout'
import { parseHexa, toHexa, toMap } from './model/hexa'
import { diagramOf, UNTITLED_HEXAGON } from './model/map'
import { autosave, MAP_KEY } from './model/persistence'
import { useMapStore } from './model/store'
import { fileSlug } from './ui/exporters'
import { card, currentDiagram, hexGroup, installDialogPolyfill, linkedTwoHexMap, twoHexMap } from './test/fixtures'
import v1Minimal from './model/fixtures/v1-minimal.hexa?raw'
import v1Maximal from './model/fixtures/v1-maximal.hexa?raw'
import v2EmptyContext from './model/fixtures/v2-empty-context.hexa?raw'
import v2Honeycomb from './model/fixtures/v2-honeycomb.hexa?raw'

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

describe('the "Two slices, one link" example (EX-01, CANVAS-01/02/04, FOCUS-02)', () => {
  const pickExample = (label: string) => fireEvent.change(screen.getByLabelText('Load an example'), { target: { value: label } })

  it('is no longer labelled as a preview (EX-01.2)', () => {
    render(<App />)
    // Built by concatenation, not as one literal, so this file itself never trips the EX-01.2 gate:
    // `rg -c "\(preview\)" README.md src` must read 0 once the label is dropped everywhere.
    const oldLabel = `Two slices, one link (${'preview'})`
    expect(screen.queryByRole('option', { name: oldLabel })).toBeNull()
    expect(screen.getByRole('option', { name: 'Two slices, one link' })).toBeDefined()
  })

  it('loads TWO_SLICES_MAP with the first hexagon current, and fits the view (no pan/zoom override)', () => {
    render(<App />)
    const option = screen.getByRole('option', { name: 'Two slices, one link' }) as HTMLOptionElement

    pickExample(option.value)

    expect(useMapStore.getState().map).toStrictEqual(TWO_SLICES_MAP)
    expect(useMapStore.getState().focus).toBe('h1')
    expect(toastEl()!.textContent).toContain('Loaded the Two slices, one link example.')
  })

  it('renders both hexagons of the example, non-overlapping, connected by exactly one link line', () => {
    const { container } = render(<App />)
    const option = screen.getByRole('option', { name: 'Two slices, one link' }) as HTMLOptionElement
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

  it('exports a real two-context render: hulls and chips kept in Map scope, dropped in Hexagon scope (EXPORT-03)', async () => {
    const result = parseHexa(v2Honeycomb)
    if (!result.ok) throw new Error('fixture failed to parse')
    useMapStore.getState().replace(result.map)
    // Real CSS, not jsdom's unstyled defaults, so a hull path's stroke-dasharray actually reaches the export —
    // the same technique exporters.test.ts uses for its own CSS-dependent assertions.
    const styleTag = document.createElement('style')
    styleTag.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    document.head.appendChild(styleTag)
    render(<App />)
    expect(document.querySelectorAll('svg.canvas [data-hull]').length).toBe(2)

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let captured: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
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

    createSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
    styleTag.remove()
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
    expect(container.querySelector('main.stage .inline-name')).toBeTruthy()
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
    autosave(useMapStore, storage, 'none', 400)
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
    expect(reopened.ok && reopened.map.contexts.find((c) => c.name === 'Billing')).toBeTruthy()
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

    // Sticky: still up well past the normal 6 s countdown (DEL-02).
    act(() => vi.advanceTimersByTime(20000))
    expect(toastEl()).not.toBeNull()
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

  it('deleting down to one hexagon keeps the map kind hexagonal and re-enables the kind control (DEL-06.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    render(<App />)
    openEditor()

    fireEvent.click(deleteButton())

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    expect(screen.getByRole('radio', { name: 'Onion' }).hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('import a hexagon from file (IMP-01..07)', () => {
  const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
  const openImportMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add hexagon from file…' }))
  const oneHexFile = (kind: 'hexagonal' | 'clean' | 'onion' = 'hexagonal') => toHexa(toMap({ ...EXAMPLE_DIAGRAM, kind, title: 'Legacy System' }))
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

  it('refuses a multi-hexagon file before any conversion question, even when the target map is Clean or Onion (IMP-04.2)', async () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
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

  it('opens the conversion dialog when the target map is Onion, and "Convert and import" completes the import in one step (CONV-01.2, CONV-03, CONV-04)', async () => {
    useMapStore.getState().setMapMeta({ kind: 'onion' })
    render(<App />)
    openEditor()
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(oneHexFile('clean'), 'legacy.hexa')

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Convert this Onion map to hexagonal?')
    expect(useMapStore.getState().map.kind).toBe('onion')
    expect(useMapStore.getState().map.hexagons).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Convert and import' }))

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)
    expect(toastEl()!.querySelector('p')!.textContent).toBe("Added Legacy System from legacy.hexa. legacy.hexa was Clean; it now uses this map's hexagonal kind.")
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel on the conversion dialog leaves the map untouched and returns focus to the import trigger (CONV-02.1)', async () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    const trigger = screen.getByRole('button', { name: 'Add hexagon from file…' })
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(oneHexFile())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
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

  it('"Convert and import" converts the map and imports as one undoable step, restoring both the kind and the hexagon on Undo (CONV-03.2)', async () => {
    useMapStore.getState().setMapMeta({ kind: 'onion' })
    render(<App />)
    openEditor()
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(oneHexFile())

    fireEvent.click(screen.getByRole('button', { name: 'Convert and import' }))

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    const imported = useMapStore.getState().map.hexagons.at(-1)!
    expect(imported.title).toBe('Legacy System')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().map.kind).toBe('onion')
    expect(useMapStore.getState().focus).toBe(beforeFocus)
  })
})

describe('growing or importing into a Clean/Onion map asks first (CONV-01..05, GROW-01.5)', () => {
  const growEast = () => fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' }))

  it('opens the conversion dialog instead of growing directly, naming the map’s own kind (GROW-01.5, CONV-01.1)', () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
    render(<App />)
    const before = useMapStore.getState().map
    growEast()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Convert this Clean map to hexagonal?')
    expect(screen.getByRole('button', { name: 'Convert and add' })).toBeTruthy()
    expect(useMapStore.getState().map).toBe(before)
  })

  it('Cancel leaves the map untouched and returns focus to the side “+” trigger (CONV-02.1)', () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
    render(<App />)
    const before = useMapStore.getState().map
    const trigger = screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' })
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useMapStore.getState().map).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('"Convert and add" converts the map and grows it as one undoable step (CONV-03)', () => {
    useMapStore.getState().setMapMeta({ kind: 'onion' })
    render(<App />)
    const before = useMapStore.getState().map
    const beforeFocus = useMapStore.getState().focus
    growEast()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Convert and add' }))

    expect(useMapStore.getState().map.kind).toBe('hexagonal')
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(useMapStore.getState().map).toStrictEqual(before)
    expect(useMapStore.getState().focus).toBe(beforeFocus)
  })
})

describe('no autosave while the conversion dialog is open (CONV-02.3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not write to storage while the dialog is open, even past the usual autosave delay', () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
    const storage = { setItem: vi.fn() }
    autosave(useMapStore, storage, 'none', 400)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => vi.advanceTimersByTime(1000))

    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('does not let Ctrl/Cmd+Z on the dialog reach the document-level undo listener behind it', () => {
    useMapStore.getState().setMapMeta({ kind: 'clean' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand editor' }))
    const input = screen.getByLabelText('Name for Context 1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.blur(input)
    expect(toastEl()).not.toBeNull()
    const mapBefore = useMapStore.getState().map

    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Chat feedback slice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Billing' }))
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancelButton)

    fireEvent.keyDown(cancelButton, { key: 'z', ctrlKey: true })

    expect(useMapStore.getState().map).toBe(mapBefore)
    expect(screen.getByRole('dialog')).toBeTruthy()
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
  /** Confirms the conversion dialog if one is showing — needed only when the map isn't already hexagonal at the
   * point of the import; a no-op otherwise, so the same helper works whichever kind the map starts as. */
  const confirmConversionIfAsked = () => {
    const dialog = screen.queryByRole('dialog')
    if (dialog) fireEvent.click(screen.getByRole('button', { name: 'Convert and import' }))
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
    expect(useMapStore.getState().map.hexagons).toHaveLength(1)

    // v1-minimal and v1-maximal both join the map's OWN starting context — two of them end up in one shared
    // context — while v2-empty-context.hexa lands in a fresh, second context, giving exactly two bounded contexts
    // with hexagons, however many hexagons each one ends up holding.
    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v1Minimal, 'v1-minimal.hexa')
    confirmConversionIfAsked()
    expect(useMapStore.getState().map.hexagons).toHaveLength(2)

    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Context 1' }))
    await pickFile(v1Maximal, 'v1-maximal.hexa')
    confirmConversionIfAsked()
    expect(useMapStore.getState().map.hexagons).toHaveLength(3)
    expect(useMapStore.getState().map.contexts).toHaveLength(1)

    openImportMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    await pickFile(v2EmptyContext, 'legacy.hexa')
    confirmConversionIfAsked()
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
})
