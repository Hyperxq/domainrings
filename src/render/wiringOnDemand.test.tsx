import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { legendFor } from '../layout/legend'
import { layoutMap } from '../layout/map'
import { EXAMPLES } from '../model/example'
import { diagramOf } from '../model/map'
import { notesOf } from '../model/notes'
import { plannedOf } from '../model/planned'
import type { HexaMap } from '../model/schema'
import { svgMarkup } from '../ui/exporters'
import { MapDiagram } from './Diagram'

const map = EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap
const hexId = map.hexagons[0].id

let style: HTMLStyleElement
beforeEach(() => {
  style = document.createElement('style')
  style.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
  document.head.appendChild(style)
})
afterEach(() => {
  cleanup()
  style.remove()
})

function draw(selected: string | null = null) {
  const { container } = render(
    <svg className="canvas">
      <MapDiagram
        map={layoutMap(map, { current: hexId })}
        legend={legendFor(diagramOf(map, hexId))}
        showGuides={false}
        focus={hexId}
        selected={selected}
        linkTargets={new Set()}
        crossLinkTargets={new Map()}
        hovered={null}
        notes={new Map(map.hexagons.map((h) => [h.id, notesOf(h)]))}
        planned={new Map(map.hexagons.map((h) => [h.id, plannedOf(h)]))}
      />
    </svg>,
  )
  return container.querySelector('svg')!
}

const wiring = (svg: Element) => [...svg.querySelectorAll('.edge-wiring')]
const shown = (el: Element) => getComputedStyle(el).display !== 'none'

describe('composition wiring on demand', () => {
  it('draws the wiring in the layout, hidden on the canvas by default', () => {
    const svg = draw()
    expect(wiring(svg).length).toBeGreaterThan(0)
    expect(wiring(svg).every((el) => !shown(el))).toBe(true)
  })

  it('hides it again once the composition box is deselected', () => {
    const svg = draw()
    const box = svg.querySelector('.node-composition')!
    box.setAttribute('data-selected', '')
    expect(wiring(svg).every(shown)).toBe(true)
    box.removeAttribute('data-selected')
    expect(wiring(svg).every((el) => !shown(el))).toBe(true)
  })

  it('shows it while the composition box is selected', () => {
    const svg = draw('composition')
    expect(svg.querySelector('.node-composition[data-selected]')).not.toBeNull()
    expect(wiring(svg).length).toBeGreaterThan(0)
    expect(wiring(svg).every(shown)).toBe(true)
  })

  it('stays hidden when another box is selected', () => {
    const svg = draw(map.hexagons[0].useCases[0].id)
    expect(svg.querySelector('[data-selected]:not(.node-composition)')).not.toBeNull()
    expect(wiring(svg).length).toBeGreaterThan(0)
    expect(wiring(svg).every((el) => !shown(el))).toBe(true)
  })

  it('keeps the wiring in the exported SVG', async () => {
    const svg = draw()
    const live = wiring(svg).length
    const markup = await svgMarkup(svg, { x: 0, y: 0, width: 400, height: 300 }, 'Stress', { legend: false, legendHeight: 0 })
    expect((markup.match(/<path[^>]*stroke-dasharray="4,? ?4"/g) ?? []).length).toBe(live)
    expect(markup).not.toMatch(/display/)
  })
})
