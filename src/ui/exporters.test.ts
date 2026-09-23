import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { svgMarkup } from './exporters'

const NS = 'http://www.w3.org/2000/svg'
const bounds = { x: 0, y: 0, width: 400, height: 300 }

function canvas() {
  const svg = document.createElementNS(NS, 'svg')
  const rect = document.createElementNS(NS, 'rect')
  const legend = document.createElementNS(NS, 'g')
  legend.setAttribute('data-legend', '')
  legend.appendChild(document.createElementNS(NS, 'text')).textContent = 'Legend'
  svg.append(rect, legend)
  document.body.appendChild(svg)
  return svg
}

describe('svgMarkup legend', () => {
  beforeEach(() => vi.stubGlobal('fetch', () => Promise.reject(new Error('offline'))))
  afterEach(() => vi.unstubAllGlobals())

  it('includes the legend block when asked', async () => {
    const markup = await svgMarkup(canvas(), bounds, 'T', { legend: true, legendHeight: 120 })
    expect(markup).toContain('data-legend')
    expect(markup).toContain('>Legend<')
    expect(markup).toContain('viewBox="0 0 400 436"')
  })

  it('omits the legend block and its space when not asked', async () => {
    const markup = await svgMarkup(canvas(), bounds, 'T', { legend: false, legendHeight: 120 })
    expect(markup).not.toContain('data-legend')
    expect(markup).toContain('viewBox="0 0 400 300"')
  })
})
