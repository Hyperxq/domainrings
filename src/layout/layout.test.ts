import { describe, expect, it } from 'vitest'
import { hairline, quadsOverlap, rectCorners, reach, type Point } from './geometry'
import { layoutDiagram, type LayoutModel, type LayoutNode, type LayoutRing } from './layout'
import { halfWidthAt, hexagon } from './outline'
import { DOMAIN_TITLE, EDGE_LABEL, measure, RING_LABEL, RING_SUBTITLE } from './text'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import { HEXAGONAL_KIND } from '../model/kinds'
import { DiagramSchema, type Diagram } from '../model/schema'

const SQRT3 = Math.sqrt(3)
const PADDING = 16
const MIN_BAND = 36
const COS30 = Math.sqrt(3) / 2

/**
 * Independent statement of a ring outline. Hexagons are pointy-top (regularity has its own test):
 * straight vertical sides at ±halfWidth for |dy| <= straight, then 30° slopes up to the apex.
 */
function halfWidth(shape: 'hexagon' | 'circle', ring: Pick<LayoutRing, 'halfWidth' | 'straight'>, dy: number) {
  const a = Math.abs(dy)
  if (shape === 'circle') return Math.sqrt(Math.max(0, ring.halfWidth ** 2 - a * a))
  return a <= ring.straight ? ring.halfWidth : Math.max(0, ring.halfWidth - (a - ring.straight) * SQRT3)
}

const ringOf = (m: LayoutModel, role: string) => {
  const ring = m.rings.find((r) => r.role === role)
  if (!ring) throw new Error(`no ${role} ring`)
  return ring
}

const find = (m: LayoutModel, kind: LayoutNode['kind'], ref: string) => {
  const node = m.nodes.find((n) => n.kind === kind && n.ref === ref)
  if (!node) throw new Error(`no ${kind} ${ref}`)
  return node
}

const top = (n: LayoutNode) => n.y - n.height / 2
const bottom = (n: LayoutNode) => n.y + n.height / 2
const left = (n: LayoutNode) => n.x - n.width / 2
const right = (n: LayoutNode) => n.x + n.width / 2
/** A node's four corners. */
const corners = (n: LayoutNode): Point[] =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => ({ x: n.x + (sx * n.width) / 2, y: n.y + (sy * n.height) / 2 }))
const inside = (m: LayoutModel, ring: LayoutRing, p: Point) =>
  Math.abs(p.x) <= halfWidth(m.shape, ring, p.y) + 1e-6 && Math.abs(p.y) <= ring.apex + 1e-6

/** The ring shrunk by `by` units of half-width, keeping its shape (a regular hexagon stays regular). */
const shrink = (shape: 'hexagon' | 'circle', ring: LayoutRing, by: number): LayoutRing => {
  if (shape === 'circle') return { ...ring, halfWidth: ring.halfWidth - by, apex: ring.apex - by }
  const r = ring.apex - by / COS30
  return { ...ring, halfWidth: r * COS30, straight: r / 2, apex: r }
}

/** A ring title block's box: title line (the domain's is the big one), then an optional subtitle, centred on x. */
const labelBox = (ring: LayoutRing): LayoutNode => {
  const metrics = ring.role === 'domain' ? DOMAIN_TITLE : RING_LABEL
  const line = metrics.size + 4
  const width = Math.max(measure(ring.title, metrics), ring.subtitle ? measure(ring.subtitle, RING_SUBTITLE) : 0)
  const height = line + (ring.subtitle ? 4 + RING_SUBTITLE.size + 4 : 0)
  return { key: `label:${ring.key}`, ref: ring.key, kind: 'domainItem', tone: 'muted', lines: [], x: 0, y: ring.labelAt.y - line / 2 + height / 2, width, height }
}

type Segment = [Point, Point]
const segments = (points: Point[]): Segment[] => points.slice(1).map((p, i) => [points[i], p])
const sample = ([a, b]: Segment, step = 0.01): Point[] =>
  Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i * step, y: a.y + (b.y - a.y) * i * step }))
const strictlyInside = (n: LayoutNode, p: Point) => Math.abs(p.x - n.x) < n.width / 2 - 1 && Math.abs(p.y - n.y) < n.height / 2 - 1

/** Independent wall frames: outward normal n and along-wall dir for each wall of a pointy-top hexagon. */
const WALL_NORMAL_DEG = { e: 0, se: 60, sw: 120, w: 180, nw: 240, ne: 300 } as const
const wallFrame = (wall: keyof typeof WALL_NORMAL_DEG) => {
  const a = (WALL_NORMAL_DEG[wall] * Math.PI) / 180
  const n = { x: Math.cos(a), y: Math.sin(a) }
  return { n, dir: { x: -n.y, y: n.x } }
}
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const SLANTED = new Set(['nw', 'sw', 'ne', 'se'])

/** Separating-axis test for two boxes; touching edges do not count as overlap. */
function overlap(a: LayoutNode, b: LayoutNode) {
  const [ca, cb] = [corners(a), corners(b)]
  const axes = [ca, cb].flatMap((c) => [0, 1].map((i) => ({ x: c[i === 0 ? 1 : 2].x - c[0].x, y: c[i === 0 ? 1 : 2].y - c[0].y })))
  return axes.every((axis) => {
    const [pa, pb] = [ca.map((p) => dot(p, axis)), cb.map((p) => dot(p, axis))]
    return Math.min(...pa) < Math.max(...pb) - 1e-6 && Math.min(...pb) < Math.max(...pa) - 1e-6
  })
}
/** Node keys an edge is allowed to touch: its endpoints (wiring branches start on the trunk, not on a node). */
const endpointsOf = (key: string) => key.split('->').filter((k) => !k.startsWith('trunk:'))


const DOMAIN_BLOCK = new Set<LayoutNode['kind']>(['domainItem', 'aggregate'])
const intoDomain = (key: string) => key.endsWith('->domain')

function withManyDrivingPorts(count: number): Diagram {
  const ports = Array.from({ length: count }, (_, i) => ({ id: `xp${i}`, name: `port${i}`, side: 'driving' as const }))
  const adapters = ports.map((p, i) => ({ id: `xa${i}`, name: `Adapter${i}`, portId: p.id }))
  return {
    ...EXAMPLE_DIAGRAM,
    ports: [...EXAMPLE_DIAGRAM.ports, ...ports],
    adapters: [...EXAMPLE_DIAGRAM.adapters, ...adapters],
  }
}

