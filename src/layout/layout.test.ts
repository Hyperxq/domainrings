import { describe, expect, it } from 'vitest'
import { layoutDiagram, type LayoutModel, type LayoutNode, type LayoutRing, type Point } from './layout'
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
/** A node's four corners, turned by its rotation (degrees) when it has one. */
const corners = (n: LayoutNode): Point[] => {
  const a = ((n.rotation ?? 0) * Math.PI) / 180
  return [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => {
    const [ox, oy] = [(sx * n.width) / 2, (sy * n.height) / 2]
    return { x: n.x + ox * Math.cos(a) - oy * Math.sin(a), y: n.y + ox * Math.sin(a) + oy * Math.cos(a) }
  })
}
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
  return { key: `label:${ring.key}`, ref: ring.key, kind: 'note', tone: 'muted', lines: [], x: 0, y: ring.labelAt.y - line / 2 + height / 2, width, height }
}

type Segment = [Point, Point]
const segments = (points: Point[]): Segment[] => points.slice(1).map((p, i) => [points[i], p])
const sample = ([a, b]: Segment, step = 0.01): Point[] =>
  Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i * step, y: a.y + (b.y - a.y) * i * step }))
const strictlyInside = (n: LayoutNode, p: Point) => {
  const a = (-(n.rotation ?? 0) * Math.PI) / 180
  const [dx, dy] = [p.x - n.x, p.y - n.y]
  const [lx, ly] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]
  return Math.abs(lx) < n.width / 2 - 1 && Math.abs(ly) < n.height / 2 - 1
}

/** Independent wall frames: outward normal n and along-wall dir for each wall of a pointy-top hexagon. */
const WALL_NORMAL_DEG = { e: 0, se: 60, sw: 120, w: 180, nw: 240, ne: 300 } as const
const wallFrame = (wall: keyof typeof WALL_NORMAL_DEG) => {
  const a = (WALL_NORMAL_DEG[wall] * Math.PI) / 180
  const n = { x: Math.cos(a), y: Math.sin(a) }
  return { n, dir: { x: -n.y, y: n.x } }
}
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const SLANTED = new Set(['nw', 'sw', 'ne', 'se'])

/** Separating-axis test for two (possibly rotated) boxes; touching edges do not count as overlap. */
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


