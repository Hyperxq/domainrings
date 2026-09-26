import type { LayoutMode, Point } from '../layout/layout'
import { RINGED_ELEMENT_HEIGHT, RINGED_ELEMENT_METRICS, RINGED_ENDPOINT_DIAMETER, ringedElementWidth } from '../layout/ringed'

const NODE_HEIGHT = RINGED_ELEMENT_HEIGHT
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
 * chord diagrams use. Falls back to a straight line where a chord already starts at the centre (`away` undefined). */
function edgePath(from: Point, to: Point, curved: boolean): string {
  if (!curved) return `M${from.x} ${from.y}L${to.x} ${to.y}`
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const centreDist = Math.hypot(mid.x, mid.y)
  const chordLength = Math.hypot(to.x - from.x, to.y - from.y)
  const bow = chordLength * 0.18
  const away = centreDist > 1e-6 ? { x: mid.x / centreDist, y: mid.y / centreDist } : { x: 0, y: 0 }
  const control = { x: mid.x + away.x * bow, y: mid.y + away.y * bow }
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
      <rect className="box" x={element.x - width / 2} y={element.y - NODE_HEIGHT / 2} width={width} height={NODE_HEIGHT} rx={8} />
      <text className="centered" x={element.x} y={element.y} dominantBaseline="middle" fontSize={RINGED_ELEMENT_METRICS.size}>
        {element.name}
      </text>
    </g>
  )
}

export function RingedEndpointNode({ endpoint, selected, interactive }: { endpoint: RingedEndpointLayout; selected: boolean; interactive: boolean }) {
  const labelSide = endpoint.x >= 0 ? 1 : -1
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
      <text className={labelSide > 0 ? undefined : 'end'} x={endpoint.x + labelSide * (ENDPOINT_RADIUS + 4)} y={endpoint.y} dominantBaseline="middle" fontSize={RINGED_ELEMENT_METRICS.size}>
        {endpoint.name}
      </text>
    </g>
  )
}