describe('layoutDiagram', () => {
  const config = HEXAGONAL_KIND
  const model = layoutDiagram(EXAMPLE_DIAGRAM)
  const app = ringOf(model, 'application')
  const adapterRing = ringOf(model, 'adapters')
  const outer = model.rings[0]
  const domainRing = model.rings[model.rings.length - 1]

  it('draws one ring per configured layer, outermost first, strictly nested', () => {
    expect(model.rings.map((r) => r.role)).toEqual(config.rings.map((r) => r.role))
    expect(model.shape).toBe('hexagon')
    for (let i = 1; i < model.rings.length; i++) {
      expect(model.rings[i].halfWidth).toBeLessThan(model.rings[i - 1].halfWidth)
      expect(model.rings[i].apex).toBeLessThan(model.rings[i - 1].apex)
    }
  })

  it('puts every port socket on the application ring edge, driving left and driven right', () => {
    for (const port of EXAMPLE_DIAGRAM.ports) {
      const socket = find(model, 'port', port.id)
      expect(socket.x).toBeCloseTo(halfWidth(model.shape, app, socket.y) * (port.side === 'driving' ? -1 : 1), 6)
    }
  })

  it('aligns each adapter with its port and each actor/external with its adapter', () => {
    const u = (n: LayoutNode) => dot(n, wallFrame(n.wall!).dir)
    for (const adapter of EXAMPLE_DIAGRAM.adapters) {
      const [node, port] = [find(model, 'adapter', adapter.id), find(model, 'port', adapter.portId!)]
      expect(node.wall).toBe(port.wall)
      expect(u(node)).toBeCloseTo(u(port), 6)
    }
    for (const actor of EXAMPLE_DIAGRAM.actors) {
      const [node, adapter] = [find(model, 'actor', actor.id), find(model, 'adapter', actor.adapterId!)]
      expect(node.wall).toBe(adapter.wall)
      expect(u(node)).toBeCloseTo(u(adapter), 6)
    }
    for (const external of EXAMPLE_DIAGRAM.externals) {
      const [node, adapter] = [find(model, 'external', external.id), find(model, 'adapter', external.adapterId!)]
      expect(node.wall).toBe(adapter.wall)
      expect(u(node)).toBeCloseTo(u(adapter), 6)
    }
  })

  it('centres adapters on the infrastructure wall, outside their port', () => {
    for (const adapter of EXAMPLE_DIAGRAM.adapters) {
      const node = find(model, 'adapter', adapter.id)
      const socket = find(model, 'port', adapter.portId!)
      const { n } = wallFrame(node.wall!)
      expect(dot(node, n)).toBeCloseTo(adapterRing.halfWidth, 6)
      expect(dot(node, n)).toBeGreaterThan(dot(socket, n))
    }
  })

  it('keeps actors and externals outside the outermost ring', () => {
    for (const n of model.nodes.filter((n) => n.kind === 'actor' || n.kind === 'external')) {
      const { n: normal } = wallFrame(n.wall!)
      expect(dot(n, normal)).toBeCloseTo(model.externalWall.halfWidth, 6)
      expect(dot(n, normal)).toBeGreaterThan(outer.halfWidth)
    }
  })

  it('seats the use case on the wall holding most of its ports, straddling the domain wall', () => {
    const useCase = find(model, 'useCase', 'uc-submit')
    expect(useCase.wall).toBe('se')
    const { n } = wallFrame('se')
    expect(dot(useCase, n)).toBeCloseTo(domainRing.halfWidth, 6)
    expect(Math.min(...corners(useCase).map((c) => dot(c, n)))).toBeLessThan(domainRing.halfWidth)
    expect(Math.max(...corners(useCase).map((c) => dot(c, n)))).toBeGreaterThan(domainRing.halfWidth)
  })

  it('keeps domain items inside the innermost ring', () => {
    for (const item of EXAMPLE_DIAGRAM.domain) {
      for (const c of corners(find(model, 'domainItem', item.id))) expect(inside(model, domainRing, c)).toBe(true)
    }
  })

  it('hugs the domain blocks with the region, at most 24 units clear of it', () => {
    const slack = Math.min(...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).flatMap(corners).map((c) => halfWidthAt(model.region!, c.y) - Math.abs(c.x)))
    expect(slack).toBeGreaterThanOrEqual(-1e-6)
    expect(slack).toBeLessThanOrEqual(24 + 1e-6)
  })

  it('draws every hexagon ring regular: six equal sides, pointy-top, concentric', () => {
    for (const ring of model.rings) {
      const vertices = [
        { x: 0, y: -ring.apex },
        { x: ring.halfWidth, y: -ring.straight },
        { x: ring.halfWidth, y: ring.straight },
        { x: 0, y: ring.apex },
        { x: -ring.halfWidth, y: ring.straight },
        { x: -ring.halfWidth, y: -ring.straight },
      ]
      const sides = vertices.map((v, i) => Math.hypot(vertices[(i + 1) % 6].x - v.x, vertices[(i + 1) % 6].y - v.y))
      for (const side of sides) expect(side).toBeCloseTo(ring.apex, 6)
    }
  })

  it('sizes every outer ring to its content: shrinking it by 2×padding would break something', () => {
    for (let i = 0; i < model.rings.length - 1; i++) {
      const ring = model.rings[i]
      const inner = model.rings[i + 1]
      const shrunk = shrink(model.shape, ring, 2 * PADDING)
      const boxes = [...model.nodes, ...model.rings.map(labelBox)]
      const contained = boxes.filter(
        (n) => (n.kind !== 'port' || ring !== app) && corners(n).every((c) => inside(model, ring, c)),
      )
      const loses = contained.some((n) => corners(n).some((c) => !inside(model, shrunk, c)))
      // A socket's inner edge must clear the inner ring and leave a straight run after its use-case bus.
      const busLane = (side: number) =>
        Math.max(
          0,
          ...model.edges
            .filter((e) => e.kind === 'import' && e.key.includes('useCase:') && e.key.includes('port:'))
            .flatMap((e) => segments(e.points))
            .filter(([a, b]) => a.x === b.x && Math.sign(a.x) === side)
            .map(([a]) => Math.abs(a.x)),
        )
      const socketsHitInner =
        ring === app &&
        model.nodes.filter((n) => n.kind === 'port').some((n) => {
          const edge = halfWidth(model.shape, shrunk, n.y) - n.width / 2
          return edge < halfWidth(model.shape, inner, n.y) || edge < busLane(Math.sign(n.x)) + 12
        })
      const rowsLeaveStraightSide =
        (ring === app || ring === adapterRing) &&
        model.nodes.filter((n) => n.kind === 'port' || n.kind === 'adapter').some((n) => Math.abs(n.y) + n.height / 2 > shrunk.straight)
      const bandTooThin = shrunk.halfWidth - inner.halfWidth < MIN_BAND
      // Titles keep one shared depth under the top, so a shrunk ring re-seats its title lower: it must still fit
      // and clear everything below it.
      const title = labelBox(ring)
      const seated = { ...title, y: title.y + (ring.apex - shrunk.apex) }
      const titleClashes =
        !corners(seated).every((c) => inside(model, shrunk, c)) ||
        bottom(seated) >= -inner.apex ||
        model.nodes.some((n) => Math.abs(n.x - seated.x) < (n.width + seated.width) / 2 && Math.abs(n.y - seated.y) < (n.height + seated.height) / 2)
      expect({ ring: ring.role, breaks: loses || socketsHitInner || rowsLeaveStraightSide || bandTooThin || titleClashes }).toEqual({ ring: ring.role, breaks: true })
    }
  })

  it('never overlaps boxes within a column', () => {
    const columns = new Map<string, LayoutNode[]>()
    for (const n of model.nodes) {
      const key = `${n.kind}:${Math.sign(Math.round(n.x))}`
      columns.set(key, [...(columns.get(key) ?? []), n])
    }
    for (const nodes of columns.values()) {
      const sorted = [...nodes].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) expect(top(sorted[i])).toBeGreaterThanOrEqual(bottom(sorted[i - 1]) - 1e-6)
    }
  })

  it('grows the rings and the viewBox when the taller side gains rows', () => {
    const bigger = layoutDiagram(withManyDrivingPorts(20))
    expect(ringOf(bigger, 'application').apex).toBeGreaterThan(app.apex)
    expect(bigger.bounds.height).toBeGreaterThan(model.bounds.height)
    for (const n of bigger.nodes.filter((n) => n.kind === 'port' && n.side === 'driving')) {
      expect(n.x).toBeCloseTo(-halfWidth(bigger.shape, ringOf(bigger, 'application'), n.y), 6)
    }
  })

  it('contains every node inside the viewBox', () => {
    const b = model.bounds
    for (const n of model.nodes) {
      expect(left(n)).toBeGreaterThanOrEqual(b.x)
      expect(right(n)).toBeLessThanOrEqual(b.x + b.width)
      expect(top(n)).toBeGreaterThanOrEqual(b.y)
      expect(bottom(n)).toBeLessThanOrEqual(b.y + b.height)
    }
  })

  it('sets the layer titles at one shared depth under their top vertex, the domain title no deeper, all inside their ring, above their content', () => {
    const depths = model.rings.map((ring) => top(labelBox(ring)) + ring.apex)
    for (const depth of depths.slice(0, -1)) expect(Math.abs(depth - depths[0])).toBeLessThanOrEqual(1)
    expect(depths.at(-1)!).toBeLessThanOrEqual(depths[0] + 1)
    model.rings.forEach((ring, i) => {
      const box = labelBox(ring)
      expect(box.x).toBe(0)
      for (const c of corners(box)) expect(inside(model, ring, c)).toBe(true)
      if (i < model.rings.length - 1) expect(bottom(box)).toBeLessThan(-model.rings[i + 1].apex)
      else for (const n of model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind))) expect(top(n)).toBeGreaterThan(bottom(box))
      // Layer titles are uppercase and tracked; the domain's is the big sentence-case one.
      if (ring.role !== 'domain') expect(ring.title).toBe(ring.title.toUpperCase())
    })
  })

  it('hangs the use cases right under the application title', () => {
    const title = labelBox(app)
    for (const n of model.nodes.filter((n) => n.kind === 'useCase')) expect(top(n)).toBeGreaterThan(bottom(title))
  })

  it('draws every arrow with axis-aligned segments; a corridor run, a hop along a wall normal or a hexagon trunk may also follow the ring walls', () => {
    for (const e of model.edges) {
      for (const [a, b] of segments(e.points)) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const alongWall = [30, 150, -30, -150].some((t) => Math.abs(deg - t) < 1e-6)
        const alongNormal = [60, 120, -60, -120].some((t) => Math.abs(deg - t) < 1e-6)
        expect(a.x === b.x || a.y === b.y || alongWall || alongNormal).toBe(true)
      }
    }
  })

  it('never runs a segment through a box it does not connect', () => {
    for (const e of model.edges) {
      const allowed = new Set(endpointsOf(e.key))
      const others = model.nodes.filter((n) => !allowed.has(n.key))
      for (const seg of segments(e.points)) {
        for (const p of sample(seg)) {
          const hit = others.find((n) => strictlyInside(n, p))
          expect(hit ? `${e.key} crosses ${hit.key}` : 'clear').toBe('clear')
        }
      }
    }
  })

  it('lands every arrowhead perpendicular to the edge it enters, after a straight run', () => {
    for (const e of model.edges.filter((e) => e.kind === 'import' && !intoDomain(e.key))) {
      const target = model.nodes.find((n) => n.key === endpointsOf(e.key)[1])!
      const [a, b] = segments(e.points).at(-1)!
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(12)
      if (a.y === b.y) {
        expect(Math.abs(Math.abs(b.x - target.x) - target.width / 2)).toBeLessThan(1e-6)
        expect(Math.abs(b.y - target.y)).toBeLessThan(target.height / 2)
      } else {
        expect(Math.abs(Math.abs(b.y - target.y) - target.height / 2)).toBeLessThan(1e-6)
        expect(Math.abs(b.x - target.x)).toBeLessThan(target.width / 2)
      }
    }
  })

  it('runs each use-case track in the gap between the inner ring and the sockets', () => {
    const inner = model.rings[model.rings.indexOf(app) + 1]
    const apothemOf = (p: Point) => Math.max(...(Object.keys(WALL_NORMAL_DEG) as Array<keyof typeof WALL_NORMAL_DEG>).map((w) => dot(p, wallFrame(w).n)))
    const socketFace = Math.min(...model.nodes.filter((n) => n.kind === 'port' && n.wall).map((n) => dot(n, wallFrame(n.wall!).n) - reach(n.width, n.height, wallFrame(n.wall!).n)))
    // A corridor edge hops out of its port, runs along the track and hops in: its middle points are the track's corners.
    const trackEdges = model.edges.filter((e) => e.kind === 'import' && e.key.includes('useCase:') && e.key.includes('port:') && e.points.length > 3)
    expect(trackEdges.length).toBeGreaterThan(0)
    for (const e of trackEdges) {
      const track = e.points.slice(1, -1)
      for (const [a, b] of segments(track)) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const alongWall = a.x === b.x || [30, 150, -30, -150].some((t) => Math.abs(deg - t) < 1e-6)
        expect(alongWall ? 'ok' : `${e.key} track runs at ${deg.toFixed(1)}°`).toBe('ok')
        for (const p of sample([a, b])) {
          expect(apothemOf(p), `${e.key} at ${p.x},${p.y}`).toBeGreaterThan(inner.halfWidth)
          expect(apothemOf(p), `${e.key} at ${p.x},${p.y}`).toBeLessThan(socketFace)
        }
      }
    }
  })

  it('keeps every import arrow out of the domain ring, except the ones that end on it', () => {
    for (const e of model.edges.filter((e) => e.kind === 'import' && !intoDomain(e.key))) {
      for (let s = 1; s < e.points.length; s++) {
        const [a, b] = [e.points[s - 1], e.points[s]]
        for (let t = 0; t <= 1; t += 0.02) {
          expect(inside(model, domainRing, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).toBe(false)
        }
      }
    }
  })

  it('sends one arrow from each use case into the domain, square onto the wall it sits on, and none out of it', () => {
    for (const u of EXAMPLE_DIAGRAM.useCases) {
      const inbound = model.edges.filter((e) => e.kind === 'import' && e.key === `useCase:${u.id}->domain`)
      expect(inbound).toHaveLength(1)
      const node = find(model, 'useCase', u.id)
      const { n } = wallFrame(node.wall!)
      const [a, b] = segments(inbound[0].points).at(-1)!
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(-dot(run, n)).toBeGreaterThanOrEqual(12 - 1e-6)
      // With no card named, the arrow stops on the wall of the domain model region.
      expect(dot(b, n)).toBeCloseTo(model.region!.halfWidth, 6)
    }
    const domainKeys = new Set(['domain', ...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).map((n) => n.key)])
    const outbound = model.edges.filter((e) => e.kind === 'import' && domainKeys.has(endpointsOf(e.key)[0]))
    expect(outbound).toEqual([])
  })

  it('leaves the question into the domain unlabelled', () => {
    expect(model.edges.find((e) => intoDomain(e.key))!.label).toBeUndefined()
  })

  it('centres the root on its card and sets the children as one smaller row under it, name left and type right', () => {
    const card = find(model, 'aggregate', 'd-feedback')
    for (const n of model.nodes.filter((n) => n.kind === 'domainItem')) {
      expect(n.x).toBe(card.x)
      expect(n.align).toBe(n.ref === 'd-feedback' ? 'center' : 'start')
    }
    const parent = find(model, 'domainItem', 'd-feedback')
    const children = ['d-rating', 'd-email'].map((id) => find(model, 'domainItem', id))
    expect(parent.lines.map((l) => l.style)).toEqual(['strong'])
    for (const child of children) {
      expect(child.y).toBeGreaterThan(parent.y)
      expect(child.lines).toHaveLength(1)
      expect(child.lines[0].style).toBe('minor')
    }
    expect(children[0].lines[0]).toEqual({ text: '○ FeedbackRating', style: 'minor', right: 'value obj' })
    expect(children[1].y).toBeGreaterThan(children[0].y)
  })

  it('never overlaps the rows of the domain block', () => {
    const rows = model.nodes.filter((n) => n.kind === 'domainItem').sort((a, b) => a.y - b.y)
    for (let i = 1; i < rows.length; i++) expect(top(rows[i])).toBeGreaterThanOrEqual(bottom(rows[i - 1]) - 1e-6)
  })

  it('routes composition wiring around the application ring, never through it', () => {
    const wiring = model.edges.filter((e) => e.kind === 'wiring')
    expect(wiring.length).toBeGreaterThan(0)
    for (const e of wiring) {
      for (let s = 1; s < e.points.length; s++) {
        const [a, b] = [e.points[s - 1], e.points[s]]
        for (let t = 0; t <= 1; t += 0.02) {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          expect(inside(model, app, p)).toBe(false)
        }
      }
    }
  })
})

