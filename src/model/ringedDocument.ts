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

/** Looks up an element's own name by id — the one lookup every undo-toast message needs (element, dependency
 * end, endpoint target), shared so Onion's and Clean's editor/stage each write it once instead of four times. */
export function elementName<E extends WithId & { name: string }>(elements: readonly E[], id: string): string {
  return elements.find((e) => e.id === id)?.name ?? ''
}

/** Adds a named element to the document (REQ-07/REQ-03: any ring/sector accepts any element, nothing referential
 * is created yet) — always succeeds, no validation needed. `beforeId`, when given, inserts the new element right
 * before it in the flat `elements` array rather than appending: a ring/sector's own order is exactly its elements'
 * relative order in this one array, so landing it just before a specific neighbour is enough to place it at a
 * specific gap on that ring/sector's own circumference (`onionInsertionPoints`/`cleanInsertionPoints`) — no
 * separate per-ring index bookkeeping needed, and elements of OTHER rings interleaved in between never matter. */
export function addElement<D extends RingedDoc<E, WithId & { fromId: string; toId: string }, WithId & { targetId?: string }>, E extends WithId>(
  doc: D,
  patch: Omit<E, 'id'>,
  makeId: () => string,
  beforeId?: string,
): { doc: D; id: string } {
  const id = makeId()
  const element = { ...patch, id } as E
  const index = beforeId ? doc.elements.findIndex((e) => e.id === beforeId) : -1
  const elements = index === -1 ? [...doc.elements, element] : [...doc.elements.slice(0, index), element, ...doc.elements.slice(index)]
  return { doc: { ...doc, elements }, id }
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

/** Which collection a canvas selection ref names, and its display name — the one lookup the canvas's own
 * Delete/Backspace key needs before it can call the RIGHT one of the store's existing removals (`removeElement`/
 * `removeEndpoint`): a selection can be an element, an actor or an external (never a dependency, which has no
 * canvas box of its own to select). `undefined` when `ref` names none of the three (already removed by something
 * else, e.g. a concurrent Undo). */
export function classifyRef<E extends WithId & { name: string }, Ep extends WithId & { name: string; targetId?: string }>(
  doc: { elements: readonly E[]; actors: readonly Ep[]; externals: readonly Ep[] },
  ref: string,
): { collection: 'elements' | 'actors' | 'externals'; name: string } | undefined {
  const element = doc.elements.find((e) => e.id === ref)
  if (element) return { collection: 'elements', name: element.name }
  const actor = doc.actors.find((a) => a.id === ref)
  if (actor) return { collection: 'actors', name: actor.name }
  const external = doc.externals.find((x) => x.id === ref)
  if (external) return { collection: 'externals', name: external.name }
  return undefined
}
