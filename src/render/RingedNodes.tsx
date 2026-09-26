import type { LayoutMode, Point } from '../layout/layout'
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
}

/** Decision 1 (Overview/Detailed toolbar switch, shared by Onion and Clean — ADR-01): Detailed draws every edge;
 * Overview draws only the ones touching the hovered or selected element (`activeRefs`), and none at all while
 * nothing is hovered/selected/focused — keyboard focus counts as hover since `RingedStage` reveals on both. */
export function ringedVisibleEdges<E extends { fromRef: string; toRef: string }>(edges: readonly E[], mode: LayoutMode, activeRefs: ReadonlySet<string>): readonly E[] {
  if (mode !== 'overview') return edges
  if (activeRefs.size === 0) return []
  return edges.filter((e) => activeRefs.has(e.fromRef) || activeRefs.has(e.toRef))
}

/** Bows a dependency arrow's chord away from the diagram's own centre (Decision 1, Detailed view): drawn all at
 * once, straight chords through the centre overlap into an unreadable knot — curving each one outward by a
 * fraction of its own length spreads them into distinguishable arcs, the same "bow away from the pole" idiom
 * chord diagrams use. The bow itself must move PERPENDICULAR to the chord, never straight "away from the origin":
 * a chord collinear with the centre (both ends roughly on the same line through it, e.g. two outer-ring elements
 * near-opposite each other with one inner element between them) has its own "away from the origin" direction
 * running PARALLEL to the chord — nudging the control point along the chord itself leaves the curve exactly
 * straight regardless of how big `bow` is (the reported edge running dead straight through the whole diagram).
 * Picking the chord's own perpendicular, oriented toward the origin's own "outward" side when that's known (so
 * every ordinary edge keeps bowing the same way as before) and falling back to either perpendicular when the
 * chord passes exactly through the origin, always produces a visible curve. */
function edgePath(from: Point, to: Point, curved: boolean): string {
  if (!curved) return `M${from.x} ${from.y}L${to.x} ${to.y}`
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const chordLength = Math.hypot(to.x - from.x, to.y - from.y)
  const bow = chordLength * 0.18
  const perp = chordLength > 1e-6 ? { x: -(to.y - from.y) / chordLength, y: (to.x - from.x) / chordLength } : { x: 0, y: 0 }
  const centreDist = Math.hypot(mid.x, mid.y)
  const outward = centreDist > 1e-6 ? { x: mid.x / centreDist, y: mid.y / centreDist } : perp
  const side = Math.sign(perp.x * outward.x + perp.y * outward.y) || 1
  const control = { x: mid.x + perp.x * side * bow, y: mid.y + perp.y * side * bow }
  return `M${from.x} ${from.y}Q${control.x} ${control.y} ${to.x} ${to.y}`
}

/** The marker id is the caller's own `<defs>` concern, since Onion's and Clean's own diagrams each declare their
 * own arrow marker. `curved` follows the Overview/Detailed toolbar switch (Decision 1): straight chords for the
 * few edges Overview ever shows at once, curved for Detailed's every-edge view. */
export function RingedEdge({ edge, markerId, curved = false }: { edge: RingedEdgeLayout; markerId: string; curved?: boolean }) {
  return <path className="edge edge-import" markerEnd={`url(#${markerId})`} d={edgePath(edge.from, edge.to, curved)} />
}

export function RingedElementNode({ element, selected, target, interactive }: { element: RingedElementLayout; selected: boolean; target: boolean; interactive: boolean }) {
  const width = ringedElementWidth(element.name)
  const height = ringedElementHeight(element.name)
  // A long name wraps onto more than one line (Decision 8) rather than growing its own ring around one unbroken
  // line — each row gets an even share of the box's own (possibly grown) height, so a single-line name renders
  // exactly as before (one row = the whole box, vertically centred, unchanged from before Decision 8).
  const lines = ringedElementLines(element.name)
  const rowHeight = height / lines.length
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
        {lines.map((line, i) => (
          <tspan key={i} x={element.x} y={element.y - height / 2 + (i + 0.5) * rowHeight} dominantBaseline="middle">
            {line}
          </tspan>
        ))}
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
  const rowHeight = height / lines.length
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
        {lines.map((line, i) => (
          <tspan key={i} x={labelX} y={endpoint.y - height / 2 + (i + 0.5) * rowHeight} dominantBaseline="middle">
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}
