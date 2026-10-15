const FLASH_MS = 1200

/** Bring a card into view and flash it, so canvas and panel stay in step; `focus` also selects its first field.
 * Ids repeat across subdomains, so `hexId` narrows the search to that subdomain's section. */
export function revealInEditor(id: string, focus: boolean, hexId?: string) {
  const scope = hexId ? `[data-subdomain="${CSS.escape(hexId)}"] ` : ''
  const card = document.querySelector(`${scope}[data-item-id="${id}"]`)
  if (!card) return
  // Folds nest (a layer sits in Layers, inside Diagram settings): every closed ancestor opens.
  for (let fold = card.closest('details.fold'); fold; fold = fold.parentElement?.closest('details.fold') ?? null) (fold as HTMLDetailsElement).open = true
  card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  card.classList.add('is-flash')
  setTimeout(() => card.classList.remove('is-flash'), FLASH_MS)
  if (!focus) return
  const field = card.querySelector('input')
  field?.focus({ preventScroll: true })
  field?.select()
}