describe('layoutDiagram edges', () => {
  const model = layoutDiagram(EXAMPLE_DIAGRAM)
  const edge = (fromKey: string, toKey: string) => {
    const e = model.edges.find((e) => e.key === `${fromKey}->${toKey}`)
    if (!e) throw new Error(`missing edge ${fromKey}->${toKey}`)
    return e
  }
  const start = (key: [string, string]) => edge(...key).points[0]
  const end = (key: [string, string]) => edge(...key).points.at(-1)!

  it('points adapter imports inward on both sides', () => {
    expect(end(['adapter:a-http', 'port:p-submit']).x).toBeGreaterThan(start(['adapter:a-http', 'port:p-submit']).x)
    expect(end(['adapter:a-knex', 'port:p-repo']).x).toBeLessThan(start(['adapter:a-knex', 'port:p-repo']).x)
  })

  it('labels a use case\'s corridor runs once per side, flat beside the run, and its straight runs each', () => {
    const labelled = model.edges.filter((e) => e.label && !e.key.endsWith('->domain'))
    expect(labelled.map((e) => e.label).sort()).toEqual(['runs the use case', 'uses'])
    const distanceTo = (e: LayoutModel['edges'][number], q: { x: number; y: number }) =>
      Math.min(...segments(e.points).map(([a, b]) => {
        const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1
        const t = Math.min(1, Math.max(0, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / len2))
        return Math.hypot(q.x - (a.x + t * (b.x - a.x)), q.y - (a.y + t * (b.y - a.y)))
      }))
    for (const e of labelled) {
      expect(e).not.toHaveProperty('labelAngle')
      expect(distanceTo(e, e.labelAt!)).toBeGreaterThan(3)
      expect(distanceTo(e, e.labelAt!)).toBeLessThanOrEqual(measure(e.label!, EDGE_LABEL) / 2 + 24)
    }
    expect(model.edges.filter((e) => e.key.startsWith('useCase:uc-submit->port:'))).toHaveLength(3)
  })

  it('wires the composition root with one trunk per side and one branch per adapter', () => {
    const wiring = model.edges.filter((e) => e.kind === 'wiring')
    expect(wiring.filter((e) => e.key.startsWith('composition->trunk:')).map((e) => e.key).sort()).toEqual([
      'composition->trunk:driven',
      'composition->trunk:driving',
    ])
    expect(wiring.filter((e) => e.key.startsWith('composition->adapter:'))).toHaveLength(EXAMPLE_DIAGRAM.adapters.length)
  })
})

