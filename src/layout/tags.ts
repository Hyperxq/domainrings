import type { KindLabels } from '../model/kinds'
import type { DomainType, Side } from '../model/schema'

/** Glyph + word: the one channel that says what an element is (colour says layer, stroke says role). */
export const DOMAIN_TAGS: Record<DomainType, string> = {
  aggregate: '◆ aggregate',
  entity: '● entity',
  valueObject: '○ value object',
  domainService: '⚙ domain service',
}

/** What a card says of its root: an aggregate is the root of its consistency boundary, any other root names its type. */
export const cardHeader = (type: DomainType) => (type === 'aggregate' ? '◆ aggregate root' : DOMAIN_TAGS[type])

/** A card row's type, set against the card's right edge. */
export const ROW_TYPES: Record<DomainType, string> = { aggregate: 'aggregate', entity: 'entity', valueObject: 'value obj', domainService: 'service' }

export const USE_CASE_TAG = '▶ use case'

/** Marks a port the domain declares: the contract it owns and the adapters implement. */
export const DRIVEN_GLYPH = '◇'

export const portTag = (side: Side, labels: KindLabels) => (side === 'driving' ? `⇥ ${labels.drivingPort}` : `${DRIVEN_GLYPH} ${labels.drivenPort}`)

export const adapterTag = (side: Side, labels: KindLabels) => (side === 'driving' ? `⇥ ${labels.adapterIn}` : `⇤ ${labels.adapterOut}`)
