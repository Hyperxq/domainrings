import { describe, expect, it } from 'vitest'
import { boxLabels, boxObstacles } from './boxLabels'
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
    const tierOf = (kind: string) => boxLabels(detailed, twoHexMap()).find((l) => l.kind === kind && l.text !== 'Feedback')?.tier
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

  it('promotes the aggregate root to the top tier, in the overview too', () => {
    for (const mode of ['detailed', 'overview'] as const) {
      const model = layoutMap(twoHexMap(), { mode })
      const labels = boxLabels(model, twoHexMap()).filter((l) => l.hexagonId === 'h1' && l.kind === 'domainItem')
      expect(labels.find((l) => l.text === 'Feedback')?.tier).toBe(0)
      expect(labels.filter((l) => l.text !== 'Feedback').every((l) => l.tier === 2)).toBe(true)
    }
  })

  it('names the element a label belongs to, shared by its socket and its beside-the-notch text', () => {
    const overview = layoutMap(twoHexMap(), { mode: 'overview' })
    const ports = boxLabels(overview, twoHexMap()).filter((l) => l.hexagonId === 'h1' && (l.kind === 'port' || l.kind === 'portLabel'))
    expect(ports.length).toBeGreaterThan(0)
    for (const l of ports) expect(l.owner).toBe(`h1:${l.ref}`)
  })
})

describe('boxObstacles', () => {
  const detailed = layoutMap(twoHexMap(), { mode: 'detailed' })

  it('covers every box of every full hexagon but the aggregate outline that contains others', () => {
    const nodes = detailed.hexagons.flatMap((h) => h.model.nodes.filter((n) => n.kind !== 'aggregate'))
    expect(boxObstacles(detailed, twoHexMap())).toHaveLength(nodes.length)
  })

  it('places a box on the map and takes the axis-aligned bounds of a rotated one', () => {
    const [h1] = detailed.hexagons
    const upright = h1.model.nodes.find((n) => !n.rotation && n.kind === 'useCase')!
    const rect = boxObstacles(detailed, twoHexMap()).find((o) => o.owner === `h1:${upright.ref}`)!.rect
    expect(rect).toEqual({ x: upright.x + h1.centre.x - upright.width / 2, y: upright.y + h1.centre.y - upright.height / 2, width: upright.width, height: upright.height })

    const slanted = { ...upright, x: 0, y: 0, width: 40, height: 10, rotation: 90 }
    const model = { ...detailed, hexagons: [{ ...h1, centre: { x: 100, y: 100 }, model: { ...h1.model, nodes: [slanted] } }] }
    const [turned] = boxObstacles(model, twoHexMap())
    expect(turned.rect.width).toBeCloseTo(10)
    expect(turned.rect.height).toBeCloseTo(40)
    expect(turned.rect.x).toBeCloseTo(95)
  })

  it('leaves out the compact hexagons', () => {
    const model = layoutMap(manyHexagonMap(5), { current: 'h1' })
    const owners = new Set(boxObstacles(model, manyHexagonMap(5)).map((o) => o.owner.split(':')[0]))
    expect([...owners]).toEqual(model.hexagons.filter((h) => !h.compact).map((h) => h.id))
  })
})
