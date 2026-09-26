import type { OnionLayoutModel } from '../layout/onion'
import { RingedEdge, RingedElementNode, RingedEndpointNode } from './RingedNodes'
import { Ring } from './Diagram'

interface OnionDiagramProps {
  model: OnionLayoutModel
  /** The selected element/endpoint ref, for the "start a dependency/connect an endpoint" gesture (OnionStage). */
  selected: string | null
  /** False for a canvas that only previews the diagram (none today) — mirrors Hexagonal's Node contract. */
  interactive: boolean
  /** While linking (OnionStage), the element refs a dependency from the selection may legally target (REQ-04) —
   * drives the same `data-link-target` CSS Hexagonal's own link mode uses (styles.css:250-252). Empty otherwise. */
  validTargets: ReadonlySet<string>
}

/** An Onion document's 4 fixed rings (reusing the same `<Ring>` primitive Hexagonal/Clean render with, ADR-01),
 * its elements spread along their ring (REQ-07), inward-only dependency arrows (REQ-04), and actors/external
 * systems outside the outer ring with a direct arrow to their target (REQ-05) — no ports or adapters. Node/edge
 * primitives are shared with Clean via `RingedNodes.tsx` (ADR-01); only this file's own `<defs>` (the arrow
 * marker Clean draws its own copy of, under its own id) and ring/model wiring are Onion-specific. */
export function OnionDiagram({ model, selected, interactive, validTargets }: OnionDiagramProps) {
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
        <RingedEdge key={edge.key} edge={edge} markerId="onion-arrow" />
      ))}
      {model.elements.map((element) => (
        <RingedElementNode key={element.key} element={element} selected={element.ref === selected} target={validTargets.has(element.ref)} interactive={interactive} />
      ))}
      {model.endpoints.map((endpoint) => (
        <RingedEndpointNode key={endpoint.key} endpoint={endpoint} selected={endpoint.ref === selected} interactive={interactive} />
      ))}
    </>
  )
}
