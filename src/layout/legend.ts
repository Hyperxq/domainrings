import { HEXAGONAL_KIND } from '../model/kinds'
import type { CleanFile, Diagram, LayerRole, OnionFile } from '../model/schema'
import { threadSlots } from '../model/threads'
import { LINE_METRICS, measure } from './text'

export type Swatch = LayerRole | 'driving' | 'driven' | 'external' | 'element'

/** One use case's thread as the export legend lists it: its name and the palette slot its dot draws with. */
export interface LegendThread {
  name: string
  slot: number
}

export interface LegendModel {
  colours: { label: string; swatch: Swatch }[]
  strokes: { stroke: 'dashed' | 'solid' | 'dotted'; label: string }[]
  /** Only the element types this diagram actually uses. */
  tags: string[]
  /** Overrides `legendSections`' default per-section heading — set only where the default wording ("Glyph ·
   * type") wouldn't fit what a section actually lists (Clean's sector wedges are not a glyph/type). */
  sectionTitles?: { colours?: string; strokes?: string; tags?: string }
  /** Hexagonal only, and only with use cases: the threads key drawn under the other sections of an export. */
  threads?: LegendThread[]
}

export const THREADS_TITLE = 'Threads'

/** One row per use case, in `threadSlots` order. */
export function legendThreads(d: Pick<Diagram, 'useCases'>): LegendThread[] {
  const slots = threadSlots(d)
  return d.useCases.map((u) => ({ name: u.name || 'Unnamed', slot: slots.get(u.id)! }))
}

/** Hexagonal's export legend: its layers, then one thread per use case. Strokes and glyphs are not explained. */
export function legendFor(d: Diagram): LegendModel {
  return {
    colours: HEXAGONAL_KIND.rings.map((r) => ({ label: d.layers?.[r.role]?.title?.trim() || r.name, swatch: r.role })),
    strokes: [],
    tags: [],
    sectionTitles: { colours: 'Layers' },
    ...(d.useCases.length ? { threads: legendThreads(d) } : {}),
  }
}

/** Onion and Clean have no ports or adapters (ADR-01): their legend only ever describes their own rings, their
 * elements, actors, external systems, and the dependency arrow — plus, for Clean alone, its sector wedges. Shared
 * by both kinds rather than forked, since the two only ever differ in whether sectors exist at all. */
function legendForRinged(rings: readonly { role: string; name: string }[], hasSectors: boolean): LegendModel {
  return {
    colours: [
      ...rings.map((r) => ({ label: r.name, swatch: r.role as Swatch })),
      { label: 'Element', swatch: 'element' },
      { label: 'Actor', swatch: 'driving' },
      { label: 'External system', swatch: 'driven' },
    ],
    strokes: [{ stroke: 'solid', label: 'Depends on / connects to' }],
    tags: hasSectors ? ['Sector'] : [],
    sectionTitles: hasSectors ? { tags: 'Wedge · division' } : undefined,
  }
}

export const legendForOnion = (doc: OnionFile): LegendModel => legendForRinged(doc.rings, false)
export const legendForClean = (doc: CleanFile): LegendModel => legendForRinged(doc.rings, true)

/** Space between the diagram's bounds and the legend block drawn under them in exports. */
export const LEGEND_GAP = 16
export const LEGEND_ROW = 18
export const LEGEND_HEADING = 22
export const LEGEND_PAD = 12
export const LEGEND_SWATCH = 24

/** The legend's channels in order. One with no rows is left out wherever the legend is drawn. */
export function legendSections(legend: LegendModel) {
  const all = [
    { key: 'colours', title: legend.sectionTitles?.colours ?? 'Colour · layer', rows: legend.colours.length },
    { key: 'strokes', title: legend.sectionTitles?.strokes ?? 'Stroke · role', rows: legend.strokes.length },
    { key: 'tags', title: legend.sectionTitles?.tags ?? 'Glyph · type', rows: legend.tags.length },
  ] as const
  return all.filter((s) => s.rows > 0)
}

/** Size of the legend block drawn into exports. */
export function legendSize(legend: LegendModel) {
  const texts = [...legend.colours.map((c) => c.label), ...legend.strokes.map((s) => s.label)]
  const width =
    Math.max(
      ...texts.map((t) => measure(t, LINE_METRICS.muted) + LEGEND_SWATCH),
      ...legend.tags.map((t) => measure(t, LINE_METRICS.tag)),
      ...(legend.threads ? [measure(THREADS_TITLE, LINE_METRICS.title), ...legend.threads.map((t) => measure(t.name, LINE_METRICS.muted) + LEGEND_SWATCH)] : []),
      ...legendSections(legend).map((s) => measure(s.title, LINE_METRICS.title)),
    ) +
    2 * LEGEND_PAD
  const threads = legend.threads?.length ?? 0
  const rows = legend.colours.length + legend.strokes.length + legend.tags.length + threads
  return { width, height: 2 * LEGEND_PAD + (legendSections(legend).length + (threads ? 1 : 0)) * LEGEND_HEADING + rows * LEGEND_ROW }
}
