import { KINDS } from '../model/kinds'
import type { Diagram, LayerRole } from '../model/schema'
import { adapterTag, DOMAIN_TAGS, portTag, USE_CASE_TAG } from './tags'
import { LINE_METRICS, measure } from './text'

export type Swatch = LayerRole | 'driving' | 'driven' | 'external'

export interface LegendModel {
  colours: { label: string; swatch: Swatch }[]
  strokes: { stroke: 'dashed' | 'solid' | 'dotted'; label: string }[]
  /** Only the element types this diagram actually uses. */
  tags: string[]
}

export function legendFor(d: Diagram): LegendModel {
  const { rings, labels } = KINDS[d.kind]
  const sideOfAdapter = (portId?: string) => d.ports.find((p) => p.id === portId)?.side ?? 'driving'
  const present = [
    ...(['aggregate', 'entity', 'valueObject', 'domainService'] as const).filter((t) => d.domain.some((i) => i.type === t)).map((t) => DOMAIN_TAGS[t]),
    ...(d.useCases.length ? [USE_CASE_TAG] : []),
    ...(['driving', 'driven'] as const).filter((s) => d.ports.some((p) => p.side === s)).map((s) => portTag(s, labels)),
    ...(['driving', 'driven'] as const).filter((s) => d.adapters.some((a) => sideOfAdapter(a.portId) === s)).map((s) => adapterTag(s, labels)),
  ]
  return {
    colours: [
      ...rings.map((r) => ({ label: d.layers?.[r.role]?.title?.trim() || r.name, swatch: r.role })),
      { label: 'Driving side', swatch: 'driving' },
      { label: 'Driven side', swatch: 'driven' },
      { label: 'External systems', swatch: 'external' },
    ],
    strokes: [
      { stroke: 'dashed', label: 'Contract: port' },
      { stroke: 'solid', label: 'Implementation: adapter, use case' },
      { stroke: 'dotted', label: 'Wiring and ownership' },
    ],
    tags: present,
  }
}

/** Space between the diagram's bounds and the legend block drawn under them in exports. */
export const LEGEND_GAP = 16
export const LEGEND_ROW = 18
export const LEGEND_HEADING = 22
export const LEGEND_PAD = 12
export const LEGEND_SWATCH = 24
export const LEGEND_SECTIONS = ['Colour = layer', 'Stroke = role', 'Glyph = type'] as const

/** Size of the legend block drawn into exports. */
export function legendSize(legend: LegendModel) {
  const texts = [...legend.colours.map((c) => c.label), ...legend.strokes.map((s) => s.label)]
  const width =
    Math.max(
      ...texts.map((t) => measure(t, LINE_METRICS.muted) + LEGEND_SWATCH),
      ...legend.tags.map((t) => measure(t, LINE_METRICS.tag)),
      ...LEGEND_SECTIONS.map((t) => measure(t, LINE_METRICS.title)),
    ) +
    2 * LEGEND_PAD
  const rows = legend.colours.length + legend.strokes.length + legend.tags.length
  return { width, height: 2 * LEGEND_PAD + LEGEND_SECTIONS.length * LEGEND_HEADING + rows * LEGEND_ROW }
}
