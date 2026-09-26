import type { OnionEdgeLayout, OnionElementLayout, OnionEndpointLayout, OnionLayoutModel } from '../layout/onion'
import { measure } from '../layout/text'
import { Ring } from './Diagram'

const NAME_METRICS = { size: 13, em: 0.6, tracking: 0 }
const PAD_X = 10
const NODE_HEIGHT = 26
const ENDPOINT_RADIUS = 4

interface OnionDiagramProps {
  model: OnionLayoutModel
  /** The selected element/endpoint ref, for the "start a dependency/connect an endpoint" gesture (OnionStage). */
  selected: string | null
  /** False for a canvas that only previews the diagram (none today) — mirrors Hexagonal's Node contract. */
  interactive: boolean
}

function OnionEdge({ edge }: { edge: OnionEdgeLayout }) {
  return <line className="edge edge-import" markerEnd="url(#onion-arrow)" x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} />
}

function OnionElementNode({ element, selected, interactive }: { element: OnionElementLayout; selected: boolean; interactive: boolean }) {
  const width = measure(element.name, NAME_METRICS) + 2 * PAD_X
  return (
    <g
      className="node node-onionElement tone-teal"
      data-ref={element.ref}
      data-selected={selected ? '' : undefined}
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

function OnionEndpointNode({ endpoint, selected, interactive }: { endpoint: OnionEndpointLayout; selected: boolean; interactive: boolean }) {
  const labelSide = endpoint.x >= 0 ? 1 : -1
  return (
    <g
      className={`node node-onionEndpoint tone-${endpoint.kind === 'actor' ? 'driving' : 'driven'}`}
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

/** An Onion document's 4 fixed rings (reusing the same `<Ring>` primitive Hexagonal/Clean render with, ADR-01),
 * its elements spread along their ring (REQ-07), inward-only dependency arrows (REQ-04), and actors/external
 * systems outside the outer ring with a direct arrow to their target (REQ-05) — no ports or adapters. */
export function OnionDiagram({ model, selected, interactive }: OnionDiagramProps) {
  return (
    <>
      <defs>
        <marker id="onion-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head" d="M0 0L10 5L0 10z" />
        </marker>
      </defs>
      {model.rings.map((ring, i) => (
        <Ring key={ring.key} ring={ring} shape="circle" inner={model.rings[i - 1]} interactive={false} />
      ))}
      {model.edges.map((edge) => (
        <OnionEdge key={edge.key} edge={edge} />
      ))}
      {model.elements.map((element) => (
        <OnionElementNode key={element.key} element={element} selected={element.ref === selected} interactive={interactive} />
      ))}
      {model.endpoints.map((endpoint) => (
        <OnionEndpointNode key={endpoint.key} endpoint={endpoint} selected={endpoint.ref === selected} interactive={interactive} />
      ))}
    </>
  )
}