describe('aggregates as consistency boundaries', () => {
  describe.each([
    ['feedback', EXAMPLE_DIAGRAM],
    ['stress', STRESS_DIAGRAM],
  ] as const)('%s example', (_, diagram) => {
    const model = layoutDiagram(diagram)
    const outlines = model.nodes.filter((n) => n.kind === 'aggregate')
    const descendantsOf = (id: string): string[] =>
      diagram.domain.filter((i) => i.parentId === id).flatMap((i) => [i.id, ...descendantsOf(i.id)])

    it('outlines every aggregate root with its descendants inside, clear of its edges', () => {
      const roots = diagram.domain.filter((i) => i.type === 'aggregate' && !i.parentId)
      expect(outlines.map((o) => o.ref).sort()).toEqual(roots.map((r) => r.id).sort())
      for (const outline of outlines) {
        expect(outline.lines).toEqual([{ text: '◆ aggregate root', style: 'tag' }])
        const root = find(model, 'domainItem', outline.ref)
        expect(root.lines[0].style).toBe('strong')
        for (const n of [root, ...descendantsOf(outline.ref).map((id) => find(model, 'domainItem', id))]) {
          expect(left(n)).toBeGreaterThanOrEqual(left(outline) + 14 - 1e-6)
          expect(right(n)).toBeLessThanOrEqual(right(outline) - 14 + 1e-6)
          expect(top(n)).toBeGreaterThan(top(outline) + 14)
          expect(bottom(n)).toBeLessThanOrEqual(bottom(outline) - 6 + 1e-6)
          expect(n.x).toBe(outline.x)
        }
      }
    })

    it('never overlaps sibling outlines', () => {
      for (const [i, a] of outlines.entries()) {
        for (const b of outlines.slice(i + 1)) {
          const apart = right(a) <= left(b) || right(b) <= left(a) || bottom(a) <= top(b) || bottom(b) <= top(a)
          expect(apart).toBe(true)
        }
      }
    })

    it('still hugs the region to the outline corners', () => {
      const slack = Math.min(...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).flatMap(corners).map((c) => halfWidthAt(model.region!, c.y) - Math.abs(c.x)))
      expect(slack).toBeGreaterThanOrEqual(-1e-6)
      expect(slack).toBeLessThanOrEqual(24 + 1e-6)
    })
  })
})

describe('type tags: one glyph + word per element', () => {
  const GLYPHS = ['◆', '●', '○', '⚙', '▶', '⇥', '⇤', '◇']
  const tagsOf = (nodes: LayoutNode[]) =>
    nodes.flatMap((n) => n.lines.flatMap((l) => [l.tag, GLYPHS.some((g) => l.text.startsWith(`${g} `)) ? l.text : undefined].filter(Boolean)))
  const expectedGlyph = { aggregate: '◆', entity: '●', valueObject: '○', domainService: '⚙' } as const

  describe.each([
    ['hexagonal feedback', EXAMPLE_DIAGRAM],
    ['hexagonal stress', STRESS_DIAGRAM],
  ])('%s', (_, diagram) => {
    const model = layoutDiagram(diagram)
    const labels = HEXAGONAL_KIND.labels
    const nodesOf = (ref: string) => model.nodes.filter((n) => n.ref === ref)

    it('tags every domain item exactly once, with its type glyph', () => {
      for (const item of diagram.domain) {
        const tags = tagsOf(nodesOf(item.id))
        expect(tags).toHaveLength(1)
        expect(tags[0]!.startsWith(expectedGlyph[item.type])).toBe(true)
      }
    })

    it('tags use cases, ports and adapters exactly once, ports and adapters in the kind vocabulary', () => {
      for (const u of diagram.useCases) expect(tagsOf(nodesOf(u.id))).toEqual(['▶ use case'])
      for (const p of diagram.ports) {
        expect(tagsOf(nodesOf(p.id))).toEqual([p.side === 'driving' ? `⇥ ${labels.drivingPort}` : `◇ ${labels.drivenPort}`])
      }
      for (const a of diagram.adapters) {
        const port = diagram.ports.find((p) => p.id === a.portId)
        expect(tagsOf(nodesOf(a.id))).toEqual([port?.side === 'driven' ? `⇤ ${labels.adapterOut}` : `⇥ ${labels.adapterIn}`])
      }
    })

    it('shows the tag instead of the old type line, never both', () => {
      const captions = new Set(['entity', 'value object', 'aggregate', 'domain service'])
      for (const n of model.nodes) for (const l of n.lines) expect(captions.has(l.text)).toBe(false)
    })

    it('weights the domain by type: aggregate root strong, entity regular, value object small', () => {
      for (const item of diagram.domain) {
        const [nameLine] = find(model, 'domainItem', item.id).lines
        if (item.type === 'aggregate' && !item.parentId) expect(nameLine.style).toBe('strong')
        if (item.type === 'valueObject') expect(nameLine.style).toBe('minor')
      }
    })
  })
})

