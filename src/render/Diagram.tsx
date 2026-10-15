import { memo } from 'react'
import type { Chain } from '../model/chain'
import { hexagonBounds } from '../layout/lattice'
import { currentHexagon, hexagonTitle, type MapContextLayout, type MapLayout } from '../layout/map'
import type { Point } from '../layout/geometry'
import type { LegendModel } from '../layout/legend'
import { EDGE_LABEL, TITLE } from '../layout/text'
import { CompactBody, HexagonBody, HexCue, orthogonalPath } from './HexagonBody'
import { SvgLegend } from './SvgLegend'
import { threadStyle } from './ThreadDots'

function Defs({ slots }: { slots: number[] }) {
  return (
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path className="arrow-head" d="M0 0L10 5L0 10z" />
      </marker>
      <marker id="arrow-on-domain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path className="arrow-head on-domain" d="M0 0L10 5L0 10z" />
      </marker>
      {slots.map((slot) => (
        <marker key={slot} id={`arrow-thread-${slot}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head" style={{ fill: `var(--thread-${slot})` }} d="M0 0L10 5L0 10z" />
        </marker>
      ))}
    </defs>
  )
}

const NO_TARGETS = new Set<string>()

/** The thread slots some edge is drawn in, each of which needs an arrowhead of its colour. */
const threadSlotsDrawn = (map: MapLayout) => [...new Set([...map.hexagons.flatMap((h) => h.model.edges.flatMap((e) => (e.thread ? [e.thread.slot] : []))), ...map.links.flatMap((l) => (l.slot === undefined ? [] : [l.slot]))])].sort((a, b) => a - b)

/** One `M...Z` subpath per loop — several loops in one `<path>` drawn `fill-rule="evenodd"` is exactly how a
 * split context or a hole around a foreign hexagon is meant to paint (ADR-04). */
export function hullPath(loops: Point[][]): string {
  return loops.map((loop) => `M${loop.map((p) => `${p.x} ${p.y}`).join('L')}Z`).join(' ')
}

/** One outlined region per context (CB-01, CB-02), or the lone context's nameless outline — inert, painted below every hexagon group. */
function Hulls({ contexts, outline }: { contexts: MapContextLayout[]; outline?: Point[][] }) {
  if (outline) return <path className="hull" data-outline="" aria-hidden="true" fillRule="evenodd" d={hullPath(outline)} />
  if (!contexts.length) return null
  return (
    <g data-hulls="" aria-hidden="true">
      {contexts.map((c) => (
        <path key={c.id} className="hull" data-hull={c.id} fillRule="evenodd" d={hullPath(c.loops)} />
      ))}
    </g>
  )
}

/** One name/placeholder chip per context (CB-01, CB-03) — inert, painted above every hexagon group and link. */
function Chips({ contexts }: { contexts: MapContextLayout[] }) {
  return (
    <>
      {contexts.map((c) => (
        <text key={c.id} className="chip" data-chip={c.id} aria-hidden="true" x={c.chip.x} y={c.chip.y} fontSize={c.size}>
          {c.label}
        </text>
      ))}
    </>
  )
}

interface MapDiagramProps {
  map: MapLayout
  legend: LegendModel
  showGuides: boolean
  /** The current hexagon's id — the only one rendered as editable; every other hexagon is one click-to-focus control. */
  focus: string
  selected: string | null
  /** In link mode, the refs the selection can be linked to. */
  linkTargets: ReadonlySet<string>
  /** In link mode, valid cross-hexagon port targets on hexagons OTHER than the current one, keyed by hexagon id
   * (decision 7387) — a port id alone is not enough, since ids collide across hexagons by construction. */
  crossLinkTargets: ReadonlyMap<string, ReadonlySet<string>>
  /** The hovered layer, scoped to the current hexagon only (CANVAS-03). */
  hovered: string | null
  /** The emphasized dependency chain of the selection; everything outside it dims (styles.css). */
  chain?: Chain
  /** Each hexagon's notes by ref (`notesOf`); a noted box wears a marker. */
  notes: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** Each hexagon's planned refs (`plannedOf`); a planned box is dashed and faded. */
  planned: ReadonlyMap<string, ReadonlySet<string>>
}

/** Composes every hexagon of a map into one SVG: one `<defs>`, one `<g data-hex>` per hexagon, the map's links
 * drawn above them, an optional map title, and the legend once — under the current hexagon. */
export const MapDiagram = memo(function MapDiagram({ map, legend, showGuides, focus, selected, linkTargets, crossLinkTargets, hovered, chain, notes, planned }: MapDiagramProps) {
  const current = currentHexagon(map, focus)
  return (
    <>
      <Defs slots={threadSlotsDrawn(map)} />
      <Hulls contexts={map.contexts} outline={map.outline} />
      {map.hexagons.map((hex) => {
        const isCurrent = hex.id === focus
        const title = hexagonTitle(hex.model)
        const chained = chain?.elements.get(hex.id)
        return (
          <g
            key={hex.id}
            className={hex.planned ? 'planned' : undefined}
            data-hex={hex.id}
            transform={`translate(${hex.centre.x} ${hex.centre.y})`}
            aria-current={isCurrent ? 'true' : undefined}
            role={isCurrent ? 'group' : 'button'}
            tabIndex={isCurrent ? undefined : 0}
            aria-label={isCurrent ? title : `Make ${title} the current hexagon`}
            data-hover={isCurrent && hovered ? hovered : undefined}
            data-chain={chained ? '' : undefined}
          >
            {!isCurrent && <title>{title}</title>}
            {hex.compact ? (
              <CompactBody compact={hex.compact} title={title} linkTargets={crossLinkTargets.get(hex.id) ?? NO_TARGETS} chain={chained} />
            ) : (
              <HexagonBody
                model={hex.model}
                showGuides={showGuides}
                selected={isCurrent ? selected : null}
                linkTargets={isCurrent ? linkTargets : (crossLinkTargets.get(hex.id) ?? NO_TARGETS)}
                chain={chained}
                interactive={isCurrent}
                notes={notes.get(hex.id)!}
                planned={planned.get(hex.id)!}
              />
            )}
            {isCurrent && map.hexagons.length > 1 && <HexCue model={hex.model} />}
          </g>
        )
      })}
      {map.links.map((link) => (
        <path key={link.id} className={link.planned ? 'map-link planned' : 'map-link'} data-map-link="" data-chain={chain?.links.has(link.id) ? '' : undefined} aria-hidden="true" d={orthogonalPath(link.points)} markerEnd={link.slot === undefined ? 'url(#arrow)' : `url(#arrow-thread-${link.slot})`} {...(link.slot === undefined ? {} : { 'data-thread': '', style: threadStyle(link.slot) })} />
      ))}
      {map.links.map(
        (link) =>
          link.pattern &&
          link.label && (
            <text
              key={link.id}
              className="link-pattern-label"
              data-link-pattern=""
              aria-hidden="true"
              x={link.label.at.x}
              y={link.label.at.y}
              transform={link.label.vertical ? `rotate(-90 ${link.label.at.x} ${link.label.at.y})` : undefined}
              fontSize={EDGE_LABEL.size}
            >
              {link.pattern}
            </text>
          ),
      )}
      <Chips contexts={map.contexts} />
      {map.title && <text data-map-title="" className="diagram-title" x={map.title.x} y={map.title.y} fontSize={map.title.size ?? TITLE.size}>{map.title.text}</text>}
      <SvgLegend legend={legend} bounds={hexagonBounds(current)} />
    </>
  )
})