const DOMAIN_TEXT = new Set<LayoutNode['kind']>(['domainItem', 'note', 'portDecl'])
const DOMAIN_BLOCK = new Set<LayoutNode['kind']>([...DOMAIN_TEXT, 'aggregate'])
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
    for (const adapter of EXAMPLE_DIAGRAM.adapters) {
      expect(find(model, 'adapter', adapter.id).y).toBe(find(model, 'port', adapter.portId!).y)
    }
    for (const actor of EXAMPLE_DIAGRAM.actors) {
      expect(find(model, 'actor', actor.id).y).toBe(find(model, 'adapter', actor.adapterId!).y)
    }
    for (const external of EXAMPLE_DIAGRAM.externals) {
      expect(find(model, 'external', external.id).y).toBe(find(model, 'adapter', external.adapterId!).y)
    }
  })

  it('places adapters inside the adapter ring, outside their socket', () => {
    for (const adapter of EXAMPLE_DIAGRAM.adapters) {
      const node = find(model, 'adapter', adapter.id)
      const socket = find(model, 'port', adapter.portId!)
      for (const c of corners(node)) expect(inside(model, adapterRing, c)).toBe(true)
      if (node.x < 0) expect(right(node)).toBeLessThan(left(socket))
      else expect(left(node)).toBeGreaterThan(right(socket))
    }
  })

  it('keeps actors and externals outside the outermost ring', () => {
    for (const n of model.nodes.filter((n) => n.kind === 'actor')) expect(right(n)).toBeLessThan(-outer.halfWidth)
    for (const n of model.nodes.filter((n) => n.kind === 'external')) expect(left(n)).toBeGreaterThan(outer.halfWidth)
  })

  it('lists use cases at the top of the application ring, above the inner layers', () => {
    const innerRing = model.rings[model.rings.indexOf(app) + 1]
    const useCase = find(model, 'useCase', 'uc-submit')
    expect(bottom(useCase)).toBeLessThan(-innerRing.apex)
    for (const c of corners(useCase)) expect(inside(model, app, c)).toBe(true)
  })

  it('keeps domain items inside the innermost ring', () => {
    for (const item of EXAMPLE_DIAGRAM.domain) {
      for (const c of corners(find(model, 'domainItem', item.id))) expect(inside(model, domainRing, c)).toBe(true)
    }
  })

  it('hugs the domain text block with at most 24 units of padding', () => {
    const content = [...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)), labelBox(domainRing)]
    const slack = Math.min(...content.flatMap(corners).map((c) => halfWidth(model.shape, domainRing, c.y) - Math.abs(c.x)))
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
    const bigger = layoutDiagram(withManyDrivingPorts(8))
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

  it('sets every ring title at one shared depth under its top vertex, inside its ring, above its content', () => {
    const depths = model.rings.map((ring) => top(labelBox(ring)) + ring.apex)
    for (const depth of depths) expect(Math.abs(depth - depths[0])).toBeLessThanOrEqual(1)
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

  it('draws every arrow with axis-aligned segments; a hexagon trunk may also follow the ring walls', () => {
    for (const e of model.edges) {
      for (const [a, b] of segments(e.points)) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const alongWall = e.kind === 'wiring' && [30, 150, -30, -150].some((t) => Math.abs(deg - t) < 1e-6)
        expect(a.x === b.x || a.y === b.y || alongWall).toBe(true)
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

  it('runs each use-case bus in the gap between the inner ring and the socket column', () => {
    const inner = model.rings[model.rings.indexOf(app) + 1]
    const busEdges = model.edges.filter((e) => e.kind === 'import' && e.key.includes('useCase:') && e.key.includes('port:'))
    expect(busEdges.length).toBeGreaterThan(0)
    for (const e of busEdges) {
      const bus = segments(e.points).find(([a, b]) => a.x === b.x)!
      const side = Math.sign(bus[0].x)
      const socketColumn = Math.min(
        ...model.nodes.filter((n) => n.kind === 'port' && Math.sign(n.x) === side).map((n) => Math.abs(n.x) - n.width / 2),
      )
      expect(Math.abs(bus[0].x)).toBeLessThan(socketColumn)
      for (const p of sample(bus)) expect(Math.abs(p.x)).toBeGreaterThan(halfWidth(model.shape, inner, p.y))
      expect(Math.abs(bus[0].x)).toBeGreaterThan(inner.halfWidth)
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

  it('sends one arrow from each use case down into the domain, and none out of it', () => {
    for (const u of EXAMPLE_DIAGRAM.useCases) {
      const inbound = model.edges.filter((e) => e.kind === 'import' && e.key === `useCase:${u.id}->domain`)
      expect(inbound).toHaveLength(1)
      const [a, b] = segments(inbound[0].points).at(-1)!
      expect(a.x).toBe(b.x)
      expect(b.y).toBeGreaterThan(a.y)
      expect(b.y - a.y).toBeGreaterThanOrEqual(12)
      // Onion's domain is two rings; the arrow stops on the outer one, before any domain service box.
      expect(b.y).toBeCloseTo(-model.rings[model.rings.indexOf(app) + 1].apex, 6)
      expect(Math.abs(b.x)).toBeLessThan(1e-6)
    }
    const domainKeys = new Set(['domain', ...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).map((n) => n.key)])
    const outbound = model.edges.filter((e) => e.kind === 'import' && domainKeys.has(endpointsOf(e.key)[0]))
    expect(outbound).toEqual([])
  })

  it('writes "asks the domain to decide" flat, beside the vertical run into the domain', () => {
    const e = model.edges.find((e) => intoDomain(e.key))!
    const [a, b] = segments(e.points).at(-1)!
    expect(e.label).toBe('asks the domain to decide')
    expect(e).not.toHaveProperty('labelAngle')
    expect(e.labelAt!.x + measure(e.label!, EDGE_LABEL) / 2).toBeLessThanOrEqual(a.x - 4)
    expect(e.labelAt!.y).toBeGreaterThan(Math.min(a.y, b.y))
    expect(e.labelAt!.y).toBeLessThan(Math.max(a.y, b.y))
  })

  if (config.drivenPortNote) {
    it('links every driven port declared in the domain to its socket with one dotted, axis-aligned line', () => {
      const imports = model.edges.filter((e) => e.kind === 'import').flatMap((e) => segments(e.points))
      const overlaps = ([a, b]: Segment, [c, d]: Segment) =>
        (a.y === b.y && c.y === d.y && a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))) ||
        (a.x === b.x && c.x === d.x && a.x === c.x && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)))
      for (const port of EXAMPLE_DIAGRAM.ports.filter((p) => p.side === 'driven')) {
        const links = model.edges.filter((e) => e.kind === 'declares' && e.key === `portDecl:${port.id}->port:${port.id}`)
        expect(links).toHaveLength(1)
        const socket = find(model, 'port', port.id)
        const declaration = find(model, 'portDecl', port.id)
        expect(declaration.lines.map((l) => l.text).join('')).toBe(port.name)
        const [first, last] = [links[0].points[0], links[0].points.at(-1)!]
        expect(inside(model, domainRing, first)).toBe(true)
        // Two-tone: the path splits on the domain ring edge, so each part can be drawn for its own background.
        const split = links[0].insideTo!
        const onEdge = links[0].points[split]
        expect(Math.abs(Math.abs(onEdge.x) - halfWidth(model.shape, domainRing, onEdge.y))).toBeLessThan(1e-6)
        for (const p of links[0].points.slice(0, split + 1)) expect(inside(model, domainRing, p)).toBe(true)
        for (const seg of segments(links[0].points.slice(split))) {
          for (const p of sample(seg).slice(1)) expect(inside(model, domainRing, p)).toBe(false)
        }
        expect(Math.abs(Math.abs(last.x) - (Math.abs(socket.x) - socket.width / 2))).toBeLessThan(1e-6)
        expect(Math.abs(last.y - socket.y)).toBeLessThan(socket.height / 2)
        for (const seg of segments(links[0].points)) {
          expect(imports.some((imp) => overlaps(seg, imp)) ? `${links[0].key} runs along an arrow` : 'clear').toBe('clear')
        }
      }
      for (const [i, link] of model.edges.filter((e) => e.kind === 'declares').entries()) {
        for (const other of model.edges.filter((e) => e.kind === 'declares').slice(i + 1)) {
          for (const s1 of segments(link.points)) {
            for (const s2 of segments(other.points)) {
              const [h, v] = s1[0].y === s1[1].y ? [s1, s2] : [s2, s1]
              if (h[0].y !== h[1].y || v[0].x !== v[1].x) continue
              const crosses =
                Math.min(h[0].x, h[1].x) < v[0].x && v[0].x < Math.max(h[0].x, h[1].x) &&
                Math.min(v[0].y, v[1].y) < h[0].y && h[0].y < Math.max(v[0].y, v[1].y)
              expect(crosses ? `${link.key} crosses ${other.key}` : 'clear').toBe('clear')
            }
          }
        }
      }
    })
  }

  it('centres every domain line on the ring axis, children as one smaller line under their parent', () => {
    for (const n of model.nodes.filter((n) => DOMAIN_TEXT.has(n.kind))) {
      expect(n.x).toBe(0)
      expect(n.align).toBe('center')
    }
    const parent = find(model, 'domainItem', 'd-feedback')
    const children = ['d-rating', 'd-email'].map((id) => find(model, 'domainItem', id))
    expect(parent.lines.map((l) => l.style)).toEqual(['strong'])
    for (const child of children) {
      expect(child.y).toBeGreaterThan(parent.y)
      expect(child.lines).toHaveLength(1)
      expect(child.lines[0].style).toBe('minor')
    }
    expect(children[0].lines[0]).toEqual({ text: 'FeedbackRating', style: 'minor', tag: '○ value object' })
    expect(children[1].y).toBeGreaterThan(children[0].y)
  })

  it('never overlaps the rows of the domain block', () => {
    const rows = model.nodes.filter((n) => DOMAIN_TEXT.has(n.kind)).sort((a, b) => a.y - b.y)
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

  it('labels each shared lane once, flat above one of its horizontal segments', () => {
    const labelled = model.edges.filter((e) => e.label && !e.key.endsWith('->domain'))
    expect(labelled.map((e) => e.label).sort()).toEqual(['runs the use case', 'uses'])
    for (const e of labelled) {
      expect(e).not.toHaveProperty('labelAngle')
      const under = segments(e.points).find(
        ([a, b]) => a.y === b.y && Math.min(a.x, b.x) <= e.labelAt!.x && e.labelAt!.x <= Math.max(a.x, b.x) && a.y - e.labelAt!.y > 0 && a.y - e.labelAt!.y <= 16,
      )
      expect(under).toBeDefined()
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
    const domainRing = model.rings[model.rings.length - 1]
    const outlines = model.nodes.filter((n) => n.kind === 'aggregate')
    const descendantsOf = (id: string): string[] =>
      diagram.domain.filter((i) => i.parentId === id).flatMap((i) => [i.id, ...descendantsOf(i.id)])

    it('outlines every aggregate root with its descendants inside, 8 units of padding clear', () => {
      const roots = diagram.domain.filter((i) => i.type === 'aggregate' && !i.parentId)
      expect(outlines.map((o) => o.ref).sort()).toEqual(roots.map((r) => r.id).sort())
      for (const outline of outlines) {
        expect(outline.lines).toEqual([{ text: '◆ aggregate', style: 'tag' }])
        const root = find(model, 'domainItem', outline.ref)
        expect(root.lines[0].style).toBe('strong')
        for (const n of [root, ...descendantsOf(outline.ref).map((id) => find(model, 'domainItem', id))]) {
          expect(left(n)).toBeGreaterThanOrEqual(left(outline) + 8 - 1e-6)
          expect(right(n)).toBeLessThanOrEqual(right(outline) - 8 + 1e-6)
          expect(top(n)).toBeGreaterThan(top(outline) + 8)
          expect(bottom(n)).toBeLessThanOrEqual(bottom(outline) - 8 + 1e-6)
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

    it('still hugs the domain ring to the outline corners', () => {
      const slack = Math.min(
        ...model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).flatMap(corners).map((c) => halfWidth(model.shape, domainRing, c.y) - Math.abs(c.x)),
      )
      expect(slack).toBeGreaterThanOrEqual(-1e-6)
      expect(slack).toBeLessThanOrEqual(24 + 1e-6)
    })
  })
})

describe('type tags: one glyph + word per element', () => {
  const GLYPHS = ['◆', '●', '○', '⚙', '▶', '⇥', '⇤']
  const tagsOf = (nodes: LayoutNode[]) =>
    nodes.flatMap((n) => n.lines.flatMap((l) => [l.tag, GLYPHS.some((g) => l.text.startsWith(`${g} `)) ? l.text : undefined].filter(Boolean)))
  const expectedGlyph = { aggregate: '◆', entity: '●', valueObject: '○', domainService: '⚙' } as const

  describe.each([
    ['hexagonal feedback', EXAMPLE_DIAGRAM],
    ['hexagonal stress', STRESS_DIAGRAM],
  ])('%s', (_, diagram) => {
    const model = layoutDiagram(diagram)
    const labels = HEXAGONAL_KIND.labels
    const nodesOf = (ref: string) => model.nodes.filter((n) => n.ref === ref && n.kind !== 'portDecl')

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
        expect(tagsOf(nodesOf(p.id))).toEqual([p.side === 'driving' ? `⇥ ${labels.drivingPort}` : `⇤ ${labels.drivenPort}`])
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
        const nameLine = find(model, 'domainItem', item.id).lines.find((l) => !GLYPHS.some((g) => l.text.startsWith(`${g} `)))!
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

    it('keeps only the straight horizontal flow arrows, with no labels', () => {
      expect(overview.edges.length).toBeGreaterThan(0)
      for (const e of overview.edges) {
        expect(e.kind).toBe('import')
        expect(e.label).toBeUndefined()
        expect(e.points).toHaveLength(2)
        const [a, b] = e.points
        const along = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI)
        expect(a.y === b.y || [60, 120, -60, -120].some((deg) => Math.abs(along - deg) < 1e-6)).toBe(true)
        const kinds = endpointsOf(e.key).map((k) => k.split(':')[0])
        expect([['actor', 'adapter'], ['adapter', 'port'], ['port', 'adapter'], ['adapter', 'external']]).toContainEqual(kinds)
      }
    })

    it('shows names only: one line per element, no tags, notes or signatures', () => {
      for (const n of overview.nodes) {
        expect(n.lines.length).toBeLessThanOrEqual(1)
        for (const l of n.lines) expect(l.tag).toBeUndefined()
      }
      expect(overview.nodes.some((n) => n.kind === 'composition' || n.kind === 'note' || n.kind === 'portDecl' || n.kind === 'aggregate')).toBe(false)
    })

    it('lists only aggregate and entity roots in the domain', () => {
      const roots = diagram.domain.filter((i) => !i.parentId && (i.type === 'aggregate' || i.type === 'entity')).map((i) => i.id)
      expect(overview.nodes.filter((n) => n.kind === 'domainItem').map((n) => n.ref).sort()).toEqual(roots.sort())
    })

    it('keeps sockets as small notches on the application ring edge', () => {
      const sockets = overview.nodes.filter((n) => n.kind === 'port')
      expect(sockets).toHaveLength(diagram.ports.length)
      for (const s of sockets) {
        expect(s.lines).toEqual([])
        // A notch is thin across its wall; on a slanted wall its long side lies along the wall.
        expect(Math.min(s.width, s.height)).toBeLessThan(24)
      }
    })

    it('keeps the stacked use cases in the application band, above the ring inside it', () => {
      const app = ringOf(overview, 'application')
      const inner = overview.rings[overview.rings.indexOf(app) + 1]
      for (const u of overview.nodes.filter((n) => n.kind === 'useCase' && !n.wall)) {
        expect(bottom(u)).toBeLessThanOrEqual(-inner.apex)
        for (const c of corners(u)) expect(inside(overview, app, c)).toBe(true)
      }
    })

    it('shrinks the rings', () => {
      expect(overview.rings[0].apex).toBeLessThan(detailed.rings[0].apex)
    })
  })
})

// Names far longer than their notches, two of them sharing a slanted wall with no adapter to space them out.
const LONG_NAMES: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: '',
  domain: ['Order', 'Invoice', 'Customer'].map((name) => ({ id: name, name, type: 'entity' as const })),
  useCases: [],
  ports: [
    { id: 'pw', name: 'placeOrderFromTheStorefrontCheckout', side: 'driving', wall: 'w' },
    { id: 'pn1', name: 'PublishOrderPlacedIntegrationEvent', side: 'driven', wall: 'ne' },
    { id: 'pn2', name: 'ReserveStockInTheWarehouseSystem', side: 'driven', wall: 'ne' },
    { id: 'pe', name: 'ChargeTheCustomerPaymentMethod', side: 'driven', wall: 'e' },
  ],
  adapters: [],
  actors: [],
  externals: [],
}
// Long names sharing the lower walls: no title or use case down there, so the spokes are what size the ring.
const LOWER_WALLS: Diagram = {
  ...LONG_NAMES,
  ports: (['sw', 'se'] as const).flatMap((wall) =>
    [1, 2].map((k) => ({ id: `${wall}${k}`, name: `ALongPortNameOnTheLowerWall${k}`, side: wall === 'sw' ? ('driving' as const) : ('driven' as const), wall })),
  ),
}
// With no slanted wall, only the side walls' own width keeps a long name off the domain.
const SIDE_WALLS_ONLY: Diagram = { ...LONG_NAMES, ports: LONG_NAMES.ports.map((p) => (p.wall === 'ne' ? { ...p, wall: 'e' as const } : p)) }
// A tall west column of long names: its outer rows' names reach in toward the spokes.
const TALL_COLUMN: Diagram = {
  ...LONG_NAMES,
  ports: [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, name: `HandleIncomingRequestNumber${i}FromTheWeb`, side: 'driving' as const, wall: 'w' as const })),
    { id: 'pn', name: 'x', side: 'driven', wall: 'ne' },
  ],
}

describe('overview port labels', () => {
  describe.each([
    ['feedback', EXAMPLE_DIAGRAM],
    ['six-wall stress', STRESS_DIAGRAM],
    ['long names', LONG_NAMES],
    ['lower walls', LOWER_WALLS],
    ['side walls only', SIDE_WALLS_ONLY],
    ['tall column', TALL_COLUMN],
  ])('%s example', (_, diagram) => {
    const m = layoutDiagram(diagram, { mode: 'overview' })
    const app = ringOf(m, 'application')
    const inner = m.rings[m.rings.indexOf(app) + 1]
    const labels = m.nodes.filter((n) => n.kind === 'portLabel')
    const sockets = m.nodes.filter((n) => n.kind === 'port')
    const edgePoints = (n: LayoutNode) => {
      const [a, b, c, e] = corners(n)
      return [[a, b], [b, e], [e, c], [c, a]].flatMap(([p, q]) => sample([p, q] as Segment, 0.05))
    }

    it('gives every socket exactly one label carrying just the port name', () => {
      expect(sockets.length).toBe(diagram.ports.length)
      for (const socket of sockets) {
        const own = labels.filter((l) => l.ref === socket.ref)
        expect(own).toHaveLength(1)
        const name = diagram.ports.find((p) => p.id === socket.ref)!.name
        expect(own[0].lines).toEqual([{ text: name, style: 'label' }])
      }
      expect(labels).toHaveLength(sockets.length)
    })

    it('keeps each label inside the application ring and a full gap (14) clear of the ring inside it', () => {
      const clearOf = shrink(m.shape, inner, -14 + 1e-3)
      for (const label of labels) {
        for (const p of edgePoints(label)) {
          expect(inside(m, app, p)).toBe(true)
          expect(inside(m, clearOf, p)).toBe(false)
        }
      }
    })

    // As with every column box, sectors only bind once some wall is slanted; w/e-only hexagons have no neighbour to meet.
    it.runIf(sockets.some((s) => s.rotation !== undefined))('keeps each label 8 clear of the spokes, inside its own wall sector', () => {
      const tan30 = Math.tan(Math.PI / 6)
      for (const label of labels) {
        const { n, dir } = wallFrame(sockets.find((s) => s.ref === label.ref)!.wall!)
        for (const c of corners(label)) expect((dot(c, n) * tan30 - Math.abs(dot(c, dir))) * COS30).toBeGreaterThanOrEqual(8 - 1e-6)
      }
    })

    it('overlaps no other element and no layer title', () => {
      const titles = m.rings.map(labelBox)
      for (const label of labels) {
        for (const other of [...m.nodes, ...titles]) {
          if (other === label) continue
          expect({ label: label.key, other: other.key, overlap: overlap(label, other) }).toEqual({ label: label.key, other: other.key, overlap: false })
        }
      }
    })

    it('reads upright: slanted labels lie along their wall, side-wall labels stay flat and start just inside the socket', () => {
      for (const label of labels) {
        const socket = sockets.find((s) => s.ref === label.ref)!
        const rotation = label.rotation ?? 0
        expect(rotation).toBeGreaterThanOrEqual(-90)
        expect(rotation).toBeLessThanOrEqual(90)
        if (socket.rotation !== undefined) {
          expect(rotation).toBeCloseTo(socket.rotation)
          expect(label.align).toBe('center')
        } else {
          expect(label.rotation).toBeUndefined()
          expect(label.y).toBeCloseTo(socket.y)
          const driving = socket.side === 'driving'
          expect(label.align).toBe(driving ? 'start' : 'end')
          const gap = driving ? left(label) - right(socket) : left(socket) - right(label)
          expect(gap).toBeGreaterThan(0)
          expect(gap).toBeLessThanOrEqual(8)
        }
      }
    })
  })

  it('labels a slanted socket on its inner side, never upside down, on all six walls', () => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })
    const walls = new Set(m.nodes.filter((n) => n.kind === 'port').map((n) => n.wall))
    expect(walls).toEqual(new Set(['nw', 'w', 'sw', 'ne', 'e', 'se']))
    for (const socket of m.nodes.filter((n) => n.kind === 'port' && n.rotation !== undefined)) {
      const label = find(m, 'portLabel', socket.ref)
      expect(Math.hypot(label.x, label.y)).toBeLessThan(Math.hypot(socket.x, socket.y))
    }
  })

  it('leaves the detailed view without labels', () => {
    expect(layoutDiagram(STRESS_DIAGRAM).nodes.some((n) => n.kind === 'portLabel')).toBe(false)
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
  ])('keeps every title at the shared depth for %s, the domain title above the ring centre', (_, diagram) => {
    const m = layoutDiagram(diagram)
    const depths = m.rings.map((ring) => top(labelBox(ring)) + ring.apex)
    for (const depth of depths) expect(Math.abs(depth - depths[0])).toBeLessThanOrEqual(1)
    expect(bottom(labelBox(m.rings.at(-1)!))).toBeLessThan(0)
  })
})