describe('guides, tones and modes', () => {
  it('draws six spokes on hexagons, each on a centre-to-vertex line, from the outer vertex in to the domain vertex', () => {
    const m = layoutDiagram(EXAMPLE_DIAGRAM)
    const [outer, domain] = [m.rings[0], m.rings.at(-1)!]
    expect(m.guides).toHaveLength(6)
    m.guides.forEach(({ from, to }, k) => {
      const angle = ((-90 + 60 * k) * Math.PI) / 180
      for (const [p, r] of [[from, outer.apex], [to, domain.apex]] as const) {
        expect(p.x).toBeCloseTo(r * Math.cos(angle), 6)
        expect(p.y).toBeCloseTo(r * Math.sin(angle), 6)
      }
    })
  })

  it('colours by side: driving pills, driven adapters, slate external systems', () => {
    const m = layoutDiagram(EXAMPLE_DIAGRAM)
    const toneOf = (kind: LayoutNode['kind'], side?: string) => new Set(m.nodes.filter((n) => n.kind === kind && (!side || n.side === side)).map((n) => n.tone))
    expect(toneOf('actor')).toEqual(new Set(['driving']))
    expect(toneOf('adapter', 'driving')).toEqual(new Set(['driving']))
    expect(toneOf('adapter', 'driven')).toEqual(new Set(['driven']))
    expect(toneOf('external')).toEqual(new Set(['slate']))
  })

  describe.each([
    ['feedback', EXAMPLE_DIAGRAM],
    ['stress', STRESS_DIAGRAM],
  ])('overview of the %s example', (_, diagram) => {
    const detailed = layoutDiagram(diagram)
    const overview = layoutDiagram(diagram, { mode: 'overview' })

    it('lists only aggregate and entity roots in the domain', () => {
      const roots = diagram.domain.filter((i) => !i.parentId && (i.type === 'aggregate' || i.type === 'entity')).map((i) => i.id)
      expect(overview.nodes.filter((n) => n.kind === 'domainItem').map((n) => n.ref).sort()).toEqual(roots.sort())
    })

    it('shrinks the rings', () => {
      expect(overview.rings[0].apex).toBeLessThan(detailed.rings[0].apex)
    })
  })
})

describe('layer membership for hover', () => {
  it('tags each element with the ring it belongs to', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    for (const n of m.nodes) {
      const expected =
        n.kind === 'useCase'
          ? 'application'
          : n.kind === 'port' || n.kind === 'adapter'
            ? 'adapters'
            : n.kind === 'actor' || n.kind === 'external'
              ? undefined
              : n.kind === 'composition'
                ? undefined
                : 'domain'
      expect({ node: n.key, layer: n.layer }).toEqual({ node: n.key, layer: expected })
    }
  })
})

describe('layer titles', () => {
  it('uses the kind defaults: only the hexagonal application ring has a subtitle', () => {
    const m = layoutDiagram(EXAMPLE_DIAGRAM)
    expect(m.rings.map((r) => [r.title, r.subtitle])).toEqual([
      ['INFRASTRUCTURE', undefined],
      ['APPLICATION', 'one use case per business action'],
      ['Domain', undefined],
    ])
  })

  it('applies a per-layer override, keeping the title uppercase and the subtitle as written', () => {
    const m = layoutDiagram({ ...EXAMPLE_DIAGRAM, layers: { domain: { title: 'Feedback core', subtitle: 'Rules live here' } } })
    const domain = m.rings.at(-1)!
    expect([domain.title, domain.subtitle]).toEqual(['Feedback core', 'Rules live here'])
  })

  it('falls back to the default when an override is empty', () => {
    const m = layoutDiagram({ ...EXAMPLE_DIAGRAM, layers: { application: { title: '  ', subtitle: '' } } })
    const app = m.rings.find((r) => r.role === 'application')!
    expect([app.title, app.subtitle]).toEqual(['APPLICATION', 'one use case per business action'])
  })

  it('keeps the default subtitle when only the title is overridden', () => {
    const m = layoutDiagram({ ...EXAMPLE_DIAGRAM, layers: { application: { title: 'Use cases' } } })
    expect(m.rings.find((r) => r.role === 'application')!.subtitle).toBe('one use case per business action')
  })
})

describe('domain title on sparse diagrams', () => {
  const empty: Diagram = { version: 1, kind: 'hexagonal', title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
  const single: Diagram = { ...empty, domain: [{ id: 'd', name: 'Order', type: 'entity' }] }

  it.each([
    ['an empty diagram', empty],
    ['a single domain item', single],
  ])('keeps the layer titles at the shared depth for %s, the domain title no deeper and above the ring centre', (_, diagram) => {
    const m = layoutDiagram(diagram)
    const depths = m.rings.map((ring) => top(labelBox(ring)) + ring.apex)
    for (const depth of depths.slice(0, -1)) expect(Math.abs(depth - depths[0])).toBeLessThanOrEqual(1)
    expect(depths.at(-1)!).toBeLessThanOrEqual(depths[0] + 1)
    expect(bottom(labelBox(m.rings.at(-1)!))).toBeLessThan(0)
  })
})

describe('ports on every wall (hexagonal stress example)', () => {
  const model = layoutDiagram(STRESS_DIAGRAM)
  const app = ringOf(model, 'application')
  const adapterRing = ringOf(model, 'adapters')
  const ports = model.nodes.filter((n) => n.kind === 'port')
  it('uses all six walls, each port on a wall of its own side', () => {
    expect(new Set(ports.map((p) => p.wall))).toEqual(new Set(['nw', 'w', 'sw', 'ne', 'e', 'se']))
    for (const p of ports) expect(['nw', 'w', 'sw'].includes(p.wall!)).toBe(p.side === 'driving')
  })

  it('puts every socket on its wall segment', () => {
    for (const p of ports) {
      const { n, dir } = wallFrame(p.wall!)
      expect(dot({ x: p.x, y: p.y }, n)).toBeCloseTo(app.halfWidth, 6)
      expect(Math.abs(dot({ x: p.x, y: p.y }, dir))).toBeLessThanOrEqual(app.apex / 2 + 1e-6)
    }
  })

  it('attaches each adapter outward on the wall normal through its port, centred on the infrastructure wall', () => {
    for (const adapter of STRESS_DIAGRAM.adapters) {
      const node = find(model, 'adapter', adapter.id)
      const socket = find(model, 'port', adapter.portId!)
      const { n, dir } = wallFrame(socket.wall!)
      const offset = { x: node.x - socket.x, y: node.y - socket.y }
      expect(Math.abs(dot(offset, dir))).toBeLessThan(1e-6)
      expect(dot(offset, n)).toBeGreaterThan(0)
      expect(overlap(node, socket)).toBe(false)
      expect(dot(node, n)).toBeCloseTo(adapterRing.halfWidth, 6)
    }
  })

  it('never overlaps two boxes', () => {
    const boxes = model.nodes.filter((b) => b.kind !== 'aggregate' && b.kind !== 'domainItem')
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(overlap(a, b) ? `${a.key} overlaps ${b.key}` : 'apart').toBe('apart')
    }
  })

  it('lands every arrow perpendicular to the wall of a wall-hosted target', () => {
    for (const e of model.edges.filter((e) => e.kind === 'import')) {
      const target = model.nodes.find((n) => n.key === endpointsOf(e.key)[1])
      // A bus enters a use case through its face, not along its wall's normal; only a socket or endpoint is met square.
      if (!target?.wall || !SLANTED.has(target.wall) || target.kind === 'useCase') continue
      const { n } = wallFrame(target.wall)
      const [a, b] = segments(e.points).at(-1)!
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(Math.hypot(run.x, run.y)).toBeGreaterThanOrEqual(12)
    }
  })

  it('draws arrows only horizontally, vertically, along a wall normal or, in a corridor, along a wall', () => {
    const normals = [60, 120, -60, -120]
    const walls = [30, 150, -30, -150]
    for (const e of model.edges) {
      for (const [a, b] of segments(e.points)) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const axis = a.x === b.x || a.y === b.y
        const allowed = [...normals, ...walls].some((t) => Math.abs(deg - t) < 1e-6)
        expect(axis || allowed ? 'ok' : `${e.key} runs at ${deg.toFixed(1)}°`).toBe('ok')
      }
    }
  })

  it('never runs a segment through a box it does not connect', () => {
    for (const e of model.edges) {
      const allowed = new Set(endpointsOf(e.key))
      const others = model.nodes.filter((n) => !allowed.has(n.key))
      for (const seg of segments(e.points)) {
        for (const p of sample(seg)) {
          const hit = others.find((n) => strictlyInside(n, p))
          expect(hit ? `${e.key} crosses ${hit.key}` : 'clear').toBe('clear')
        }
      }
    }
  })

})

