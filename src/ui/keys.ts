/** A key pressed here belongs to a field (its own undo, its own Backspace), not to a canvas shortcut. */
export const typing = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]')

/** Delete/Backspace (and other canvas-only shortcuts) act on the selection only when no field has the keyboard —
 * shared by Hexagonal's own Stage and the Onion/Clean RingedStage (ADR-01), each rendering its own `main.stage`. */
export const keyOnCanvas = (target: EventTarget | null) =>
  target instanceof Element && !typing(target) && (target === document.body || !!target.closest('main.stage'))
