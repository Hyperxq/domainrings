import type { OnionLayoutModel } from '../layout/onion'
import { Ring } from './Diagram'

interface OnionDiagramProps {
  model: OnionLayoutModel
}

/** An Onion document's 4 fixed rings, reusing the same `<Ring>` primitive Hexagonal/Clean already render with
 * (ADR-01/ADR-02); elements, dependency arrows and endpoints are not modeled yet. */
export function OnionDiagram({ model }: OnionDiagramProps) {
  return (
    <>
      {model.rings.map((ring, i) => (
        <Ring key={ring.key} ring={ring} shape="circle" inner={model.rings[i - 1]} interactive={false} />
      ))}
    </>
  )
}