const RUN_MIN = 16

describe('use cases placed on a wall', () => {
  const placed = STRESS_DIAGRAM.useCases.find((u) => u.placement === 'nw')!
  const port = STRESS_DIAGRAM.ports.find((p) => p.useCaseId === placed.id && p.wall === 'nw')!
  it('extends the stress example with a use case on nw, next to its driving port', () => {
    expect(placed).toBeDefined()
    expect(port.side).toBe('driving')
  })

  describe.each(['detailed', 'overview'] as const)('%s', (mode) => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode })
    const node = find(m, 'useCase', placed.id)
    const { n } = wallFrame('nw')

    it('sits upright on the nw wall, straddling the domain wall', () => {
      const domain = ringOf(m, 'domain')
      expect(node.wall).toBe('nw')
      expect(dot(node, n)).toBeCloseTo(domain.halfWidth, 6)
      expect(Math.max(...corners(node).map((c) => dot(c, n)))).toBeGreaterThan(domain.halfWidth)
      expect(Math.min(...corners(node).map((c) => dot(c, n)))).toBeLessThan(domain.halfWidth)
    })

    it('sits on the inner side of its wall’s ports', () => {
      const ports = m.nodes.filter((b) => b.kind === 'port' && STRESS_DIAGRAM.ports.some((p) => p.id === b.ref && p.wall === 'nw'))
      const innermost = Math.min(...ports.flatMap((b) => corners(b).map((c) => dot(c, n))))
      expect(dot(node, n)).toBeLessThan(innermost)
    })

    it('overlaps no other element and no layer title', () => {
      for (const other of [...m.nodes, ...m.rings.map(labelBox)]) {
        if (other === node) continue
        expect(overlap(node, other) ? `overlaps ${other.key}` : 'apart').toBe('apart')
      }
    })

    it('seats every other use case on the wall of its ports', () => {
      expect(Object.fromEntries(STRESS_DIAGRAM.useCases.filter((u) => u !== placed).map((u) => [u.id, find(m, 'useCase', u.id).wall]))).toEqual({ 'uc-place': 'se', 'uc-cancel': 'sw' })
    })
  })

  describe('routing (detailed)', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    const { n } = wallFrame('nw')
    const edge = (key: string) => {
      const e = m.edges.find((x) => x.key === key)
      if (!e) throw new Error(`no edge ${key}`)
      return e
    }

    it('runs its same-wall driving port straight in along the wall normal, labelled', () => {
      const e = edge(`port:${port.id}->useCase:${placed.id}`)
      expect(e.points).toHaveLength(2)
      const [a, b] = e.points
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(dot(run, n)).toBeLessThan(-12)
      expect(e.label).toBe(HEXAGONAL_KIND.labels.runs)
    })

    it('still reaches its ports on other walls along the application corridor', () => {
      for (const p of STRESS_DIAGRAM.ports.filter((p) => p.useCaseId === placed.id && p.wall !== 'nw')) {
        const e = m.edges.find((x) => x.key.includes(`useCase:${placed.id}`) && x.key.includes(`port:${p.id}`))!
        expect(e.points.length).toBeGreaterThanOrEqual(3)
      }
    })

    it('asks the domain square off its wall, landing on the wall of the domain model', () => {
      const e = edge(`useCase:${placed.id}->domain`)
      const [a, b] = e.points.slice(-2)
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(dot(e.points.at(-1)!, n)).toBeCloseTo(m.region!.halfWidth, 6)
      expect(Math.hypot(run.x, run.y)).toBeGreaterThanOrEqual(16)
    })
  })

  const base: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [{ id: 'd1', name: 'Order', type: 'entity' }], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
  // A wide seat alone on a lower wall: only its own sector and domain clearance size the ring.
  const LONE_SEAT: Diagram = { ...base, useCases: [{ id: 'u1', name: 'ReconcileEveryOutstandingInvoice', placement: 'sw' }] }
  // A seat with no socket of its own on the west wall, beside sockets that other use cases serve there.
  const seatBesideForeignSockets = (sockets: number): Diagram => ({
    ...base,
    useCases: [{ id: 'u0', name: 'PlaceOrder' }, { id: 'u1', name: 'SettleTheDailyLedger', placement: 'w' }],
    ports: Array.from({ length: sockets }, (_, i) => ({ id: `w${i}`, name: `receiveEvent${i}`, side: 'driving' as const, wall: 'w' as const, useCaseId: 'u0' })),
  })
  it.each([1, 2, 3])('runs no link of another use case through a seat beside the %i sockets that use case serves on its wall', (sockets) => {
    const m = layoutDiagram(seatBesideForeignSockets(sockets))
    const links = m.edges.filter((e) => e.kind === 'import' && e.key.includes('useCase:u0') && e.key.includes('port:'))
    expect(links).toHaveLength(sockets)
    const seat = m.nodes.find((n) => n.kind === 'useCase' && n.ref === 'u1')!
    const box = rectCorners(seat.x, seat.y, seat.width - 2, seat.height - 2)
    for (const e of links) for (const [i, a] of e.points.slice(0, -1).entries()) expect(quadsOverlap(hairline(a, e.points[i + 1]), box), e.key).toBe(false)
  })

  // A seat beside a tall west column with no slanted port: column sockets keep no sector, so only the clash check parts them.
  const BY_COLUMN: Diagram = {
    ...base,
    useCases: ['ImportTheNightlyStockFeed', 'RebuildTheSearchIndex', 'ExpireAbandonedCarts'].map((name, i) => ({ id: `u${i}`, name, placement: 'sw' as const })),
    ports: Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, name: `receiveWarehouseEvent${i}`, side: 'driving' as const, wall: 'w' as const })),
  }
  // A narrow seat against a tall domain: the room for its question to the domain is what sizes the ring.
  const TALL_DOMAIN: Diagram = {
    ...base,
    domain: Array.from({ length: 16 }, (_, i) => ({ id: `d${i}`, name: `Entity${i}`, type: 'entity' as const })),
    useCases: [{ id: 'u1', name: 'Go', placement: 'se' }],
  }
  // A lane from the stacked use case down to an east socket passes the north-east sector, where a seat sits.
  const LANE_PAST_SEAT: Diagram = {
    ...base,
    useCases: [
      { id: 'u0', name: 'PlaceAnOrderFromTheWebShop' },
      { id: 'u1', name: 'SendTheWeeklyNewsletterDigestToEveryone', placement: 'ne' },
    ],
    ports: [
      { id: 'p0', name: 'OrderRepository', side: 'driven', wall: 'e', useCaseId: 'u0' },
      { id: 'p1', name: 'MailQueue', side: 'driven', wall: 'se', useCaseId: 'u0' },
    ],
  }
  // Long west names on rows far from the centre, and one small seat elsewhere: only the sector rule keeps those names
  // out of the neighbouring sectors.
  const LONG_COLUMN: Diagram = {
    ...base,
    useCases: [{ id: 'u1', name: 'Go', placement: 'ne' }],
    ports: Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, name: `handleTheIncomingWarehouseReplenishmentEvent${i}`, side: 'driving' as const, wall: 'w' as const })),
  }
  const domain4 = Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `Entity${i}`, type: 'entity' as const }))
  // A lower-left seat serving an east port: its exit to the bus runs right, across the domain unless the ring grows.
  const EXIT_ACROSS_DOMAIN: Diagram = {
    ...base,
    domain: domain4,
    useCases: [{ id: 'u0', name: 'PlaceOrder' }, { id: 'u1', name: 'SettleTheDailyLedger', placement: 'sw' }],
    ports: [{ id: 'p0', name: 'LedgerStore', side: 'driven', wall: 'e', useCaseId: 'u1' }],
  }
  // An upper-left seat serving an east port: its exit runs right, under the title, across the stacked use case.
  const EXIT_UNDER_STACK: Diagram = {
    ...base,
    domain: domain4,
    useCases: [{ id: 'u0', name: 'PlaceAnOrderFromTheWebShopCheckout' }, { id: 'u1', name: 'SettleTheDailyLedger', placement: 'nw' }],
    ports: [{ id: 'p0', name: 'LedgerStore', side: 'driven', wall: 'e', useCaseId: 'u1' }],
  }
  // A seat beside the domain serving a port on the far side: a sideways exit would run straight through the domain.
  const EXIT_FROM_SIDE_WALL: Diagram = {
    ...base,
    domain: domain4,
    useCases: [{ id: 'u0', name: 'PlaceOrder' }, { id: 'u1', name: 'SettleTheDailyLedger', placement: 'w' }],
    ports: [
      { id: 'p0', name: 'LedgerStore', side: 'driven', wall: 'e', useCaseId: 'u1' },
      { id: 'p1', name: 'ledgerApi', side: 'driving', wall: 'w', useCaseId: 'u1' },
    ],
  }
  // A seat on an upper wall under a stacked use case: the title and the stack are what it has to clear.
  const UNDER_TITLE: Diagram = {
    ...base,
    useCases: [
      { id: 'u0', name: 'PlaceAnOrderFromTheWebShop' },
      { id: 'u1', name: 'SendTheWeeklyNewsletterDigest', placement: 'ne' },
    ],
  }

  describe.each([
    ['lone seat', LONE_SEAT],
    ['seat by a column', BY_COLUMN],
    ['seat under the title', UNDER_TITLE],
    ['seat by a tall domain', TALL_DOMAIN],
    ['lane past a seat', LANE_PAST_SEAT],
    ['long column', LONG_COLUMN],
    ['exit across the domain', EXIT_ACROSS_DOMAIN],
    ['exit under the stack', EXIT_UNDER_STACK],
    ['exit from a side wall', EXIT_FROM_SIDE_WALL],
    ['stress', STRESS_DIAGRAM],
  ])('every seated use case (%s)', (_, diagram) => {
    it.each(['detailed', 'overview'] as const)('stays on its wall, straddling the domain wall, clear of everything (%s)', (mode) => {
      const m = layoutDiagram(diagram, { mode })
      const domain = ringOf(m, 'domain')
      const seatedNodes = m.nodes.filter((u) => u.kind === 'useCase' && u.wall)
      expect(seatedNodes).toHaveLength(diagram.useCases.length)
      for (const node of seatedNodes) {
        const { n } = wallFrame(node.wall!)
        expect(dot(node, n)).toBeCloseTo(domain.halfWidth, 6)
        for (const other of [...m.nodes, ...m.rings.map(labelBox)]) {
          if (other !== node) expect(overlap(node, other) ? `${node.key} overlaps ${other.key}` : 'apart').toBe('apart')
        }
      }
    })

    it('never runs a segment through a box it does not connect', () => {
      const m = layoutDiagram(diagram)
      for (const e of m.edges) {
        const others = m.nodes.filter((n) => !endpointsOf(e.key).includes(n.key))
        for (const seg of segments(e.points)) {
          for (const q of sample(seg)) {
            const hit = others.find((n) => strictlyInside(n, q))
            expect(hit ? `${e.key} crosses ${hit.key}` : 'clear').toBe('clear')
          }
        }
      }
    })

    it('leaves room for its question to the domain, which lands square on the wall of the domain model', () => {
      const m = layoutDiagram(diagram)
      for (const node of m.nodes.filter((u) => u.kind === 'useCase' && u.wall)) {
        const { n } = wallFrame(node.wall!)
        const points = m.edges.find((e) => e.key === `${node.key}->domain`)!.points
        const [a, b] = points
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(RUN_MIN)
        const [p, q] = points.slice(-2)
        expect(Math.abs((q.x - p.x) * n.y - (q.y - p.y) * n.x)).toBeLessThan(1e-6)
        expect(dot(q, n)).toBeCloseTo(m.region!.halfWidth, 6)
      }
    })
  })

  it('centres a run of seats on the wall as a group, not on the ports they serve', () => {
    const m = layoutDiagram(BY_COLUMN)
    const { dir } = wallFrame('sw')
    const seats = m.nodes.filter((u) => u.kind === 'useCase' && u.wall === 'sw')
    expect(seats).toHaveLength(3)
    const lo = Math.min(...seats.map((u) => dot(u, dir) - reach(u.width, u.height, dir)))
    const hi = Math.max(...seats.map((u) => dot(u, dir) + reach(u.width, u.height, dir)))
    expect((lo + hi) / 2).toBeCloseTo(0, 6)
  })

  it('treats an explicit top placement as no placement', () => {
    const top = { ...STRESS_DIAGRAM, useCases: STRESS_DIAGRAM.useCases.map((u) => ({ ...u, placement: 'top' as const })) }
    const none = { ...STRESS_DIAGRAM, useCases: STRESS_DIAGRAM.useCases.map(({ placement: _, ...u }) => u) }
    expect(layoutDiagram(top)).toEqual(layoutDiagram(none))
  })
})

