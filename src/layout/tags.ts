import type { KindLabels } from '../model/kinds'
import type { DomainType, Side } from '../model/schema'

/** Glyph + word: the one channel that says what an element is (colour says layer, stroke says role). */
export const DOMAIN_TAGS: Record<DomainType, string> = {
  aggregate: '◆ aggregate',
  entity: '● entity',
  valueObject: '○ value object',
  domainService: '⚙ domain service',
}

export const USE_CASE_TAG = '▶ use case'

export const portTag = (side: Side, labels: KindLabels) => (side === 'driving' ? `⇥ ${labels.drivingPort}` : `⇤ ${labels.drivenPort}`)

export const adapterTag = (side: Side, labels: KindLabels) => (side === 'driving' ? `⇥ ${labels.adapterIn}` : `⇤ ${labels.adapterOut}`)
