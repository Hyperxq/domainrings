import { validated } from './validated'

type WithId = { id: string }
type EndpointCollection = 'actors' | 'externals'

/** The shape every "ringed" document (Onion, and later Clean — ADR-01) holds in common: a flat element
 * collection, dependencies between elements, and two endpoint collections (actors/externals) that may target an
 * element. Each kind's own element shape differs (Onion: `ringRole` direct field; Clean: `sectorId` indirection,
 * ADR-02) — nothing here reads or writes that field, so the difference never leaks in. */
interface RingedDoc<E extends WithId, Dep extends WithId & { fromId: string; toId: string }, Ep extends WithId & { targetId?: string }> {
  elements: E[]
  dependencies: Dep[]
  actors: Ep[]
  externals: Ep[]
}

/** Whatever the store's own schema exposes for validate-by-reparse (ADR-02) — the same shape `validated()` takes. */
interface SafeParseable<T> {
  safeParse: (candidate: T) => { success: boolean }
}

/** Adds a named element to the document (REQ-07/REQ-03: any ring/sector accepts any element, nothing referential
 * is created yet) — always succeeds, no validation needed. */
export function addElement<D extends RingedDoc<E, WithId & { fromId: string; toId: string }, WithId & { targetId?: string }>, E extends WithId>(
  doc: D,
  patch: Omit<E, 'id'>,
  makeId: () => string,
): { doc: D; id: string } {
  const id = makeId()
  return { doc: { ...doc, elements: [...doc.elements, { ...patch, id } as E] }, id }
}

/** Patches an existing element (validate-by-reparse) — undefined ⇒ no-op: the patch would break something the
 * schema's own integrity rules check (e.g. a dependency or endpoint target no longer standing). */
export function updateElement<D extends RingedDoc<E, WithId & { fromId: string; toId: string }, WithId & { targetId?: string }>, E extends WithId>(
  doc: D,
  id: string,
  patch: Partial<Omit<E, 'id'>>,
  schema: SafeParseable<D>,
): D | undefined {
  const candidate = { ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } as D
  return validated(schema, candidate)
}

/** Removes an element, pruning any dependency it took part in and clearing any endpoint target pointing to it —
 * both would otherwise leave the document referencing an element that no longer exists. */
export function removeElement<D extends RingedDoc<WithId, Dep, Ep>, Dep extends WithId & { fromId: string; toId: string }, Ep extends WithId & { targetId?: string }>(
  doc: D,
  id: string,
): D {
  return {
    ...doc,
    elements: doc.elements.filter((e) => e.id !== id),
    dependencies: doc.dependencies.filter((d) => d.fromId !== id && d.toId !== id),
    actors: doc.actors.map((a) => (a.targetId === id ? { ...a, targetId: undefined } : a)),
    externals: doc.externals.map((x) => (x.targetId === id ? { ...x, targetId: undefined } : x)),
  } as D
}

/** Creates a dependency from `fromId` to `toId` (validate-by-reparse) — undefined ⇒ no-op: the pair fails the
 * schema's own rule (e.g. it would point to a more outward ring). */
export function addDependency<D extends RingedDoc<WithId, Dep, WithId & { targetId?: string }>, Dep extends WithId & { fromId: string; toId: string }>(
  doc: D,
  fromId: string,
  toId: string,
  makeId: () => string,
  schema: SafeParseable<D>,
): { doc: D; id: string } | undefined {
  const id = makeId()
  const candidate = { ...doc, dependencies: [...doc.dependencies, { id, fromId, toId } as Dep] } as D
  const next = validated(schema, candidate)
  return next ? { doc: next, id } : undefined
}

export function removeDependency<D extends RingedDoc<WithId, Dep, WithId & { targetId?: string }>, Dep extends WithId & { fromId: string; toId: string }>(
  doc: D,
  id: string,
): D {
  return { ...doc, dependencies: doc.dependencies.filter((d) => d.id !== id) } as D
}

/** Adds an actor or external system (validate-by-reparse) — undefined ⇒ no-op: `targetId` is set but does not
 * resolve to a valid target (e.g. not on the outer ring). */
export function addEndpoint<D extends RingedDoc<WithId, WithId & { fromId: string; toId: string }, Ep>, Ep extends WithId & { targetId?: string }>(
  doc: D,
  collection: EndpointCollection,
  patch: Omit<Ep, 'id'>,
  makeId: () => string,
  schema: SafeParseable<D>,
): { doc: D; id: string } | undefined {
  const id = makeId()
  const candidate = { ...doc, [collection]: [...doc[collection], { ...patch, id }] } as D
  const next = validated(schema, candidate)
  return next ? { doc: next, id } : undefined
}

export function removeEndpoint<D extends RingedDoc<WithId, WithId & { fromId: string; toId: string }, Ep>, Ep extends WithId & { targetId?: string }>(
  doc: D,
  collection: EndpointCollection,
  id: string,
): D {
  return { ...doc, [collection]: doc[collection].filter((e) => e.id !== id) } as D
}