describe('layoutDiagram growth (stress example)', () => {
  const model = layoutDiagram(STRESS_DIAGRAM)
  const items = model.nodes.filter((n) => n.kind === 'domainItem')
  const rootOf = (id: string): string => {
    const item = STRESS_DIAGRAM.domain.find((i) => i.id === id)!
    return item.parentId ? rootOf(item.parentId) : id
  }

  it('is a valid diagram with the advertised shape', () => {
    expect(DiagramSchema.safeParse(STRESS_DIAGRAM).success).toBe(true)
    expect(STRESS_DIAGRAM.domain).toHaveLength(10)
    expect(STRESS_DIAGRAM.ports.filter((p) => p.side === 'driven')).toHaveLength(6)
  })

  it('holds the long domain tree in one card per aggregate, each item centred on its own', () => {
    const cards = model.nodes.filter((n) => n.kind === 'aggregate')
    expect(cards).toHaveLength(2)
    for (const item of items) expect(cards.some((c) => c.x === item.x)).toBe(true)
  })

  it('never separates a parent from its children', () => {
    for (const item of STRESS_DIAGRAM.domain) {
      expect(find(model, 'domainItem', item.id).x).toBe(find(model, 'domainItem', rootOf(item.id)).x)
    }
  })

  it('keeps the two aggregate cards apart', () => {
    const [a, b] = model.nodes.filter((n) => n.kind === 'aggregate')
    expect(right(a) <= left(b) || right(b) <= left(a) || bottom(a) <= top(b) || bottom(b) <= top(a)).toBe(true)
  })

  it('still hugs the region to its content', () => {
    const content = model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind))
    const slack = Math.min(...content.flatMap(corners).map((c) => halfWidthAt(model.region!, c.y) - Math.abs(c.x)))
    expect(slack).toBeGreaterThanOrEqual(-1e-6)
    expect(slack).toBeLessThanOrEqual(24 + 1e-6)
  })

  it('sizes the region to its content: shrunk, a box sticks out', () => {
    const region = model.region!
    const shrunk = hexagon(region.apex - 2 * PADDING)
    const content = model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind))
    expect(content.some((n) => corners(n).some((c) => Math.abs(c.x) > halfWidthAt(shrunk, c.y) || Math.abs(c.y) > shrunk.apex))).toBe(true)
  })

  it('routes every edge (axis-aligned, or along a wall normal or wall) without crossing a box it does not connect', () => {
    for (const e of model.edges) {
      const allowed = new Set(endpointsOf(e.key))
      const others = model.nodes.filter((n) => !allowed.has(n.key))
      for (const seg of segments(e.points)) {
        const deg = (Math.atan2(seg[1].y - seg[0].y, seg[1].x - seg[0].x) * 180) / Math.PI
        const slanted = [60, 120, -60, -120, 30, 150, -30, -150].some((t) => Math.abs(deg - t) < 1e-6)
        expect(seg[0].x === seg[1].x || seg[0].y === seg[1].y || slanted).toBe(true)
        for (const p of sample(seg)) {
          const hit = others.find((n) => strictlyInside(n, p))
          expect(hit ? `${e.key} crosses ${hit.key}` : 'clear').toBe('clear')
        }
      }
    }
  })
})

