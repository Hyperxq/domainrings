import type { ArchitectureKind, LayerRole } from './schema'

export type RingRole = LayerRole
export type Shape = 'hexagon' | 'circle'

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
  shape: Shape
  /** Outermost first. Exactly one ring has role 'application' and one 'adapters' right outside it. */
  rings: RingSpec[]
  labels: KindLabels
  /** Actors and externals live inside the outermost ring instead of around it. */
  endpointsInside: boolean
  /** When set, the domain declares the driven ports and lists them under this heading. */
  drivenPortNote?: { title: string }
}

export const KINDS: Record<ArchitectureKind, KindConfig> = {
  hexagonal: {
    label: 'Hexagonal',
    shape: 'hexagon',
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
    endpointsInside: false,
    drivenPortNote: { title: 'driven-ports/' },
  },
  clean: {
    label: 'Clean',
    shape: 'circle',
    rings: [
      { name: 'Frameworks & Drivers', role: 'outer' },
      { name: 'Interface Adapters', role: 'adapters' },
      { name: 'Use Cases', role: 'application' },
      { name: 'Entities', role: 'domain' },
    ],
    labels: {
      drivingPort: 'input port',
      drivenPort: 'output port',
      adapterIn: 'controller · presenter',
      adapterOut: 'gateway',
      runs: 'calls the interactor',
      uses: 'uses',
      asks: 'asks the domain to decide',
    },
    endpointsInside: true,
  },
  onion: {
    label: 'Onion',
    shape: 'circle',
    rings: [
      { name: 'Infrastructure', role: 'adapters' },
      { name: 'Application Services', role: 'application' },
      { name: 'Domain Services', role: 'domainServices' },
      { name: 'Domain Model', role: 'domain' },
    ],
    labels: {
      drivingPort: 'driving port',
      drivenPort: 'driven port',
      adapterIn: 'infrastructure/in',
      adapterOut: 'infrastructure/out',
      runs: 'runs the service',
      uses: 'uses',
      asks: 'asks the domain to decide',
    },
    endpointsInside: true,
  },
}
