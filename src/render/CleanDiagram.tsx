import type { CleanLayoutModel, CleanSectorWedge } from '../layout/clean'
import type { LayoutMode, LayoutRing } from '../layout/layout'
import type { LegendModel } from '../layout/legend'
import { ringElementRadius } from '../layout/ringOutlines'
import { titleHalfSpan, TITLE_ARC_PAD } from '../layout/ringedMetrics'
import { measure, RING_SUBTITLE } from '../layout/text'
import { sectorDividers } from './band'
import { Ring, ringedArcPath } from './Ring'
import { SvgLegend } from './SvgLegend'
import { RingedEdge, ringedVisibleEdges, RingedElementNode, RingedEndpointNode } from './RingedNodes'

interface CleanDiagramProps {
  model: CleanLayoutModel
  /** The selected element/endpoint ref, for the "start a dependency/connect an endpoint" gesture (CleanStage). */
  selected: string | null
  /** False for a canvas that only previews the diagram — mirrors Onion's own Node contract. */
  interactive: boolean
  /** While linking (CleanStage), the element refs a dependency from the selection may legally target (REQ-06). */
  validTargets: ReadonlySet<string>
  /** Drawn hidden on the canvas, shown only in exports (`SvgLegend`, shared with Hexagonal) — "Include legend in
   * export" works for Clean the same way it already does for Hexagonal. */
  legend: LegendModel
  /** Overview/Detailed toolbar switch (Decision 1): Overview shows only the hovered/selected element's own
   * dependency arrows; Detailed shows every arrow. */
  mode: LayoutMode
  /** The ring/element/endpoint currently hovered or focused (`RingedStage`'s own `RingedHover.ref`) — together
   * with `selected`, decides which edges Overview reveals. */
  hoverRef: string | null
}

/** One radial divider per sector on a ring (REQ-08) — genuinely Clean-only, since Onion has no sector
 * sub-structure to divide a ring into. */
function SectorDividers({ ring, inner, model }: { ring: CleanLayoutModel['rings'][number]; inner?: CleanLayoutModel['rings'][number]; model: CleanLayoutModel }) {
  const boundaries = model.sectors.filter((s) => s.ringRole === ring.role).map((s) => s.startAngle)
  if (!boundaries.length) return null
  return <path className="sector-divider" data-sector-divider={ring.role} d={sectorDividers(ring, inner, boundaries)} />
}

/** A sector's own name (Decision 4), curved along its own wedge's mid-angle at the ring's element radius —
 * reuses the ring title's own curved-arc primitive (`ringedArcPath`, `render/Diagram.tsx`), just centred on the
 * wedge's own mid-angle instead of always the top. Sized to fit within its own wedge span (never the shared
 * `TITLE_MAX_SPAN` a ring title grows the whole ring to guarantee — a narrow sector's label may run past its own
 * wedge for a long name, since nothing here grows the ring to prevent it, unlike the ring title). */
function SectorLabel({ sector, ring, inner, innermost }: { sector: CleanSectorWedge; ring: LayoutRing; inner?: LayoutRing; innermost: boolean }) {
  const radius = ringElementRadius(ring, inner)
  const centerAngle = (sector.startAngle + sector.endAngle) / 2
  const wedgeHalfSpan = Math.max(0, (sector.endAngle - sector.startAngle) / 2 - TITLE_ARC_PAD / Math.max(radius, 1))
  const halfSpan = Math.min(wedgeHalfSpan, titleHalfSpan(measure(sector.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD, radius))
  const arcId = `sector-title-arc-${sector.ref}`
  return (
    <>
      <path id={arcId} d={ringedArcPath(radius, centerAngle, halfSpan)} fill="none" stroke="none" aria-hidden="true" />
      <text className={innermost ? 'sector-label on-domain' : 'sector-label'} data-sector-label={sector.ref} data-layer={ring.role} fontSize={RING_SUBTITLE.size}>
        <textPath href={`#${arcId}`} xlinkHref={`#${arcId}`} startOffset="50%" textAnchor="middle">
          {sector.name}
        </textPath>
      </text>
    </>
  )
}

/** A Clean document's 4 fixed rings (reusing the same `<Ring>` primitive Hexagonal/Onion render with, ADR-01),
 * each ring's own sectors drawn as wedge dividers (REQ-08), its elements spread inside their own sector's wedge,
 * inward-only dependency arrows (REQ-06), and actors/external systems outside the outer ring with a direct arrow
 * to a Frameworks & Drivers element (REQ-07) — node/edge primitives shared with Onion via `RingedNodes.tsx`. */
export function CleanDiagram({ model, selected, interactive, validTargets, legend, mode, hoverRef }: CleanDiagramProps) {
  const activeRefs = new Set([hoverRef, selected].filter((r): r is string => r !== null))
  return (
    <>
      <defs>
        <marker id="clean-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head" d="M0 0L10 5L0 10z" />
        </marker>
      </defs>
      {model.rings.map((ring, i) => (
        <Ring key={ring.key} ring={ring} shape="circle" inner={model.rings[i - 1]} interactive={interactive} />
      ))}
      {model.rings.map((ring, i) => (
        <SectorDividers key={`dividers:${ring.key}`} ring={ring} inner={model.rings[i - 1]} model={model} />
      ))}
      {model.sectors.map((sector) => {
        const ringIndex = model.rings.findIndex((r) => r.role === sector.ringRole)
        return <SectorLabel key={`label:${sector.key}`} sector={sector} ring={model.rings[ringIndex]} inner={model.rings[ringIndex - 1]} innermost={ringIndex === 0} />
      })}
      {ringedVisibleEdges(model.edges, mode, activeRefs).map((edge) => (
        <RingedEdge key={edge.key} edge={edge} markerId="clean-arrow" />
      ))}
      {model.elements.map((element) => (
        <RingedElementNode key={element.key} element={element} selected={element.ref === selected} target={validTargets.has(element.ref)} interactive={interactive} />
      ))}
      {model.endpoints.map((endpoint) => (
        <RingedEndpointNode key={endpoint.key} endpoint={endpoint} selected={endpoint.ref === selected} interactive={interactive} />
      ))}
      <SvgLegend legend={legend} bounds={model.bounds} />
    </>
  )
}
