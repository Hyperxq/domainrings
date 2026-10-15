import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LinkLoader } from './LinkLoader'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const layers = (container: HTMLElement, tag: 'polygon' | 'circle') => [...container.querySelectorAll<SVGElement>(`svg ${tag}`)]

describe('LinkLoader', () => {
  it('draws four nested hexagons when the draw lands below one half', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const { container } = render(<LinkLoader />)
    expect(layers(container, 'polygon')).toHaveLength(4)
    expect(layers(container, 'circle')).toHaveLength(0)
  })

  it('draws four nested circles otherwise', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7)
    const { container } = render(<LinkLoader />)
    expect(layers(container, 'circle')).toHaveLength(4)
    expect(layers(container, 'polygon')).toHaveLength(0)
  })

  it('orders the layers outwards from the core, which appears first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7)
    const { container } = render(<LinkLoader />)
    const byOrder = layers(container, 'circle')
      .map((layer) => ({ order: Number(layer.style.getPropertyValue('--i')), r: Number(layer.getAttribute('r')) }))
      .sort((a, b) => a.order - b.order)
    expect(byOrder.map((layer) => layer.order)).toEqual([0, 1, 2, 3])
    expect(byOrder.map((layer) => layer.r)).toEqual([...byOrder.map((layer) => layer.r)].sort((a, b) => a - b))
  })

  it('keeps its shape across re-renders', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const { container, rerender } = render(<LinkLoader />)
    random.mockReturnValue(0.9)
    rerender(<LinkLoader />)
    expect(layers(container, 'polygon')).toHaveLength(4)
  })

  it('announces itself as a polite status and hides the drawing from assistive tech', () => {
    const { container } = render(<LinkLoader />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('Opening the linked map…')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
