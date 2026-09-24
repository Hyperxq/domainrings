import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FULL_TOOLBAR, ROOMY_TOOLBAR, Toolbar } from './Toolbar'

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
afterEach(cleanup)

function renderToolbar(
  overrides: {
    kindLocked?: boolean
    mode?: 'overview' | 'detailed'
    guides?: boolean
    highlight?: boolean
    showScope?: boolean
    exportScope?: 'map' | 'hexagon'
    themeChoice?: 'light' | 'dark' | 'system'
    palette?: 'default' | 'ink' | 'moss'
  } = {},
) {
  const props = {
    kind: 'hexagonal' as const,
    kindLocked: false,
    themeChoice: 'system' as 'light' | 'dark' | 'system',
    palette: 'default' as 'default' | 'ink' | 'moss',
    onKind: vi.fn(),
    onNew: vi.fn(),
    onExample: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onTheme: vi.fn(),
    onPalette: vi.fn(),
    mode: 'detailed' as const,
    onMode: vi.fn(),
    guides: true,
    onGuides: vi.fn(),
    highlight: true,
    onHighlight: vi.fn(),
    showScope: false,
    exportScope: 'map' as 'map' | 'hexagon',
    onExportScope: vi.fn(),
    ...overrides,
  }
  render(<Toolbar {...props} />)
  return props
}

const HINT = 'A map with more than one hexagon is always hexagonal.'

describe('Toolbar at full width', () => {
  it('shows the kind radios and the three export buttons, and no compact controls', () => {
    renderToolbar()
    expect(screen.getAllByRole('radio', { name: /Hexagonal|Clean|Onion/ })).toHaveLength(3)
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

  it('collapses the kind radios into a select that drives the same onKind', () => {
    const { onKind } = renderToolbar()
    const select = screen.getByRole('combobox', { name: 'Architecture style' }) as HTMLSelectElement
    expect(screen.queryByRole('radio', { name: 'Clean' })).toBeNull()
    expect([...select.options].map((o) => o.textContent)).toEqual(['Hexagonal', 'Clean', 'Onion'])
    expect(select.value).toBe('hexagonal')
    expect(select.getAttribute('aria-disabled')).toBeNull()
    expect(select.getAttribute('aria-describedby')).toBeNull()

    fireEvent.change(select, { target: { value: 'clean' } })

    expect(onKind).toHaveBeenCalledWith('clean')
  })

  it('locks the select like the radios: aria-disabled, the hint by aria-describedby, and the hint as its title', () => {
    renderToolbar({ kindLocked: true })
    const select = screen.getByRole('combobox', { name: 'Architecture style' })
    expect(select.getAttribute('aria-disabled')).toBe('true')
    const hint = document.getElementById(select.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toBe(HINT)
    expect(hint.classList.contains('visually-hidden')).toBe(true)
    expect(select.getAttribute('title')).toBe(HINT)
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
    expect(screen.getByRole('combobox', { name: 'Architecture style' })).toBeTruthy()

    viewport = FULL
    act(() => listeners.forEach((l) => l()))

    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export as SVG' })).toBeTruthy()
  })
})

describe('Toolbar between the two breakpoints', () => {
  beforeEach(() => {
    viewport = ROOMY
  })

  it('keeps the file buttons labelled and the detail level and toggles in the bar', () => {
    renderToolbar()
    for (const text of ['New', 'Example', 'Import']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guides' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('folds the export scope into the Export menu as soon as the formats are a menu', () => {
    const { onExportScope } = renderToolbar({ showScope: true, exportScope: 'map' })
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
    expect(onExportScope).toHaveBeenCalledWith('hexagon')
  })
})

describe('Toolbar below the compact breakpoint', () => {
  beforeEach(() => {
    viewport = ROOMY - 1
  })

  const openView = () => fireEvent.click(screen.getByRole('button', { name: 'View' }))

  it('shows the file actions as icons that keep their accessible names and tooltips', () => {
    renderToolbar()
    for (const text of ['New', 'Example', 'Import']) expect(screen.queryByText(text)).toBeNull()
    expect(screen.getByRole('button', { name: 'New diagram' }).getAttribute('title')).toBe('New diagram')
    expect(screen.getByRole('combobox', { name: 'Load an example' }).closest('label')!.getAttribute('title')).toBe('Load an example')
    expect(screen.getByLabelText('Import a .hexa file').closest('label')!.getAttribute('title')).toBe('Import a .hexa file')
  })

  it('moves the detail level and the toggles into a View menu that shows their state', () => {
    renderToolbar({ mode: 'overview', guides: false, highlight: true })
    expect(screen.queryByRole('radio', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Guides' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Highlight' })).toBeNull()

    openView()

    const state = screen.getAllByRole('menuitemcheckbox').map((item) => [item.textContent, item.getAttribute('aria-checked')])
    expect(state).toEqual([
      ['Overview', 'true'],
      ['Detailed', 'false'],
      ['Guides', 'false'],
      ['Highlight', 'true'],
    ])
  })

  it.each([
    ['Overview', 'onMode', 'overview'],
    ['Detailed', 'onMode', 'detailed'],
    ['Guides', 'onGuides', true],
    ['Highlight', 'onHighlight', false],
  ] as const)('choosing %s in the View menu calls %s with %s', (name, handler, value) => {
    const props = renderToolbar({ mode: 'detailed', guides: false, highlight: true })
    openView()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
    expect(props[handler]).toHaveBeenCalledTimes(1)
    expect(props[handler]).toHaveBeenCalledWith(value)
    for (const other of (['onMode', 'onGuides', 'onHighlight'] as const).filter((h) => h !== handler)) expect(props[other]).not.toHaveBeenCalled()
  })

  it('keeps the kind select and the Export menu', () => {
    const { onExport } = renderToolbar()
    expect(screen.getByRole('combobox', { name: 'Architecture style' })).toBeTruthy()
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
    const { onExport, onExportScope } = renderToolbar({ showScope: true, exportScope: 'map' })
    openExport()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hexagon' }))
    expect(onExportScope).toHaveBeenCalledTimes(1)
    expect(onExportScope).toHaveBeenCalledWith('hexagon')
    expect(onExport).not.toHaveBeenCalled()
  })

  it('choosing a format in the Export menu exports it and leaves the scope alone', () => {
    const { onExport, onExportScope } = renderToolbar({ showScope: true, exportScope: 'hexagon' })
    openExport()
    fireEvent.click(screen.getByRole('menuitem', { name: 'PNG' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('png')
    expect(onExportScope).not.toHaveBeenCalled()
  })

  it('lists no scope items for a single-hexagon map', () => {
    renderToolbar({ showScope: false })
    openExport()
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['.hexa', 'SVG', 'PNG'])
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
    ['Light', 'onTheme', 'light'],
    ['Dark', 'onTheme', 'dark'],
    ['System', 'onTheme', 'system'],
    ['Default', 'onPalette', 'default'],
    ['Moss', 'onPalette', 'moss'],
  ] as const)('choosing %s calls %s with %s and nothing else', (name, handler, value) => {
    const props = renderToolbar({ themeChoice: 'light', palette: 'ink' })
    openAppearance()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }))
    expect(props[handler]).toHaveBeenCalledTimes(1)
    expect(props[handler]).toHaveBeenCalledWith(value)
    expect(props[handler === 'onTheme' ? 'onPalette' : 'onTheme']).not.toHaveBeenCalled()
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
