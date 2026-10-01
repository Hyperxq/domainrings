import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import type { LayoutMode } from '../../layout/layout'
import { browserStorage } from '../../model/persistence'
import { PALETTES, type PaletteId } from '../palette'

/** `system` means no stored preference: the OS decides. */
export type ThemeChoice = 'light' | 'dark' | 'system'

export interface Preferences {
  mode: LayoutMode
  guides: boolean
  /** Off: hovering still reveals the "+" buttons, but nothing dims, glows or retitles. */
  highlight: boolean
  /** Emphasize what depends on the selection instead of what it depends on. */
  dependents: boolean
  legendOpen: boolean
  legendInExport: boolean
  /** Reading mode: every editing affordance is gone, while viewing, selecting and exporting stay. */
  viewOnly: boolean
  theme: ThemeChoice
  palette: PaletteId
}

const DEFAULTS: Preferences = {
  mode: 'detailed',
  guides: true,
  highlight: true,
  dependents: false,
  legendOpen: false,
  legendInExport: true,
  viewOnly: false,
  theme: 'system',
  palette: 'default',
}

interface Codec<T> {
  key: string
  /** The stored text read back as a valid value; anything else falls to the default. */
  decode: (raw: string) => T | undefined
  /** `undefined` removes the key, so the default applies again. */
  encode: (value: T) => string | undefined
}

const flag = (key: string): Codec<boolean> => ({ key, decode: (raw) => raw === 'true', encode: String })

// Each preference keeps its own raw `domainrings:*` key, exactly as earlier versions wrote them.
const CODECS: { [K in keyof Preferences]: Codec<Preferences[K]> } = {
  mode: { key: 'domainrings:overview', decode: (raw) => (raw === 'true' ? 'overview' : 'detailed'), encode: (mode) => String(mode === 'overview') },
  guides: flag('domainrings:guides'),
  highlight: flag('domainrings:highlight'),
  dependents: flag('domainrings:dependents'),
  legendOpen: flag('domainrings:legend-open'),
  legendInExport: flag('domainrings:legend-export'),
  viewOnly: flag('domainrings:view-only'),
  theme: { key: 'domainrings:theme', decode: (raw) => (raw === 'light' || raw === 'dark' ? raw : undefined), encode: (theme) => (theme === 'system' ? undefined : theme) },
  palette: { key: 'domainrings:palette', decode: (raw) => (Object.hasOwn(PALETTES, raw) ? (raw as PaletteId) : undefined), encode: (palette) => (palette === 'default' ? undefined : palette) },
}
const FIELDS = Object.keys(CODECS) as (keyof Preferences)[]

function stored<K extends keyof Preferences>(storage: Storage | undefined, field: K): Preferences[K] {
  const codec = CODECS[field] as Codec<Preferences[K]>
  try {
    const raw = storage?.getItem(codec.key) ?? null
    return (raw === null ? undefined : codec.decode(raw)) ?? DEFAULTS[field]
  } catch {
    return DEFAULTS[field]
  }
}

// Storage can be blocked (private mode): the defaults apply then, and a choice still holds for this session.
const storage: PersistStorage<Preferences> = {
  getItem: () => {
    const raw = browserStorage()
    return { state: Object.fromEntries(FIELDS.map((field) => [field, stored(raw, field)])) as unknown as Preferences, version: 0 }
  },
  // Only a changed field is written, so a default is never stored just because another preference moved.
  setItem: (_, { state }) => {
    const raw = browserStorage()
    for (const field of FIELDS) {
      if (stored(raw, field) === state[field]) continue
      const { key, encode } = CODECS[field] as Codec<Preferences[typeof field]>
      try {
        const text = encode(state[field])
        if (text === undefined) raw?.removeItem(key)
        else raw?.setItem(key, text)
      } catch {
        // The choice still applies for this session.
      }
    }
  },
  removeItem: () => {},
}

export const usePreferencesStore = create<Preferences>()(persist(() => DEFAULTS, { name: 'domainrings:preferences', storage }))

/** The theme and palette reach the page as `data-*` attributes on <html>; a default removes its attribute. */
function applyRoot({ theme, palette }: Preferences) {
  const { dataset } = document.documentElement
  if (theme === 'system') delete dataset.theme
  else dataset.theme = theme
  if (palette === 'default') delete dataset.palette
  else dataset.palette = palette
}
applyRoot(usePreferencesStore.getState())
usePreferencesStore.subscribe(applyRoot)
