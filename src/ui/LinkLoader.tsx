/** Covers the canvas while a linked map is being fetched or decoded, so the map it replaces never reads as the answer. */
export function LinkLoader() {
  return (
    <div className="link-loader">
      <div className="island link-loader-card" role="status" aria-live="polite">
        <span className="link-loader-spinner" aria-hidden="true" />
        <p>Opening the linked map…</p>
      </div>
    </div>
  )
}
