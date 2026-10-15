import type { Diagram } from './schema'

/** The aggregates a use case may name: top-level ones, since a nested aggregate has no card of its own to end an arrow on. */
export const rootAggregates = (d: Diagram) => d.domain.filter((i) => i.type === 'aggregate' && !i.parentId)

/** The use cases without `gone` among the aggregates they name; an emptied field is dropped so a file reads as it did before. */
export function withoutAggregates<T extends { aggregateIds?: string[] }>(useCases: T[], gone: ReadonlySet<string>): T[] {
  return useCases.map((u) => {
    if (!u.aggregateIds?.some((id) => gone.has(id))) return u
    const { aggregateIds, ...rest } = u
    const left = aggregateIds.filter((id) => !gone.has(id))
    return (left.length ? { ...rest, aggregateIds: left } : rest) as T
  })
}