describe('ports on every wall (hexagonal stress example)', () => {
  const model = layoutDiagram(STRESS_DIAGRAM)
  const app = ringOf(model, 'application')
  const adapterRing = ringOf(model, 'adapters')
  const ports = model.nodes.filter((n) => n.kind === 'port')
  const walled = model.nodes.filter((n) => n.wall)
  const tan30 = Math.tan(Math.PI / 6)

  it('uses all six walls, each port on a wall of its own side', () => {
    expect(new Set(ports.map((p) => p.wall))).toEqual(new Set(['nw', 'w', 'sw', 'ne', 'e', 'se']))
    for (const p of ports) expect(['nw', 'w', 'sw'].includes(p.wall!)).toBe(p.side === 'driving')
  })

  it('puts every socket on its wall segment, rotated with the wall', () => {
    for (const p of ports) {
      const { n, dir } = wallFrame(p.wall!)
      expect(dot({ x: p.x, y: p.y }, n)).toBeCloseTo(app.halfWidth, 6)
      expect(Math.abs(dot({ x: p.x, y: p.y }, dir))).toBeLessThanOrEqual(app.apex / 2 + 1e-6)
      const wallAngle = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 450) % 180 - 90
      if (SLANTED.has(p.wall!)) expect(p.rotation).toBeCloseTo(wallAngle, 6)
      else expect(p.rotation ?? 0).toBe(0)
    }
  })

  it('attaches each adapter outward on the wall normal through its socket, inside the adapter ring', () => {
    for (const adapter of STRESS_DIAGRAM.adapters) {
      const node = find(model, 'adapter', adapter.id)
      const socket = find(model, 'port', adapter.portId!)
      const { n, dir } = wallFrame(socket.wall!)
      const offset = { x: node.x - socket.x, y: node.y - socket.y }
      expect(Math.abs(dot(offset, dir))).toBeLessThan(1e-6)
      expect(dot(offset, n)).toBeGreaterThan(0)
      expect(overlap(node, socket)).toBe(false)
      for (const c of corners(node)) expect(inside(model, adapterRing, c)).toBe(true)
      expect(node.rotation ?? 0).toBe(0)
    }
  })

  it('keeps every wall box inside its own sector, at least 8 units clear of the spokes', () => {
    for (const box of walled.filter((b) => SLANTED.has(b.wall!) || walled.some((o) => SLANTED.has(o.wall!)))) {
      const { n, dir } = wallFrame(box.wall!)
      for (const c of corners(box)) {
        expect(Math.abs(dot(c, dir))).toBeLessThanOrEqual(dot(c, n) * tan30 - 8 / Math.cos(Math.PI / 6) + 1e-6)
      }
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
      if (!target?.wall || !SLANTED.has(target.wall)) continue
      const { n } = wallFrame(target.wall)
      const [a, b] = segments(e.points).at(-1)!
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(Math.hypot(run.x, run.y)).toBeGreaterThanOrEqual(12)
    }
  })

  it('draws arrows only horizontally, vertically or along a wall normal; wires may also follow a wall', () => {
    const normals = [60, 120, -60, -120]
    const walls = [30, 150, -30, -150]
    for (const e of model.edges) {
      for (const [a, b] of segments(e.points)) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const axis = a.x === b.x || a.y === b.y
        const allowed = [...normals, ...(e.kind === 'wiring' ? walls : [])].some((t) => Math.abs(deg - t) < 1e-6)
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

  it('sizes the application and adapter rings to the wall content: 2×padding smaller breaks something', () => {
    const boxesOf = (m: LayoutModel) => m.nodes.filter((b) => b.kind !== 'aggregate' && b.kind !== 'domainItem')
    for (const ring of [app, adapterRing]) {
      const shrunk = shrink(model.shape, ring, 2 * PADDING)
      const delta = ring.halfWidth - shrunk.halfWidth
      // Re-seat what hangs off this ring's wall: sockets and adapters off the application wall, leaves off the outer one.
      const moves = (b: LayoutNode) =>
        !!b.wall && (ring === app ? b.kind === 'port' || b.kind === 'adapter' : b.kind === 'actor' || b.kind === 'external')
      const seated = boxesOf(model).map((b) => {
        if (!moves(b)) return b
        const { n } = wallFrame(b.wall!)
        return { ...b, x: b.x - n.x * delta, y: b.y - n.y * delta }
      })
      const inSector = (b: LayoutNode) => {
        const { n, dir } = wallFrame(b.wall!)
        return corners(b).every((c) => Math.abs(dot(c, dir)) <= dot(c, n) * tan30 - 8 / Math.cos(Math.PI / 6) + 1e-6)
      }
      const sectorBroken = seated.filter((b) => b.wall && walled.some((o) => SLANTED.has(o.wall!))).some((b) => !inSector(b))
      const clash = seated.some((a, i) => seated.slice(i + 1).some((b) => overlap(a, b)))
      const title = labelBox(ring)
      const reseatedTitle = { ...title, y: title.y + (ring.apex - shrunk.apex) }
      const titleClash = seated.some((b) => overlap(b, reseatedTitle))
      const outOfRing = ring === adapterRing && seated.filter((b) => b.kind === 'adapter').some((b) => corners(b).some((c) => !inside(model, shrunk, c)))
      const innerRing = model.rings[model.rings.indexOf(ring) + 1]
      const hitsInner = seated.filter((b) => b.kind === 'port').some((b) => corners(b).some((c) => inside(model, innerRing, c)))
      // A use-case run that now passes through a re-seated socket it does not serve.
      const runHitsSocket =
        ring === app &&
        model.edges
          .filter((e) => e.kind === 'import' && e.key.includes('useCase:'))
          .some((e) =>
            seated
              .filter((b) => b.kind === 'port' && moves(b) && !endpointsOf(e.key).includes(b.key))
              .some((b) => segments(e.points).some((seg) => sample(seg).some((p) => strictlyInside(b, p)))),
          )
      expect({ ring: ring.role, breaks: sectorBroken || clash || titleClash || outOfRing || hitsInner || runHitsSocket }).toEqual({
        ring: ring.role,
        breaks: true,
      })
    }
  })
})

const RUN_MIN = 16

describe('use cases placed on a wall', () => {
  const placed = STRESS_DIAGRAM.useCases.find((u) => u.placement === 'nw')!
  const port = STRESS_DIAGRAM.ports.find((p) => p.useCaseId === placed.id && p.wall === 'nw')!
  const tan30 = Math.tan(Math.PI / 6)

  it('extends the stress example with a use case on nw, next to its driving port', () => {
    expect(placed).toBeDefined()
    expect(port.side).toBe('driving')
  })

  describe.each(['detailed', 'overview'] as const)('%s', (mode) => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode })
    const app = ringOf(m, 'application')
    const inner = m.rings[m.rings.indexOf(app) + 1]
    const node = find(m, 'useCase', placed.id)
    const { n, dir } = wallFrame('nw')

    it('sits upright in the nw sector, 8 clear of the spokes, inside the application band', () => {
      expect(node.wall).toBe('nw')
      expect(node.rotation).toBeUndefined()
      const clearOfInner = shrink(m.shape, inner, -14 + 1e-3)
      for (const c of corners(node)) {
        expect(Math.abs(dot(c, dir))).toBeLessThanOrEqual(dot(c, n) * tan30 - 8 / COS30 + 1e-6)
        expect(inside(m, app, c)).toBe(true)
        expect(inside(m, clearOfInner, c)).toBe(false)
      }
    })

    it('sits on the inner side of its wall’s sockets and their names', () => {
      const wallContent = m.nodes.filter((b) => (b.kind === 'port' || b.kind === 'portLabel') && STRESS_DIAGRAM.ports.some((p) => p.id === b.ref && p.wall === 'nw'))
      const innermost = Math.min(...wallContent.flatMap((b) => corners(b).map((c) => dot(c, n))))
      for (const c of corners(node)) expect(dot(c, n)).toBeLessThan(innermost)
    })

    it('overlaps no other element and no layer title', () => {
      for (const other of [...m.nodes, ...m.rings.map(labelBox)]) {
        if (other === node) continue
        expect(overlap(node, other) ? `overlaps ${other.key}` : 'apart').toBe('apart')
      }
    })

    it('keeps the top stack for every other use case', () => {
      for (const u of STRESS_DIAGRAM.useCases.filter((u) => u !== placed)) {
        const stacked = find(m, 'useCase', u.id)
        expect(stacked.x).toBe(0)
        expect(stacked.wall).toBeUndefined()
      }
    })
  })

  describe('routing (detailed)', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    const domain = ringOf(m, 'domain')
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

    it('still reaches its ports on other walls through the bus', () => {
      for (const p of STRESS_DIAGRAM.ports.filter((p) => p.useCaseId === placed.id && p.wall !== 'nw')) {
        const e = m.edges.find((x) => x.key.includes(`useCase:${placed.id}`) && x.key.includes(`port:${p.id}`))!
        expect(e.points.length).toBeGreaterThanOrEqual(3)
      }
    })

    it('asks the domain along the sector bisector, landing square on the nearest domain wall', () => {
      const e = edge(`useCase:${placed.id}->domain`)
      expect(e.points).toHaveLength(2)
      const [a, b] = e.points
      const run = { x: b.x - a.x, y: b.y - a.y }
      expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
      expect(dot(b, n)).toBeCloseTo(domain.halfWidth, 6)
      expect(Math.hypot(run.x, run.y)).toBeGreaterThanOrEqual(16)
    })
  })

  const base: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [{ id: 'd1', name: 'Order', type: 'entity' }], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
  // A wide seat alone on a lower wall: only its own sector and domain clearance size the ring.
  const LONE_SEAT: Diagram = { ...base, useCases: [{ id: 'u1', name: 'ReconcileEveryOutstandingInvoice', placement: 'sw' }] }
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
    it.each(['detailed', 'overview'] as const)('stays in its sector and band, clear of everything (%s)', (mode) => {
      const m = layoutDiagram(diagram, { mode })
      const app = ringOf(m, 'application')
      const clearOfInner = shrink(m.shape, m.rings[m.rings.indexOf(app) + 1], -14 + 1e-3)
      const seatedNodes = m.nodes.filter((u) => u.kind === 'useCase' && u.wall)
      expect(seatedNodes).toHaveLength(diagram.useCases.filter((u) => u.placement && u.placement !== 'top').length)
      for (const node of seatedNodes) {
        const { n, dir } = wallFrame(node.wall!)
        for (const c of corners(node)) {
          expect(Math.abs(dot(c, dir))).toBeLessThanOrEqual(dot(c, n) * tan30 - 8 / COS30 + 1e-6)
          expect(inside(m, app, c)).toBe(true)
          expect(inside(m, clearOfInner, c)).toBe(false)
        }
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

    it('reaches its bus without ever entering the domain', () => {
      const m = layoutDiagram(diagram)
      const domain = m.rings.at(-1)!
      for (const node of m.nodes.filter((u) => u.kind === 'useCase' && u.wall)) {
        for (const e of m.edges.filter((e) => endpointsOf(e.key).includes(node.key) && !e.key.endsWith('->domain'))) {
          for (const seg of segments(e.points)) for (const q of sample(seg)) expect(inside(m, domain, q) ? `${e.key} enters the domain` : 'outside').toBe('outside')
        }
      }
    })

    it('leaves room for its question to the domain, which lands square on the domain’s matching wall', () => {
      const m = layoutDiagram(diagram)
      const domain = m.rings.at(-1)!
      for (const node of m.nodes.filter((u) => u.kind === 'useCase' && u.wall)) {
        const { n } = wallFrame(node.wall!)
        const points = m.edges.find((e) => e.key === `${node.key}->domain`)!.points
        const [a, b] = points
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(RUN_MIN)
        const [p, q] = points.slice(-2)
        expect(Math.abs((q.x - p.x) * n.y - (q.y - p.y) * n.x)).toBeLessThan(1e-6)
        expect(dot(q, n)).toBeCloseTo(domain.halfWidth, 6)
      }
    })
  })

  it.each([
    ['detailed', BY_COLUMN],
    ['overview', BY_COLUMN],
    ['detailed', LONG_COLUMN],
    ['overview', LONG_COLUMN],
  ] as const)('keeps side-wall sockets and their names in their own sector once a use case is seated (%s)', (mode, diagram) => {
    const m = layoutDiagram(diagram, { mode })
    const socketOf = new Map(m.nodes.filter((n) => n.kind === 'port').map((n) => [n.ref, n]))
    for (const box of m.nodes.filter((n) => n.kind === 'port' || n.kind === 'portLabel')) {
      const { n, dir } = wallFrame(socketOf.get(box.ref)!.wall!)
      for (const c of corners(box)) expect(Math.abs(dot(c, dir))).toBeLessThanOrEqual(dot(c, n) * tan30 - 8 / COS30 + 1e-6)
    }
  })

  it('centres a run of seats on the ports they serve, the wall midpoint when they serve none', () => {
    const m = layoutDiagram(BY_COLUMN)
    const { dir } = wallFrame('sw')
    const us = m.nodes.filter((u) => u.kind === 'useCase' && u.wall === 'sw').map((u) => dot(u, dir))
    expect(us).toHaveLength(3)
    expect(us.reduce((a, b) => a + b, 0) / us.length).toBeCloseTo(0, 6)
  })

  it('treats an explicit top placement as no placement', () => {
    const top = { ...STRESS_DIAGRAM, useCases: STRESS_DIAGRAM.useCases.map((u) => ({ ...u, placement: 'top' as const })) }
    const none = { ...STRESS_DIAGRAM, useCases: STRESS_DIAGRAM.useCases.map(({ placement: _, ...u }) => u) }
    expect(layoutDiagram(top)).toEqual(layoutDiagram(none))
  })
})

