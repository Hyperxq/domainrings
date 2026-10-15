import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { legendFor } from '../layout/legend'
import { layoutMap } from '../layout/map'
import { EXAMPLES } from '../model/example'
import { notesOf } from '../model/notes'
import { plannedOf } from '../model/planned'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { MapDiagram } from './Diagram'
import { dotsOf, MAX_DOTS } from './ThreadDots'

afterEach(cleanup)

const map = EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap
const draw = (edit?: (model: ReturnType<typeof layoutMap>) => void) => {
  const model = layoutMap(map, { current: map.hexagons[0].id })
  edit?.(model)
  const { container } = render(
    <svg>
      <MapDiagram
        map={model}
        legend={legendFor(diagramOf(map, map.hexagons[0].id))}
        showGuides={false}
        focus={map.hexagons[0].id}
        selected={null}
        linkTargets={new Set()}
        crossLinkTargets={new Map()}
        hovered={null}
        notes={new Map(map.hexagons.map((h) => [h.id, notesOf(h)]))}
        planned={new Map(map.hexagons.map((h) => [h.id, plannedOf(h)]))}
      />
    </svg>,
  )
  return { container, model }
}

describe('dotsOf', () => {
  const marks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, slot: i }))
  it('shows every dot up to the limit', () => {
    expect(MAX_DOTS).toBe(4)
    expect(dotsOf(marks(4))).toEqual({ shown: marks(4), more: 0 })
  })
  it('counts the rest from 5 threads on', () => {
    expect(dotsOf(marks(5))).toEqual({ shown: marks(4), more: 1 })
    expect(dotsOf(marks(9)).more).toBe(5)
  })
})

describe('thread edges', () => {
  it('stroke an edge in its thread colour, through a custom property the palette switches per mode', () => {
    const { container, model } = draw()
    const threaded = model.hexagons[0].model.edges.filter((e) => e.thread)
    const paths = [...container.querySelectorAll('path.edge[data-thread]')] as SVGPathElement[]
    expect(paths.length).toBeGreaterThanOrEqual(threaded.length)
    for (const path of paths) expect(path.getAttribute('style')).toMatch(/--thread: var\(--thread-\d+\)/)
    const first = threaded[0].thread!
    expect(container.querySelector(`path.edge[data-thread="${first.id}"]`)).not.toBeNull()
  })

  it('leave an edge of no single thread bare', () => {
    const { container } = draw()
    const bare = [...container.querySelectorAll('path.edge:not([data-thread])')]
    expect(bare.length).toBeGreaterThan(0)
    expect(bare.every((p) => !p.getAttribute('style'))).toBe(true)
  })

  it('end in an arrowhead of the same colour', () => {
    const { container } = draw()
    const path = container.querySelector('path.edge-import[data-thread][marker-end]')!
    const slot = /--thread-(\d+)/.exec(path.getAttribute('style')!)![1]
    expect(path.getAttribute('marker-end')).toBe(`url(#arrow-thread-${slot})`)
    expect(container.querySelector(`marker#arrow-thread-${slot} path`)?.getAttribute('style')).toContain(`var(--thread-${slot})`)
  })
})

describe('thread dots', () => {
  it('put one dot per thread on every dotted box, in its colour, and keep text out of it', () => {
    const { container, model } = draw()
    for (const node of model.hexagons[0].model.nodes.filter((n) => n.threads)) {
      const g = container.querySelector(`g.node-${node.kind}[data-ref="${node.ref}"]`)!
      const dots = [...g.querySelectorAll('circle.thread-dot')]
      expect(dots.map((d) => d.getAttribute('style'))).toEqual(node.threads!.slice(0, 4).map((t) => `--thread: var(--thread-${t.slot});`))
    }
    expect(container.querySelectorAll('text[style*="--thread"]')).toHaveLength(0)
  })

  it('count the threads past the fourth in text ink', () => {
    const { container } = draw((model) => {
      const node = model.hexagons[0].model.nodes.find((n) => n.kind === 'aggregate')!
      node.threads = Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, slot: i }))
    })
    const g = [...container.querySelectorAll('g.node-aggregate')].find((n) => n.querySelectorAll('circle.thread-dot').length === 4)!
    expect(g.querySelector('text.thread-more')?.textContent).toBe('+3')
    expect(g.querySelector('text.thread-more')?.getAttribute('style')).toBeNull()
  })

  it('keep the note marker where it was', () => {
    const { container } = draw()
    expect(container.querySelectorAll('circle.thread-dot[data-note-marker]')).toHaveLength(0)
  })
})
