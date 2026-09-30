import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseHexa } from '../model/hexa'
import type { CleanFile, OnionFile } from '../model/schema'
import { layoutClean, type CleanLayoutModel } from '../layout/clean'
import { layoutOnion } from '../layout/onion'
import { ringedElementHeight, ringedElementWidth, titleHalfSpan, TITLE_ARC_PAD, TITLE_LINE } from '../layout/ringedMetrics'
import { ringElementRadius } from '../layout/ringOutlines'
import { measure, RING_LABEL, RING_SUBTITLE } from '../layout/text'
import { RingedEdge } from '../render/RingedNodes'

const FILES = ['onion', 'clean'].flatMap((kind) => ['basic', 'advanced', 'stress'].map((level) => `${kind}-${level}.hexa`))

interface Pt {
  x: number
  y: number
}
interface Rect extends Pt {
  width: number
  height: number
}
/** A curved label's painted region: the annulus `radius ± TITLE_LINE/2` over `centerAngle ± halfSpan`. */
interface Footprint {
  name: string
  radius: number
  centerAngle: number
  halfSpan: number
}

const load = (file: string) => {
  const parsed = parseHexa(readFileSync(path.join(__dirname, file), 'utf-8'))
  if (!parsed.ok) throw new Error(`"${file}" failed to parse`)
  return parsed.map.kind === 'onion' ? layoutOnion(parsed.map as OnionFile) : layoutClean(parsed.map as CleanFile)
}

function footprints(model: ReturnType<typeof load>): Footprint[] {
  const ring = model.rings.flatMap((r, i) => {
    const radius = ringElementRadius(r, model.rings[i - 1])
    return [{ name: `ring title "${r.title}"`, radius, centerAngle: -Math.PI / 2, halfSpan: Math.min(titleHalfSpan(measure(r.title, RING_LABEL) + 2 * TITLE_ARC_PAD, radius), measure(r.title, RING_LABEL) / 2 / radius) }]
  })
  const sectors = 'sectors' in model ? (model as CleanLayoutModel).sectors : []
  const sector = sectors.map((s) => {
    const i = model.rings.findIndex((r) => r.role === s.ringRole)
    const radius = ringElementRadius(model.rings[i], model.rings[i - 1])
    const centerAngle = (s.startAngle + s.endAngle) / 2
    const wedgeHalfSpan = Math.max(0, (s.endAngle - s.startAngle) / 2 - TITLE_ARC_PAD / Math.max(radius, 1))
    return { name: `sector name "${s.name}"`, radius, centerAngle, halfSpan: Math.min(wedgeHalfSpan, measure(s.name, RING_SUBTITLE) / 2 / radius) }
  })
  return [...ring, ...sector]
}

const insideFootprint = (p: Pt, f: Footprint): boolean => {
  const r = Math.hypot(p.x, p.y)
  if (Math.abs(r - f.radius) > TITLE_LINE / 2) return false
  let d = Math.atan2(p.y, p.x) - f.centerAngle
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return Math.abs(d) <= f.halfSpan
}

const insideRect = (p: Pt, b: Rect): boolean => Math.abs(p.x - b.x) <= b.width / 2 && Math.abs(p.y - b.y) <= b.height / 2

/** Every point along the arc a box's own rect could cover — sampled, never trusting `arcLabelFootprintBox`,
 * which is what the sizing search itself is built on. */
function boxTouches(box: Rect, f: Footprint): boolean {
  const STEPS = 400
  for (let i = 0; i <= STEPS; i++) {
    const angle = f.centerAngle - f.halfSpan + (2 * f.halfSpan * i) / STEPS
    for (const r of [f.radius - TITLE_LINE / 2, f.radius, f.radius + TITLE_LINE / 2]) {
      if (insideRect({ x: r * Math.cos(angle), y: r * Math.sin(angle) }, box)) return true
    }
  }
  return false
}

function quadraticSamples(from: Pt, to: Pt, control: Pt): Pt[] {
  const STEPS = 400
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = i / STEPS
    const u = 1 - t
    return { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y }
  })
}

/** Detailed draws each edge as a quadratic bowed through the layout's own control point. */
const detailedSamples = (edge: { from: Pt; to: Pt; control: Pt }): Pt[] => quadraticSamples(edge.from, edge.to, edge.control)

/** Overview draws what `RingedEdge` paints by default; its `d` is parsed back (`M x yL x y`, or `M x yQ cx cy x y`)
 * so a change to how it draws an edge can't slip past this test. A straight chord is its own midpoint's quadratic. */
function overviewSamples(edge: { from: Pt; to: Pt; control: Pt }): Pt[] {
  const markup = renderToStaticMarkup(createElement('svg', null, createElement(RingedEdge, { edge: { key: 'e', kind: 'dependency', ...edge }, markerId: 'a' })))
  const nums = [.../ d="([^"]+)"/.exec(markup)![1].matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) => Number(m[0]))
  const control = nums.length === 6 ? { x: nums[2], y: nums[3] } : { x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2 }
  return quadraticSamples(edge.from, edge.to, control)
}

describe('at fit, no ring title or sector name is touched by a box or an edge (Onion/Clean examples)', () => {
  for (const file of FILES) {
    describe(file, () => {
      const model = load(file)
      const labels = footprints(model)
      const boxes = model.elements.map((e) => ({ name: e.name, x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }))

      it('no element box touches a title or sector name', () => {
        const hits = labels.flatMap((f) => boxes.filter((b) => boxTouches(b, f)).map((b) => `${f.name} × box "${b.name}"`))
        expect(hits).toEqual([])
      })

      for (const [view, sample] of [['Detailed, the default view', detailedSamples], ['Overview', overviewSamples]] as const) {
        it(`no edge crosses a title or sector name (${view})`, () => {
          const hits = model.edges.flatMap((edge) => {
            const samples = sample(edge).filter((p) => !boxes.some((b) => insideRect(p, b)))
            return labels.filter((f) => samples.some((p) => insideFootprint(p, f))).map((f) => `${f.name} × edge ${edge.fromRef} → ${edge.toRef}`)
          })
          expect(hits).toEqual([])
        })
      }
    })
  }
})