describe('sector clearance binds without use cases', () => {
  // Lower walls only, and no use cases: no title or bus to clash with, so the sector rule is what sizes the ring.
  const d: Diagram = {
    version: 1,
    kind: 'hexagonal',
    title: '',
    domain: [],
    useCases: [],
    ports: ['se', 'sw'].flatMap((wall, i) => [
      { id: `p${i}a`, name: `LongPortName${i}A`, side: wall.endsWith('w') ? ('driving' as const) : ('driven' as const), wall: wall as 'ne' },
      { id: `p${i}b`, name: `LongPortName${i}B`, side: wall.endsWith('w') ? ('driving' as const) : ('driven' as const), wall: wall as 'ne' },
    ]),
    adapters: [0, 1].flatMap((i) => [
      { id: `a${i}a`, name: `AVeryLongAdapterName${i}A`, portId: `p${i}a` },
      { id: `a${i}b`, name: `AVeryLongAdapterName${i}B`, portId: `p${i}b` },
    ]),
    actors: [],
    externals: [],
  }
  const model = layoutDiagram(d)
  const tan30 = Math.tan(Math.PI / 6)
  const walled = model.nodes.filter((n) => n.wall)

  it('keeps every wall box at least 8 units clear of the spokes, and some box within 2 units of that limit', () => {
    let tightest = Infinity
    for (const box of walled) {
      const { n, dir } = wallFrame(box.wall!)
      for (const c of corners(box)) {
        const clearance = (dot(c, n) * tan30 - Math.abs(dot(c, dir))) * Math.cos(Math.PI / 6)
        expect(clearance).toBeGreaterThanOrEqual(8 - 1e-6)
        tightest = Math.min(tightest, clearance)
      }
    }
    expect(tightest).toBeLessThan(10)
  })
})

