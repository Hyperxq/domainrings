import type { LayoutMode, Point } from '../layout/layout'
import { edgeControl } from '../layout/edgeRouting'
import { endpointLabelHeight, endpointLines, RINGED_ELEMENT_METRICS, RINGED_ENDPOINT_DIAMETER, ringedElementHeight, ringedElementLines, ringedElementWidth } from '../layout/ringed'

const ENDPOINT_RADIUS = RINGED_ENDPOINT_DIAMETER / 2

/** What every "ringed" document kind (Onion, Clean — ADR-01) lays an element out as: its own ring role (Onion: a
 * direct field; Clean: resolved through its sector, ADR-02) is already flattened in by the layout step, so these
 * primitives never need to know which kind they're drawing for. */
export interface RingedElementLayout {
  key: string
  ref: string
  ringRole: string
  name: string
  x: number
  y: number
}

export interface RingedEndpointLayout {
  key: string
  ref: string
  kind: 'actor' | 'external'
  name: string
  x: number
  y: number
}

export interface RingedEdgeLayout {
  key: string
  kind: 'dependency' | 'endpoint'
  from: Point
  to: Point
  control?: Point
}

/** Decision 1 (Overview/Detailed toolbar switch, shared by Onion and Clean — ADR-01): Detailed draws every edge;
 * Overview draws only the ones touching the hovered or selected element (`activeRefs`), and none at all while
 * nothing is hovered/selected/focused — keyboard focus counts as hover since `RingedStage` reveals on both. */
export function ringedVisibleEdges<E extends { fromRef: string; toRef: string }>(edges: readonly E[], mode: LayoutMode, activeRefs: ReadonlySet<string>): readonly E[] {
  if (mode !== 'overview') return edges
  if (activeRefs.size === 0) return []
  return edges.filter((e) => activeRefs.has(e.fromRef) || activeRefs.has(e.toRef))
}

/** Detailed view bows each arrow's chord instead of drawing it straight: all at once, straight chords through the
 * centre overlap into an unreadable knot, and curving each one spreads them into distinguishable arcs. The layout
 * picks the control point (`routeEdgesAroundLabels`) so the bow also stays off every curved label. */
function edgePath(from: Point, to: Point, curved: boolean, control: Point | undefined): string {
  if (!curved) return `M${from.x} ${from.y}L${to.x} ${to.y}`
  const c = control ?? edgeControl(from, to)
  return `M${from.x} ${from.y}Q${c.x} ${c.y} ${to.x} ${to.y}`
}

/** The marker id is the caller's own `<defs>` concern, since Onion's and Clean's own diagrams each declare their
 * own arrow marker. `curved` follows the Overview/Detailed toolbar switch (Decision 1): straight chords for the
 * few edges Overview ever shows at once, curved for Detailed's every-edge view. */
export function RingedEdge({ edge, markerId, curved = false }: { edge: RingedEdgeLayout; markerId: string; curved?: boolean }) {
  return <path className="edge edge-import" markerEnd={`url(#${markerId})`} d={edgePath(edge.from, edge.to, curved, edge.control)} />
}

/** A (possibly wrapped, Decision 8) name's own lines, stacked as `<tspan>`s evenly sharing `height` and vertically
 * centred on `centerY` — shared by an element's own box (centred at `x`) and an endpoint's own label (`x` beside
 * its dot), the one place either ever turns `lines` into rendered rows. */
function WrappedLines({ lines, x, centerY, height }: { lines: string[]; x: number; centerY: number; height: number }) {
  const rowHeight = height / lines.length
  return (
    <>
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={centerY - height / 2 + (i + 0.5) * rowHeight} dominantBaseline="middle">
          {line}
        </tspan>
      ))}
    </>
  )
}

export function RingedElementNode({ element, selected, target, interactive }: { element: RingedElementLayout; selected: boolean; target: boolean; interactive: boolean }) {
  const width = ringedElementWidth(element.name)
  const height = ringedElementHeight(element.name)
  // A long name wraps onto more than one line (Decision 8) rather than growing its own ring around one unbroken
  // line — each row gets an even share of the box's own (possibly grown) height, so a single-line name renders
  // exactly as before (one row = the whole box, vertically centred, unchanged from before Decision 8).
  const lines = ringedElementLines(element.name)
  return (
    <g
      className="node node-ringedElement tone-teal"
      data-ref={element.ref}
      data-layer={element.ringRole}
      data-selected={selected ? '' : undefined}
      data-link-target={target ? '' : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `${element.name} (${element.ringRole})` : undefined}
    >
      <rect className="box" x={element.x - width / 2} y={element.y - height / 2} width={width} height={height} rx={8} />
      <text className="centered" x={element.x} fontSize={RINGED_ELEMENT_METRICS.size}>
        <WrappedLines lines={lines} x={element.x} centerY={element.y} height={height} />
      </text>
    </g>
  )
}

export function RingedEndpointNode({ endpoint, selected, interactive }: { endpoint: RingedEndpointLayout; selected: boolean; interactive: boolean }) {
  const labelSide = endpoint.x >= 0 ? 1 : -1
  // A long name wraps (Decision 8) rather than reaching further outward on one unbroken line — same idiom as a
  // ringed element's own box, just stacked beside the dot instead of centred inside a box.
  const lines = endpointLines(endpoint.name)
  const height = endpointLabelHeight(endpoint.name)
  const labelX = endpoint.x + labelSide * (ENDPOINT_RADIUS + 4)
  return (
    <g
      className={`node node-ringedEndpoint tone-${endpoint.kind === 'actor' ? 'driving' : 'driven'}`}
      data-ref={endpoint.ref}
      data-selected={selected ? '' : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `${endpoint.kind === 'actor' ? 'Actor' : 'External system'} ${endpoint.name}` : undefined}
    >
      <circle className="box" cx={endpoint.x} cy={endpoint.y} r={ENDPOINT_RADIUS} />
      <text className={labelSide > 0 ? undefined : 'end'} x={labelX} fontSize={RINGED_ELEMENT_METRICS.size}>
        <WrappedLines lines={lines} x={labelX} centerY={endpoint.y} height={height} />
      </text>
    </g>
  )
}
