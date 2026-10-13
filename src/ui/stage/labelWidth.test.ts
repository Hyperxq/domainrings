import { afterEach, describe, expect, it, vi } from 'vitest'
import { labelTextWidth, resetLabelFont } from './labelWidth'

afterEach(() => {
  vi.restoreAllMocks()
  resetLabelFont()
})

describe('labelTextWidth', () => {
  it('is never narrower than the old 0.6em estimate when there is no canvas', () => {
    expect(labelTextWidth('LibraryDocuments', 11)).toBeGreaterThan(16 * 11 * 0.6)
  })

  it('measures with the label font on a canvas, once per text', () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 7.5 }))
    const font: string[] = []
    const context = { measureText, set font(f: string) { font.push(f) } }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    document.documentElement.style.setProperty('--font-mono', "'Plex Mono', monospace")
    try {
      expect(labelTextWidth('Clock', 11)).toBe(37.5)
      expect(labelTextWidth('Clock', 11)).toBe(37.5)
      expect(measureText).toHaveBeenCalledTimes(1)
      expect(font[0]).toBe("600 11px 'Plex Mono', monospace")
    } finally {
      document.documentElement.style.removeProperty('--font-mono')
    }
  })
})
