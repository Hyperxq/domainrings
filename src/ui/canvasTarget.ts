/** The layer an element belongs to: its band, or the ring it is drawn in (its own `data-band`/`data-layer`, e.g. the
 * band itself or one of its own elements). */
export const layerOf = (target: Element) =>
  target.closest('[data-band]')?.getAttribute('data-band') ?? target.closest('[data-layer]')?.getAttribute('data-layer') ?? null

/** The specific element/endpoint a target is (`data-ref`) — for the per-element endpoint "+"s. */
export const refOf = (target: Element) => target.closest('[data-ref]')?.getAttribute('data-ref') ?? null

/** The hexagon group a target sits in (`data-hex`). */
export const hexIdOf = (target: Element) => target.closest('[data-hex]')?.getAttribute('data-hex') ?? null
