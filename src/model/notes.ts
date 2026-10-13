type Noted = { id: string; note?: string }
const COLLECTIONS = ['domain', 'useCases', 'ports', 'adapters', 'elements', 'actors', 'externals'] as const

/** Every element of a diagram or ringed document that carries a note, by ref. The composition root is `composition`. */
export function notesOf(doc: Partial<Record<(typeof COLLECTIONS)[number], Noted[]>> & { composition?: { note?: string } }): ReadonlyMap<string, string> {
  const notes = new Map<string, string>()
  const add = (ref: string, note: string | undefined) => note?.trim() && notes.set(ref, note)
  for (const key of COLLECTIONS) doc[key]?.forEach((item) => add(item.id, item.note))
  add('composition', doc.composition?.note)
  return notes
}

/** The note on show: the selection's own wins; the hovered element's only fills in when the selection has none. */
export function noteToShow(notes: ReadonlyMap<string, string>, selected: string | null, hovered: string | null): { ref: string; text: string } | null {
  const ref = [selected, hovered].find((r): r is string => r !== null && notes.has(r))
  return ref === undefined ? null : { ref, text: notes.get(ref)! }
}
