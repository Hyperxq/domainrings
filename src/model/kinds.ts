import type { LayerRole } from './schema'

export type RingRole = LayerRole

export interface RingSpec {
  name: string
  role: RingRole
  subtitle?: string
}

export interface KindLabels {
  drivingPort: string
  drivenPort: string
  adapterIn: string
  adapterOut: string
  runs: string
  uses: string
  asks: string
}

export interface KindConfig {
  label: string
  /** Outermost first. Exactly one ring has role 'application' and one 'adapters' right outside it. */
  rings: RingSpec[]
  labels: KindLabels
  /** When set, the domain declares the driven ports and lists them under this heading. */
  drivenPortNote?: { title: string }
}

/** The only architecture a live Diagram can have — Clean/Onion's old kind switcher is gone, and native Onion is
 * a wholly separate document shape (ADR-01) that never goes through this config. Kept as a single config object,
 * not a per-kind lookup, since there is only ever one. */
export const HEXAGONAL_KIND: KindConfig = {
  label: 'Hexagonal',
  rings: [
    { name: 'Infrastructure', role: 'adapters' },
    { name: 'Application', role: 'application', subtitle: 'one use case per business action' },
    { name: 'Domain', role: 'domain' },
  ],
  labels: {
    drivingPort: 'driving port',
    drivenPort: 'driven port',
    adapterIn: 'infrastructure/in',
    adapterOut: 'infrastructure/out',
    runs: 'runs the use case',
    uses: 'uses',
    asks: 'asks the domain to decide',
  },
  drivenPortNote: { title: 'driven-ports/' },
}