describe('layoutDiagram placement rules', () => {
  it('seats the adapters of one port on its wall, side by side within an adapter width of it', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      adapters: [...EXAMPLE_DIAGRAM.adapters, { id: 'a-cli', name: 'feedback.cli', portId: 'p-submit' }],
    }
    const m = layoutDiagram(d)
    const socket = find(m, 'port', 'p-submit')
    const { dir } = wallFrame(socket.wall!)
    const adapters = ['a-http', 'a-cli'].map((id) => find(m, 'adapter', id))
    for (const a of adapters) {
      expect(a.wall).toBe(socket.wall)
      expect(Math.abs(dot(a, dir) - dot(socket, dir))).toBeLessThanOrEqual(a.width)
    }
    expect(dot(adapters[0], dir)).not.toBeCloseTo(dot(adapters[1], dir), 0)
    expect(dot(socket, dir)).toBeCloseTo((dot(adapters[0], dir) + dot(adapters[1], dir)) / 2, 6)
  })

  it('puts unassigned adapters, actors and externals on the least crowded wall of their side', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      adapters: [...EXAMPLE_DIAGRAM.adapters, { id: 'a-loose', name: 'LooseAdapter' }],
      actors: [...EXAMPLE_DIAGRAM.actors, { id: 'act-loose', name: 'Cron' }],
      externals: [...EXAMPLE_DIAGRAM.externals, { id: 'ext-loose', name: 'S3' }],
    }
    const m = layoutDiagram(d)
    expect(find(m, 'adapter', 'a-loose').wall).toBe('nw')
    expect(find(m, 'actor', 'act-loose').wall).toBe('w')
    expect(find(m, 'external', 'ext-loose').wall).toBe('ne')
  })

  it('treats an actor linked to a driven adapter as unassigned instead of crossing the diagram', () => {
    const d: Diagram = { ...EXAMPLE_DIAGRAM, actors: [{ id: 'act-x', name: 'Odd', adapterId: 'a-knex' }] }
    const m = layoutDiagram(d)
    expect(find(m, 'actor', 'act-x').x).toBeLessThan(0)
    expect(m.edges.some((e) => e.key === 'actor:act-x->adapter:a-knex')).toBe(false)
  })

  it('keeps a domain service inside the domain, clear of the other items, as the one layer the domain has', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      domain: [{ id: 'd-policy', name: 'RatingPolicy', type: 'domainService' }, ...EXAMPLE_DIAGRAM.domain],
    }
    const m = layoutDiagram(d)
    const service = find(m, 'domainItem', 'd-policy')
    expect(service.layer).toBe('domain')
    expect(m.rings.some((r) => r.role === 'domainServices')).toBe(false)
    expect(corners(service).every((p) => inside(m, m.rings.at(-1)!, p))).toBe(true)
    for (const other of m.nodes.filter((n) => n.kind === 'domainItem' && n !== service)) expect(overlap(service, other)).toBe(false)
  })

  it('places childless domain services after the entity tree', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      domain: [{ id: 'd-policy', name: 'RatingPolicy', type: 'domainService' }, ...EXAMPLE_DIAGRAM.domain],
    }
    const m = layoutDiagram(d)
    const service = find(m, 'domainItem', 'd-policy')
    for (const id of ['d-feedback', 'd-rating', 'd-email']) expect(m.nodes.indexOf(service)).toBeGreaterThan(m.nodes.indexOf(find(m, 'domainItem', id)))
  })

  it('lays out an empty diagram with finite geometry', () => {
    const empty: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
    const m = layoutDiagram(empty)
    expect(m.nodes).toEqual([])
    expect(Object.values(m.bounds).every(Number.isFinite)).toBe(true)
    expect(m.rings.every((r) => r.halfWidth > 0 && r.apex > 0)).toBe(true)
  })
})

describe('use cases with ports on the upper slanted walls', () => {
  const base: Diagram = {
    version: 1,
    kind: 'hexagonal',
    title: '',
    domain: [{ id: 'd', name: 'Order', type: 'entity' }],
    useCases: [
      { id: 'u1', name: 'PlaceOrder' },
      { id: 'u2', name: 'CancelOrder' },
    ],
    ports: [
      { id: 'p1', name: 'place', side: 'driving', wall: 'nw', useCaseId: 'u1' },
      { id: 'p2', name: 'Notify', side: 'driven', wall: 'ne', useCaseId: 'u2' },
    ],
    adapters: [],
    actors: [],
    externals: [],
  }
  const model = layoutDiagram(base)
  const runOf = (portId: string) => {
    const edge = model.edges.find((e) => e.key.includes(`port:${portId}`) && e.key.includes('useCase:'))
    expect(edge).toBeDefined()
    return edge!.key.startsWith('port:') ? [...edge!.points].reverse() : edge!.points
  }

  it.each(['p1', 'p2'])('never doubles back on the run from its use case to %s', (portId) => {
    const run = runOf(portId)
    const climbs = run.slice(1).map((p, i) => Math.sign(p.y - run[i].y)).filter(Boolean)
    expect(new Set(climbs).size).toBeLessThanOrEqual(1)
  })

  it.each([
    ['p1', 'u1', 'nw'],
    ['p2', 'u2', 'ne'],
  ] as const)('seats the use case of %s on its wall and meets the socket straight', (portId, useCaseId, wall) => {
    expect(find(model, 'useCase', useCaseId).wall).toBe(wall)
    expect(runOf(portId)).toHaveLength(2)
  })

  it.each(['detailed', 'overview'] as const)('keeps both use cases off the title and each other (%s)', (mode) => {
    const m = layoutDiagram(base, { mode })
    const [u1, u2] = ['u1', 'u2'].map((id) => find(m, 'useCase', id))
    expect(overlap(u1, u2)).toBe(false)
    for (const u of [u1, u2]) for (const r of m.rings) expect(overlap(u, labelBox(r))).toBe(false)
  })

  it('keeps the stress hexagon compact', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    expect(Math.max(m.bounds.width, m.bounds.height)).toBeLessThan(3500)
  })
})
