import { describe, expect, it } from 'vitest'
import { boxLabels } from './boxLabels'
import { layoutMap } from './map'
import { manyHexagonMap, twoHexMap } from '../test/fixtures'

const textsOf = (model: ReturnType<typeof layoutMap>) => boxLabels(model, twoHexMap()).map((l) => l.text)

describe('boxLabels', () => {
  const detailed = layoutMap(twoHexMap(), { mode: 'detailed' })

  it('labels each box with its name alone', () => {
    const [h1] = detailed.hexagons
    const boxes = h1.model.nodes.filter((n) => n.kind === 'adapter')
    expect(boxes.length).toBeGreaterThan(0)
    const labels = boxLabels(detailed, twoHexMap()).filter((l) => l.hexagonId === h1.id)
    for (const box of boxes) {
      const name = twoHexMap().hexagons[0].adapters.find((a) => a.id === box.ref)!.name
      expect(labels.find((l) => l.ref === box.ref && l.tier === 1)?.text).toBe(name)
    }
    const eyebrows = h1.model.nodes.flatMap((n) => n.lines.filter((l) => l.style === 'eyebrow' || l.style === 'tag' || l.style === 'muted').map((l) => l.text))
    for (const text of textsOf(detailed)) expect(eyebrows).not.toContain(text)
  })

  it("uses the element's own name, even when the box wraps it at a camelCase hump", () => {
    const map = twoHexMap()
    const long = 'StartLibraryDocumentUploadWithRetries'
    map.hexagons[0].adapters[0].name = long
    const model = layoutMap(map, { mode: 'detailed' })
    const node = model.hexagons[0].model.nodes.find((n) => n.ref === map.hexagons[0].adapters[0].id && n.kind === 'adapter')!
    expect(node.lines.filter((l) => l.style === 'name').length).toBeGreaterThan(1)
    expect(boxLabels(model, map).find((l) => l.ref === node.ref && l.hexagonId === map.hexagons[0].id)?.text).toBe(long)
  })

  it('centres a label on its box, in map coordinates', () => {
    const [h1] = detailed.hexagons
    const node = h1.model.nodes.find((n) => n.kind === 'useCase')!
    const label = boxLabels(detailed, twoHexMap()).find((l) => l.hexagonId === h1.id && l.ref === node.ref && l.tier === 0)!
    expect(label).toMatchObject({ x: node.x + h1.centre.x, y: node.y + h1.centre.y, area: node.width * node.height })
  })

  it('ranks use cases and ports first, adapters, actors and externals next, domain items last', () => {
    const tierOf = (kind: string) => boxLabels(detailed, twoHexMap()).find((l) => l.kind === kind)?.tier
    expect([tierOf('useCase'), tierOf('port'), tierOf('adapter'), tierOf('actor'), tierOf('external'), tierOf('domainItem')]).toEqual([0, 0, 1, 1, 1, 2])
  })

  it('labels a port by the name beside its socket in the overview', () => {
    const overview = layoutMap(twoHexMap(), { mode: 'overview' })
    const port = boxLabels(overview, twoHexMap()).filter((l) => l.kind === 'portLabel')
    expect(port.length).toBeGreaterThan(0)
    expect(port.every((l) => l.tier === 0 && l.text.length > 0)).toBe(true)
  })

  it('leaves out the compact hexagons', () => {
    const model = layoutMap(manyHexagonMap(5), { current: 'h1' })
    const compact = model.hexagons.filter((h) => h.compact).map((h) => h.id)
    expect(compact.length).toBeGreaterThan(0)
    const owners = new Set(boxLabels(model, manyHexagonMap(5)).map((l) => l.hexagonId))
    expect([...owners]).toEqual(model.hexagons.filter((h) => !h.compact).map((h) => h.id))
  })
})
