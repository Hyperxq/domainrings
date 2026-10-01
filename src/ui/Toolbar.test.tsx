import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FULL_TOOLBAR, ROOMY_TOOLBAR, Toolbar } from './Toolbar'
import { usePreferencesStore } from './state/preferencesStore'
import { useMapStore } from '../model/store'
import { manyHexagonMap } from '../test/fixtures'
import { useViewStore } from './state/viewStore'

type Listener = () => void
const minWidth = (query: string) => Number(/min-width: (\d+)px/.exec(query)![1])
const FULL = minWidth(FULL_TOOLBAR)
const ROOMY = minWidth(ROOMY_TOOLBAR)
let viewport = FULL
let systemDark = false
const listeners = new Set<Listener>()

beforeEach(() => {
  viewport = FULL
  systemDark = false
  listeners.clear()
  window.matchMedia = ((media: string) => ({
    get matches() {
      return media === '(prefers-color-scheme: dark)' ? systemDark : viewport >= minWidth(media)
    },
    media,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof matchMedia
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Seeds the stores the toolbar reads, then renders it; its choices land in those stores. */
function renderToolbar(
  overrides: {
    mode?: 'overview' | 'detailed'
    guides?: boolean
    highlight?: boolean
    dependents?: boolean
    showScope?: boolean
    exportScope?: 'map' | 'hexagon'
    themeChoice?: 'light' | 'dark' | 'system'
    palette?: 'default' | 'ink' | 'moss'
    canExpandAll?: boolean
  } = {},
) {
  const { mode = 'detailed', guides = true, highlight = true, dependents = false, themeChoice = 'system', palette = 'default', exportScope = 'map', showScope = false, canExpandAll = false } = overrides
  usePreferencesStore.setState({ mode, guides, highlight, dependents, theme: themeChoice, palette })
  useViewStore.setState({ exportScope })
  const props = { onNew: vi.fn(), onExample: vi.fn(), onOpen: vi.fn(), onCopyLink: vi.fn(), onExport: vi.fn() }
  render(<Toolbar {...props} showScope={showScope} canExpandAll={canExpandAll} />)
  return props
}

describe('Toolbar at full width', () => {
  it('has a Dependents switch that shows its state, explains itself and flips on click', () => {
    renderToolbar({ dependents: false })
    const toggle = screen.getByRole('switch', { name: 'Dependents' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.getAttribute('title')).toMatch(/what depends on the selection/i)

    fireEvent.click(toggle)

    expect(usePreferencesStore.getState().dependents).toBe(true)
    cleanup()
    renderToolbar({ dependents: true })
    expect(screen.getByRole('switch', { name: 'Dependents' }).getAttribute('aria-checked')).toBe('true')
  })

  it('draws every switch as a track with a knob, activated by Space and Enter because it is a native button', () => {
    renderToolbar()
    for (const name of ['Guides', 'Highlight', 'Dependents']) {
      const toggle = screen.getByRole('switch', { name })
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.querySelector('.switch-track > .switch-knob')).not.toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Guides' })).toBeNull()
  })

  it('offers the detail level as one radio group whose selected half is checked', () => {
    renderToolbar({ mode: 'overview' })
    const group = screen.getByRole('radiogroup', { name: 'Detail level' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked'), r.getAttribute('tabindex')])).toEqual([
      ['Overview', 'true', '0'],
      ['Detailed', 'false', '-1'],
    ])
  })

  it.each([
    ['Overview', 'ArrowRight', 'detailed'],
    ['Overview', 'ArrowDown', 'detailed'],
    ['Overview', 'ArrowLeft', 'detailed'],
    ['Detailed', 'ArrowLeft', 'overview'],
    ['Detailed', 'ArrowUp', 'overview'],
    ['Detailed', 'ArrowRight', 'overview'],
  ] as const)('moves the choice and the focus from %s on %s', (from, key, mode) => {
    renderToolbar({ mode: from === 'Overview' ? 'overview' : 'detailed' })
    const radio = screen.getByRole('radio', { name: from })
    radio.focus()
    fireEvent.keyDown(radio, { key })
    expect(usePreferencesStore.getState().mode).toBe(mode)
    expect(document.activeElement).toBe(screen.getByRole('radio', { checked: true }))
  })

  it('separates the detail level, the switches and the actions with dividers', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    renderToolbar({ canExpandAll: true })
    const dividers = [...document.querySelectorAll('.toolbar .divider')]
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const between = (a: Element, b: Element) => dividers.some((d) => before(a, d) && before(d, b))
    const mode = screen.getByRole('radiogroup', { name: 'Detail level' })
    const guides = screen.getByRole('switch', { name: 'Guides' })
    const dependents = screen.getByRole('switch', { name: 'Dependents' })
    const expand = screen.getByRole('button', { name: 'Expand all' })
    expect(between(mode, guides)).toBe(true)
    expect(between(dependents, expand)).toBe(true)
    expect(between(guides, dependents)).toBe(false)
  })

  it('shows the three export buttons and no compact controls — no kind switcher anywhere (REQ-01)', () => {
    renderToolbar()
    expect(screen.queryByRole('radio', { name: /Hexagonal|Clean|Onion/ })).toBeNull()
    for (const name of ['Save as .hexa file', 'Export as SVG', 'Export as PNG']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })

  it('seats the export scope between the Export label and the formats, so it reads as part of the export', () => {
    renderToolbar({ showScope: true })
    const scope = screen.getByRole('group', { name: 'Export scope' })
    const exportGroup = screen.getByRole('group', { name: 'Export' })
    const label = screen.getByText('Export')
    expect(label.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(scope.compareDocumentPosition(exportGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(scope.parentElement).toBe(exportGroup.parentElement)
  })
})

describe('Toolbar below the full-width breakpoint', () => {
  beforeEach(() => {
    viewport = FULL - 1
  })

  it('has no kind select at this breakpoint either (REQ-01)', () => {
    renderToolbar()
    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Clean' })).toBeNull()
  })

  it.each([
    ['.hexa', 'hexa'],
    ['SVG', 'svg'],
    ['PNG', 'png'],
  ] as const)('collapses the export buttons into a menu whose %s choice exports %s', (label, format) => {
    const { onExport } = renderToolbar()
    expect(screen.queryByRole('button', { name: 'Export as SVG' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))

    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith(format)
  })

  it('follows the viewport across the breakpoint', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'Export as SVG' })).toBeNull()

    viewport = FULL
    act(() => listeners.forEach((l) => l()))

    expect(screen.getByRole('button', { name: 'Export as SVG' })).toBeTruthy()
  })
})

describe('Toolbar expand and collapse all', () => {
  it('shows Expand all and Collapse all beside the view toggles, each setting its own direction', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    renderToolbar({ canExpandAll: true })
    expect(screen.getByRole('button', { name: 'Expand all' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Collapse all' }).querySelector('svg')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect([...useViewStore.getState().expanded]).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(useViewStore.getState().expanded.size).toBe(0)
  })

  it('shows neither when the map has nothing to expand', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull()
  })

  it('folds both into the View menu below the roomy breakpoint', () => {
    viewport = ROOMY - 1
    useMapStore.getState().replace(manyHexagonMap(6))
    renderToolbar({ canExpandAll: true })
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expand all' }))
    expect(useViewStore.getState().expanded.size).toBe(6)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse all' }))
    expect(useViewStore.getState().expanded.size).toBe(0)
  })
})

describe('Toolbar between the two breakpoints', () => {
  beforeEach(() => {
    viewport = ROOMY
  })

  it('keeps the file buttons labelled and the detail level and toggles in the bar', () => {
    renderToolbar()
    for (const text of ['New', 'Example', 'Open…']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Guides' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('folds the export scope into the Export menu as soon as the formats are a menu', () => {
    renderToolbar({ showScope: true, exportScope: 'map' })
    expect(screen.queryByRole('radio', { name: 'Hexagon' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const items = screen.getAllByRole('menu')[0].querySelectorAll('[role^="menuitem"]')
    expect([...items].map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Map', 'true'],
      ['Hexagon', 'false'],
      ['.hexa', null],
      ['SVG', null],
      ['PNG', null],
    ])

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hexagon' }))
    expect(useViewStore.getState().exportScope).toBe('hexagon')
  })
})

describe('Toolbar below the compact breakpoint', () => {
  beforeEach(() => {
    viewport = ROOMY - 1
  })

  const openView = () => fireEvent.click(screen.getByRole('button', { name: 'View' }))

  it('shows the file actions as icons that keep their accessible names and tooltips', () => {
    renderToolbar()
    for (const text of ['New', 'Example', 'Open…']) expect(screen.queryByText(text)).toBeNull()
    expect(screen.getByRole('button', { name: 'New diagram' }).getAttribute('title')).toBe('New diagram')
    expect(screen.getByRole('combobox', { name: 'Load an example' }).closest('label')!.getAttribute('title')).toBe('Load an example')
    expect(screen.getByLabelText('Open a .hexa file, replacing the map').closest('label')!.getAttribute('title')).toBe('Open a .hexa file, replacing the map')
  })

  it('moves the detail level and the toggles into a View menu that shows their state', () => {
    renderToolbar({ mode: 'overview', guides: false, highlight: true })
    expect(screen.queryByRole('radio', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Guides' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Highlight' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Dependents' })).toBeNull()

    openView()

    const state = [...screen.getAllByRole('menuitemradio'), ...screen.getAllByRole('menuitemcheckbox')].map((item) => [item.textContent, item.getAttribute('aria-checked')])
    expect(state).toEqual([
      ['Overview', 'true'],
      ['Detailed', 'false'],
      ['Guides', 'false'],
      ['Highlight', 'true'],
      ['Dependents', 'false'],
    ])
  })

  it.each([
    ['Overview', 'mode', 'overview'],
    ['Detailed', 'mode', 'detailed'],
    ['Guides', 'guides', true],
    ['Highlight', 'highlight', false],
    ['Dependents', 'dependents', true],
  ] as const)('choosing %s in the View menu sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ mode: 'detailed', guides: false, highlight: true })
    const before = usePreferencesStore.getState()
    openView()
    fireEvent.click(screen.getByRole(field === 'mode' ? 'menuitemradio' : 'menuitemcheckbox', { name }))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it('shows the same three kinds of control in the View menu: a segmented mode, switches and icon actions, set apart', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    renderToolbar({ canExpandAll: true })
    openView()
    const menu = screen.getByRole('menu')
    const pill = within(menu).getAllByRole('menuitemradio')[0].parentElement!
    expect(pill.classList.contains('segmented')).toBe(true)
    expect(within(pill).getAllByRole('menuitemradio')).toHaveLength(2)
    for (const item of within(menu).getAllByRole('menuitemcheckbox')) expect(item.querySelector('.switch-track > .switch-knob')).not.toBeNull()
    for (const name of ['Expand all', 'Collapse all']) expect(within(menu).getByRole('menuitem', { name }).querySelector('svg')).not.toBeNull()
    expect(within(menu).getAllByRole('separator')).toHaveLength(2)
  })

  it('keeps the Export menu, with no kind select anywhere (REQ-01)', () => {
    const { onExport } = renderToolbar()
    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }))
    expect(onExport).toHaveBeenCalledWith('svg')
  })

  const openExport = () => fireEvent.click(screen.getByRole('button', { name: 'Export' }))

  it('folds the export scope into the Export menu, checked by the current scope, ahead of the formats', () => {
    renderToolbar({ showScope: true, exportScope: 'map' })
    expect(screen.queryByRole('radio', { name: 'Hexagon' })).toBeNull()

    openExport()

    const items = screen.getAllByRole('menu')[0].querySelectorAll('[role^="menuitem"]')
    expect([...items].map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Map', 'true'],
      ['Hexagon', 'false'],
      ['.hexa', null],
      ['SVG', null],
      ['PNG', null],
    ])
  })

  it('choosing a scope in the Export menu sets the scope and exports nothing', () => {
    const { onExport } = renderToolbar({ showScope: true, exportScope: 'map' })
    openExport()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hexagon' }))
    expect(useViewStore.getState().exportScope).toBe('hexagon')
    expect(onExport).not.toHaveBeenCalled()
  })

  it('choosing a format in the Export menu exports it and leaves the scope alone', () => {
    const { onExport } = renderToolbar({ showScope: true, exportScope: 'hexagon' })
    openExport()
    fireEvent.click(screen.getByRole('menuitem', { name: 'PNG' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('png')
    expect(useViewStore.getState().exportScope).toBe('hexagon')
  })

  it('lists no scope items for a single-hexagon map', () => {
    renderToolbar({ showScope: false })
    openExport()
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['.hexa', 'SVG', 'PNG'])
  })
})

// At a literal phone width (below styles.css's toolbar wrap point, TOOLBAR-PHONE-01) the markup is the same
// icon-only tier as above — styles.css wraps it into two rows instead of scrolling sideways — so this pins the
// requirement that drove the wrap: nothing is dropped for it to hide, every control stays reachable as one of
// the three menus or a labelled icon/link.
describe('Toolbar at phone width', () => {
  beforeEach(() => {
    viewport = 390
  })

  it('keeps every control reachable: the three menus, the labelled file actions, and the GitHub link', () => {
    renderToolbar({ showScope: true })
    for (const name of ['View', 'Export', 'Appearance']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New diagram' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Load an example' })).toBeTruthy()
    expect(screen.getByLabelText('Open a .hexa file, replacing the map')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View the source on GitHub' })).toBeTruthy()
  })
})

describe('Toolbar appearance menu', () => {
  const openAppearance = () => fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  const iconPath = () => screen.getByRole('button', { name: 'Appearance' }).querySelector('path')!.getAttribute('d')!
  const MOON = /^M21 12\.8/
  const SUN = /^M12 8a4/

  it.each([FULL, FULL - 1, ROOMY - 1])('is one icon-sized trigger at a %ipx viewport', (width) => {
    viewport = width
    renderToolbar()
    const trigger = screen.getByRole('button', { name: 'Appearance' })
    expect(trigger.classList.contains('icon-trigger')).toBe(true)
    expect(trigger.textContent).toBe('')
  })

  it('lists the theme choices and then the palettes, checking the stored theme and the active palette', () => {
    renderToolbar({ themeChoice: 'dark', palette: 'ink' })
    openAppearance()
    const state = screen.getAllByRole('menuitemcheckbox').map((item) => [item.firstChild!.textContent, item.getAttribute('aria-checked')])
    expect(state).toEqual([
      ['Light', 'false'],
      ['Dark', 'true'],
      ['System', 'false'],
      ['Default', 'false'],
      ['Ink', 'true'],
      ['Moss', 'false'],
    ])
  })

  it('checks System and Default when nothing is chosen', () => {
    renderToolbar()
    openAppearance()
    expect(screen.getByRole('menuitemcheckbox', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: /^Default/ }).getAttribute('aria-checked')).toBe('true')
  })

  it.each([
    ['Light', 'theme', 'light'],
    ['Dark', 'theme', 'dark'],
    ['System', 'theme', 'system'],
    ['Default', 'palette', 'default'],
    ['Moss', 'palette', 'moss'],
  ] as const)('choosing %s sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ themeChoice: 'light', palette: 'ink' })
    const before = usePreferencesStore.getState()
    openAppearance()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it('shows the moon on a light page and the sun on a dark one, resolving System from the OS', () => {
    renderToolbar({ themeChoice: 'light' })
    expect(iconPath()).toMatch(MOON)
    cleanup()
    renderToolbar({ themeChoice: 'dark' })
    expect(iconPath()).toMatch(SUN)
    cleanup()
    systemDark = true
    renderToolbar({ themeChoice: 'system' })
    expect(iconPath()).toMatch(SUN)
  })
})
