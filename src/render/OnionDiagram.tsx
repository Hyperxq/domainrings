import type { OnionLayoutModel } from '../layout/onion'
import { Ring } from './Diagram'

interface OnionDiagramProps {
  model: OnionLayoutModel
}

/** An Onion document's rings — elements, dependency arrows and endpoints land in S-002; S-000 only draws the
 * 4 fixed bands, reusing the same `<Ring>` primitive Hexagonal/Clean already render with (ADR-01/ADR-02). */
export function OnionDiagram({ model }: OnionDiagramProps) {
  return (
    <>
      {model.rings.map((ring, i) => (
        <Ring key={ring.key} ring={ring} shape="circle" inner={model.rings[i - 1]} interactive={false} />
      ))}
    </>
  )
}
