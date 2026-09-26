import type { Point } from '../layout/layout'
import { measure } from '../layout/text'

const NAME_METRICS = { size: 13, em: 0.6, tracking: 0 }
const PAD_X = 10
const NODE_HEIGHT = 26
const ENDPOINT_RADIUS = 4

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

/** Extracted verbatim from `OnionDiagram.tsx` (ADR-01) — no behaviour change; the marker id is the caller's own
 * `<defs>` concern, since Onion's and Clean's own diagrams each declare their own arrow marker. */
export function RingedEdge({ edge, markerId }: { edge: RingedEdgeLayout; markerId: string }) {
  return <line className="edge edge-import" markerEnd={`url(#${markerId})`} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} />
}

export function RingedElementNode({ element, selected, target, interactive }: { element: RingedElementLayout; selected: boolean; target: boolean; interactive: boolean }) {
  const width = measure(element.name, NAME_METRICS) + 2 * PAD_X
  return (
    <g
      className="node node-ringedElement tone-teal"
      data-ref={element.ref}
      data-selected={selected ? '' : undefined}
      data-link-target={target ? '' : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `${element.name} (${element.ringRole})` : undefined}
    >
      <rect className="box" x={element.x - width / 2} y={element.y - NODE_HEIGHT / 2} width={width} height={NODE_HEIGHT} rx={8} />
      <text className="centered" x={element.x} y={element.y} dominantBaseline="middle" fontSize={NAME_METRICS.size}>
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
      <text className={labelSide > 0 ? undefined : 'end'} x={endpoint.x + labelSide * (ENDPOINT_RADIUS + 4)} y={endpoint.y} dominantBaseline="middle" fontSize={NAME_METRICS.size}>
        {endpoint.name}
      </text>
    </g>
  )
}
