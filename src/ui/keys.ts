/** A key pressed here belongs to a field (its own undo, its own Backspace), not to a canvas shortcut. */
export const typing = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]')
