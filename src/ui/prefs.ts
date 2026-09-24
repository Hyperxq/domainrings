// Per-viewer UI switches. Storage can be blocked (private mode); the default always applies then.
export function readPref(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // The switch still applies for this session.
  }
}

/**
 * A preference the page applies as a `data-*` attribute on <html> (read back at boot by main.tsx, stored under
 * `domainrings:<name>`). `undefined` removes both the attribute and the stored value, so the default applies again.
 */
export function setRootPref(name: 'theme' | 'palette', value: string | undefined) {
  const { dataset } = document.documentElement
  if (value === undefined) delete dataset[name]
  else dataset[name] = value
  try {
    if (value === undefined) localStorage.removeItem(`domainrings:${name}`)
    else localStorage.setItem(`domainrings:${name}`, value)
  } catch {
    // The choice still applies for this session.
  }
}
