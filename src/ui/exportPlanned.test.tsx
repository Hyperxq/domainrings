import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { legendFor } from '../layout/legend'
import { layoutMap } from '../layout/map'
import { MapDiagram } from '../render/Diagram'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import { diagramOf } from '../model/map'
import { notesOf } from '../model/notes'
import { plannedOf } from '../model/planned'
import type { HexaMap } from '../model/schema'
import { svgMarkup } from './exporters'

afterEach(cleanup)

function plannedMap(): HexaMap {
  const map = toMap(EXAMPLE_DIAGRAM)
  const [h] = map.hexagons
  const second = { ...h, id: 'h2', contextId: 'c2', cell: { q: 1, r: 0 }, title: 'Second', status: 'planned' as const }
  return {
    ...map,
    contexts: [{ id: 'c1' }, { id: 'c2' }],
    hexagons: [{ ...h, useCases: h.useCases.map((u) => ({ ...u, status: 'planned' as const })) }, second],
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' }, status: 'planned' }],
  }
}

describe('svgMarkup — planned styling survives an export', () => {
  it('inlines the dashed, faded paint of planned boxes, rings and links', async () => {
    const map = plannedMap()
    const model = layoutMap(map, { current: 'h1' })
    const { container } = render(
      <svg>
        <MapDiagram
          map={model}
          legend={legendFor(diagramOf(map, 'h1'), true)}
          showGuides={false}
          focus="h1"
          selected={null}
          linkTargets={new Set()}
          crossLinkTargets={new Map()}
          hovered={null}
          notes={new Map(map.hexagons.map((h) => [h.id, notesOf(h)]))}
          planned={new Map(map.hexagons.map((h) => [h.id, plannedOf(h)]))}
        />
      </svg>,
    )
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      const markup = await svgMarkup(container.querySelector('svg')!, model.bounds, 'Map', { legend: false, legendHeight: 0 })
      const exported = new DOMParser().parseFromString(markup, 'text/html')
      const dashed = (selector: string, dash: string) => [...exported.querySelectorAll(selector)].filter((el) => el.getAttribute('stroke-dasharray') === dash)
      const boxes = dashed('rect', '4 3')
      expect(boxes.length).toBeGreaterThan(0)
      expect(boxes.every((r) => r.parentElement!.getAttribute('opacity') === '0.55')).toBe(true)
      const rings = dashed('path', '8 5')
      expect(rings.length).toBeGreaterThan(0)
      expect(rings.every((p) => p.getAttribute('opacity') === '0.55')).toBe(true)
      expect([...exported.querySelectorAll('path')].some((p) => p.getAttribute('opacity') === '0.4')).toBe(true)
    } finally {
      style.remove()
    }
  })
})
