import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FULL_TOOLBAR, Toolbar } from './Toolbar'

type Listener = () => void
let roomy = true
const listeners = new Set<Listener>()

beforeEach(() => {
  roomy = true
  listeners.clear()
  window.matchMedia = ((media: string) => ({
    get matches() {
      return media === FULL_TOOLBAR ? roomy : false
    },
    media,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof matchMedia
})
afterEach(cleanup)

function renderToolbar(overrides: { kindLocked?: boolean } = {}) {
  const props = {
    kind: 'hexagonal' as const,
    kindLocked: false,
    theme: 'light' as const,
    onKind: vi.fn(),
    onNew: vi.fn(),
    onExample: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onTheme: vi.fn(),
    mode: 'detailed' as const,
    onMode: vi.fn(),
    guides: true,
    onGuides: vi.fn(),
    highlight: true,
    onHighlight: vi.fn(),
    showScope: false,
    exportScope: 'map' as const,
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
})

describe('Toolbar below the full-width breakpoint', () => {
  beforeEach(() => {
    roomy = false
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

    roomy = true
    act(() => listeners.forEach((l) => l()))

    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export as SVG' })).toBeTruthy()
  })
})
