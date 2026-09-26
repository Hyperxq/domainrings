import type { CleanLayoutModel } from '../layout/clean'
import { Ring } from './Diagram'

/** A Clean document's 4 fixed rings (reusing the same `<Ring>` primitive Hexagonal/Onion render with, ADR-01) —
 * nothing else to draw yet: a fresh Clean file has no sectors or elements. */
export function CleanDiagram({ model }: { model: CleanLayoutModel }) {
  return (
    <>
      {model.rings.map((ring, i) => (
        <Ring key={ring.key} ring={ring} shape="circle" inner={model.rings[i - 1]} interactive={false} />
      ))}
    </>
  )
}