describe('layoutDiagram growth (stress example)', () => {
  const model = layoutDiagram(STRESS_DIAGRAM)
  const domainRing = model.rings[model.rings.length - 1]
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

  it('flows a long domain tree into two columns', () => {
    expect(new Set(items.map((n) => n.x)).size).toBe(2)
  })

  it('never separates a parent from its children', () => {
    for (const item of STRESS_DIAGRAM.domain) {
      expect(find(model, 'domainItem', item.id).x).toBe(find(model, 'domainItem', rootOf(item.id)).x)
    }
  })

  it('keeps the two columns apart', () => {
    for (const kind of ['domainItem', 'portDecl'] as const) {
      const nodes = model.nodes.filter((n) => n.kind === kind)
      const [leftCol, rightCol] = [nodes.filter((n) => n.x < 0), nodes.filter((n) => n.x > 0)]
      expect(leftCol.length).toBeGreaterThan(0)
      expect(rightCol.length).toBeGreaterThan(0)
      expect(Math.max(...leftCol.map(right))).toBeLessThan(Math.min(...rightCol.map(left)))
    }
  })

  it('still hugs the domain ring to its content', () => {
    const content = model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind))
    const slack = Math.min(...content.flatMap(corners).map((c) => halfWidth(model.shape, domainRing, c.y) - Math.abs(c.x)))
    expect(slack).toBeGreaterThanOrEqual(-1e-6)
    expect(slack).toBeLessThanOrEqual(24 + 1e-6)
  })

  it('sizes the domain ring to its content: shrunk, with its content re-seated under the new top, a box sticks out', () => {
    // The body hangs from the title, so it moves down with the top; only a ring that is really too big survives.
    const shrunk = shrink(model.shape, domainRing, 2 * PADDING)
    const drop = domainRing.apex - shrunk.apex
    const content = model.nodes.filter((n) => DOMAIN_BLOCK.has(n.kind)).map((n) => ({ ...n, y: n.y + drop }))
    expect(content.some((n) => corners(n).some((c) => !inside(model, shrunk, c)))).toBe(true)
  })

  it('routes every edge (axis-aligned, or along a wall normal) without crossing a box it does not connect', () => {
    for (const e of model.edges) {
      const allowed = new Set(endpointsOf(e.key))
      const others = model.nodes.filter((n) => !allowed.has(n.key))
      for (const seg of segments(e.points)) {
        const deg = (Math.atan2(seg[1].y - seg[0].y, seg[1].x - seg[0].x) * 180) / Math.PI
        const slanted = [60, 120, -60, -120, ...(e.kind === 'wiring' ? [30, 150, -30, -150] : [])].some((t) => Math.abs(deg - t) < 1e-6)
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
  it('stacks a multi-adapter port band so the socket spans its adapters', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      adapters: [...EXAMPLE_DIAGRAM.adapters, { id: 'a-cli', name: 'feedback.cli', portId: 'p-submit' }],
    }
    const m = layoutDiagram(d)
    const socket = find(m, 'port', 'p-submit')
    const ys = ['a-http', 'a-cli'].map((id) => find(m, 'adapter', id).y)
    expect(socket.y).toBeCloseTo((ys[0] + ys[1]) / 2, 6)
    for (const y of ys) {
      expect(y).toBeGreaterThan(top(socket))
      expect(y).toBeLessThan(bottom(socket))
    }
  })

  it('renders unassigned adapters, actors and externals below the assigned ones in their column', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      adapters: [...EXAMPLE_DIAGRAM.adapters, { id: 'a-loose', name: 'LooseAdapter' }],
      actors: [...EXAMPLE_DIAGRAM.actors, { id: 'act-loose', name: 'Cron' }],
      externals: [...EXAMPLE_DIAGRAM.externals, { id: 'ext-loose', name: 'S3' }],
    }
    const m = layoutDiagram(d)
    const lowest = (kind: LayoutNode['kind'], ids: string[]) => Math.max(...ids.map((id) => find(m, kind, id).y))
    expect(find(m, 'adapter', 'a-loose').y).toBeGreaterThan(lowest('adapter', ['a-http']))
    expect(find(m, 'adapter', 'a-loose').x).toBeLessThan(0)
    expect(find(m, 'actor', 'act-loose').y).toBeGreaterThan(lowest('actor', ['act-frontend']))
    expect(find(m, 'external', 'ext-loose').y).toBeGreaterThan(lowest('external', ['ext-pg', 'ext-mailgun', 'ext-legacy']))
  })

  it('treats an actor linked to a driven adapter as unassigned instead of crossing the diagram', () => {
    const d: Diagram = { ...EXAMPLE_DIAGRAM, actors: [{ id: 'act-x', name: 'Odd', adapterId: 'a-knex' }] }
    const m = layoutDiagram(d)
    expect(find(m, 'actor', 'act-x').x).toBeLessThan(0)
    expect(m.edges.some((e) => e.key === 'actor:act-x->adapter:a-knex')).toBe(false)
  })

  it('lists childless domain services after the entity tree', () => {
    const d: Diagram = {
      ...EXAMPLE_DIAGRAM,
      domain: [{ id: 'd-policy', name: 'RatingPolicy', type: 'domainService' }, ...EXAMPLE_DIAGRAM.domain],
    }
    const m = layoutDiagram(d)
    const service = find(m, 'domainItem', 'd-policy')
    for (const id of ['d-feedback', 'd-rating', 'd-email']) expect(service.y).toBeGreaterThan(find(m, 'domainItem', id).y)
  })

  it('lays out an empty diagram with finite geometry', () => {
    const empty: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
    const m = layoutDiagram(empty)
    expect(m.nodes).toEqual([])
    expect(Object.values(m.bounds).every(Number.isFinite)).toBe(true)
    expect(m.rings.every((r) => r.halfWidth > 0 && r.apex > 0)).toBe(true)
  })
})
