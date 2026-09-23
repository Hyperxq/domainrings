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
