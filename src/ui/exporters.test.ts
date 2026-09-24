import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/** A two-hexagon `MapDiagram`-shaped canvas: h1 current (with hover + cue), h2 a click-to-focus control, one
 * map link and one map title, plus the shared legend — the fixture `only`/legend/cue export scoping runs against. */
function mapCanvas() {
  const svg = document.createElementNS(NS, 'svg')

  const h1 = document.createElementNS(NS, 'g')
  h1.setAttribute('data-hex', 'h1')
  h1.setAttribute('aria-current', 'true')
  h1.setAttribute('data-hover', 'outer')
  const h1Marker = document.createElementNS(NS, 'text')
  h1Marker.textContent = 'H1 marker'
  const cue = document.createElementNS(NS, 'path')
  cue.setAttribute('data-cue', '')
  h1.append(h1Marker, cue)

  const h2 = document.createElementNS(NS, 'g')
  h2.setAttribute('data-hex', 'h2')
  h2.setAttribute('role', 'button')
  h2.setAttribute('tabindex', '0')
  const h2Marker = document.createElementNS(NS, 'text')
  h2Marker.textContent = 'H2 marker'
  h2.append(h2Marker)

  const link = document.createElementNS(NS, 'line')
  link.setAttribute('data-map-link', '')
  link.setAttribute('class', 'map-link')
  link.setAttribute('aria-hidden', 'true')

  const mapTitle = document.createElementNS(NS, 'text')
  mapTitle.setAttribute('data-map-title', '')
  mapTitle.textContent = 'Map title'

  const legend = document.createElementNS(NS, 'g')
  legend.setAttribute('data-legend', '')
  legend.appendChild(document.createElementNS(NS, 'text')).textContent = 'Legend'

  svg.append(h1, h2, link, mapTitle, legend)
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

  it('drops the canvas editing hooks from every element', async () => {
    const svg = canvas()
    const node = svg.querySelector('rect')!
    for (const [k, v] of Object.entries({ tabindex: '0', role: 'button', 'aria-label': 'Edit X', 'data-ref': 'x', 'data-band': 'domain', 'data-layer': 'domain', 'data-selected': '' })) node.setAttribute(k, v)
    const markup = await svgMarkup(svg, bounds, 'T', { legend: true, legendHeight: 120 })
    expect(markup).not.toMatch(/tabindex|role=|aria-label|data-ref|data-band|data-layer|data-selected/)
  })
})

describe('svgMarkup export scope (SEAM-07, EXPORT-01/02)', () => {
  beforeEach(() => vi.stubGlobal('fetch', () => Promise.reject(new Error('offline'))))
  afterEach(() => vi.unstubAllGlobals())

  it('map scope (no `only`) keeps every hexagon and the map link/title, and strips the scoping attributes and the cue (EXPORT-01.1)', async () => {
    const markup = await svgMarkup(mapCanvas(), bounds, 'Map title', { legend: false, legendHeight: 0 })
    expect(markup).toContain('H1 marker')
    expect(markup).toContain('H2 marker')
    expect(markup).toContain('Map title')
    expect(markup).not.toMatch(/data-hex|aria-current|data-cue|data-map-link|data-map-title|data-hover/)
  })

  it('map scope omits the legend even when asked, per the multi-hexagon legend rule', async () => {
    const markup = await svgMarkup(mapCanvas(), bounds, 'Map title', { legend: true, legendHeight: 120 })
    expect(markup).not.toContain('data-legend')
  })

  it('hexagon scope (`only`) keeps just that hexagon, drops the map link and map title, and includes the legend (EXPORT-02.1)', async () => {
    const markup = await svgMarkup(mapCanvas(), bounds, 'H2', { legend: true, legendHeight: 40, only: 'h2' })
    expect(markup).not.toContain('H1 marker')
    expect(markup).toContain('H2 marker')
    expect(markup).not.toMatch(/data-map-link|data-map-title/)
    expect(markup).not.toContain('Map title')
    expect(markup).toContain('data-legend')
    expect(markup).toContain('>Legend<')
    expect(markup).not.toMatch(/data-hex|aria-current|data-cue|data-hover/)
  })

  it('carries a visible (non-none) stroke on the map link into the exported markup', async () => {
    const styleTag = document.createElement('style')
    styleTag.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    document.head.appendChild(styleTag)
    try {
      const markup = await svgMarkup(mapCanvas(), bounds, 'Map title', { legend: false, legendHeight: 0 })
      const lineMarkup = markup.match(/<line[^>]*>/)?.[0] ?? ''
      const stroke = lineMarkup.match(/stroke="([^"]*)"/)?.[1]
      // An unstyled SVG line's computed stroke resolves to transparent black in jsdom, not the literal
      // keyword `none` — so the invisibility bug must be caught against the transparent value too.
      expect(stroke).toBeTruthy()
      expect(stroke).not.toBe('none')
      expect(stroke).not.toBe('rgba(0, 0, 0, 0)')
    } finally {
      styleTag.remove()
    }
  })

  it('clears the current hexagon’s hover before exporting, and restores it on the live canvas afterward', async () => {
    const svg = mapCanvas()
    const group = svg.querySelector('[data-hex="h1"]')!
    expect(group.getAttribute('data-hover')).toBe('outer')

    const markup = await svgMarkup(svg, bounds, 'Map title', { legend: false, legendHeight: 0 })

    expect(markup).not.toContain('data-hover')
    expect(group.getAttribute('data-hover')).toBe('outer')
  })
})
