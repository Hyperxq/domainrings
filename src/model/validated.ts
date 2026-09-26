/** The shared "validate-by-reparse" gate (ADR-02): a mutating store action builds its candidate document, then
 * asks `schema` whether it still stands — reusing the schema's own integrity rules instead of re-implementing
 * them per action. Returns `candidate` unchanged when it validates, `undefined` when it does not. */
export function validated<T>(schema: { safeParse: (candidate: T) => { success: boolean } }, candidate: T): T | undefined {
  return schema.safeParse(candidate).success ? candidate : undefined
}
