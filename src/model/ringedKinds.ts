export const RINGED_KINDS = [
  'entity',
  'valueObject',
  'aggregate',
  'domainEvent',
  'domainService',
  'repositoryInterface',
  'applicationService',
  'ui',
  'infrastructure',
  'test',
  'repositoryImplementation',
  'interactor',
  'inputPort',
  'outputPort',
  'controller',
  'presenter',
  'gateway',
  'framework',
  'database',
  'web',
  'device',
] as const

export type RingedKind = (typeof RINGED_KINDS)[number]

export const RINGED_KIND_LABEL: Record<RingedKind, string> = {
  entity: 'entity',
  valueObject: 'value object',
  aggregate: 'aggregate',
  domainEvent: 'domain event',
  domainService: 'domain service',
  repositoryInterface: 'repository interface',
  applicationService: 'application service',
  ui: 'UI',
  infrastructure: 'infrastructure',
  test: 'test',
  repositoryImplementation: 'repository implementation',
  interactor: 'interactor',
  inputPort: 'input port',
  outputPort: 'output port',
  controller: 'controller',
  presenter: 'presenter',
  gateway: 'gateway',
  framework: 'framework',
  database: 'database',
  web: 'web',
  device: 'device',
}

/** What each ring may hold, by ring role — the two architectures share role names ("domain", "outer") but not
 * their lists, so each keeps its own table. */
export const ONION_KINDS: Record<string, readonly RingedKind[]> = {
  domain: ['entity', 'valueObject', 'aggregate', 'domainEvent'],
  domainServices: ['domainService', 'repositoryInterface'],
  application: ['applicationService'],
  outer: ['ui', 'infrastructure', 'test', 'repositoryImplementation'],
}

export const CLEAN_KINDS: Record<string, readonly RingedKind[]> = {
  domain: ['entity', 'valueObject', 'aggregate'],
  application: ['interactor', 'inputPort', 'outputPort'],
  adapters: ['controller', 'presenter', 'gateway'],
  outer: ['framework', 'database', 'web', 'device'],
}

/** The kinds a ring role allows in `table`; a role the table does not name (a user-added ring) allows none. Own keys
 * only — a plain lookup would answer `constructor` with an inherited function. */
export const kindsFor = (table: Record<string, readonly RingedKind[]>, role: string): readonly RingedKind[] => (Object.hasOwn(table, role) ? table[role] : [])
