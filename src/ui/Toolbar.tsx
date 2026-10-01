import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { useSyncExternalStore } from 'react'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'
import { PALETTES, type PaletteId } from './palette'
import { usePreferencesStore, type ThemeChoice } from './state/preferencesStore'

const REPOSITORY_URL = 'https://github.com/Hyperxq/domainrings'

export type ExportScope = 'map' | 'hexagon'

interface ToolbarProps {
  onNew: () => void
  onExample: (id: (typeof EXAMPLES)[number]['id']) => void
  /** Replaces the whole map — distinct from Editor's "Add hexagon from file…", which adds one hexagon. */
  onOpen: (file: File) => void
  /** Always copies the whole map (REQ-05), regardless of the export scope selection. */
  onCopyLink: () => void
  onExport: (format: 'hexa' | 'svg' | 'png') => void
  /** Only a map large enough to compact has hexagons to expand: present, it adds Expand all (true) and Collapse all (false). */
  onExpandAll?: (expand: boolean) => void
  /** Only a multi-hexagon map has more than one thing to export (EXPORT-03) — a single hexagon has nothing to choose between. */
  showScope: boolean
  exportScope: ExportScope
  onExportScope: (scope: ExportScope) => void
}

const SCOPE_LABEL: Record<ExportScope, string> = { map: 'Map', hexagon: 'Hexagon' }
const MODE_LABEL: Record<LayoutMode, string> = { overview: 'Overview', detailed: 'Detailed' }
const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }
const EXPORT_CHOICES = [
  { id: 'hexa', label: '.hexa' },
  { id: 'svg', label: 'SVG' },
  { id: 'png', label: 'PNG' },
] as const

/* Each tier's widest toolbar (a multi-hexagon map, fallback fonts) plus the 12px side margins, measured in Chrome:
 * the full one is 1326px, so below 1350 the kind radios and export buttons collapse; the compact one is 1112px, so
 * below 1136 the file actions lose their words, the view controls fold into a menu and the export scope into the
 * Export menu. */
export const FULL_TOOLBAR = '(min-width: 1350px)'
export const ROOMY_TOOLBAR = '(min-width: 1136px)'
const media = (query: string) => ({
  subscribe: (onChange: () => void) => {
    const list = matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  },
  matches: () => matchMedia(query).matches,
})
const fullMedia = media(FULL_TOOLBAR)
const roomyMedia = media(ROOMY_TOOLBAR)
const darkMedia = media('(prefers-color-scheme: dark)')

export function Toolbar({ onNew, onExample, onOpen, onCopyLink, onExport, onExpandAll, showScope, exportScope, onExportScope }: ToolbarProps) {
  const { mode, guides, highlight, dependents, theme: themeChoice, palette } = usePreferencesStore()
  const full = useSyncExternalStore(fullMedia.subscribe, fullMedia.matches)
  const roomy = useSyncExternalStore(roomyMedia.subscribe, roomyMedia.matches)
  const systemDark = useSyncExternalStore(darkMedia.subscribe, darkMedia.matches)
  const dark = themeChoice === 'system' ? systemDark : themeChoice === 'dark'
  const tool = roomy ? 'tool' : 'icon-button'
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      <span className="divider" aria-hidden="true" />

      {roomy ? (
        <>
          <fieldset className="kinds">
            <legend className="visually-hidden">Detail level</legend>
            {(['overview', 'detailed'] as const).map((m) => (
              <label key={m} className="kind">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => usePreferencesStore.setState({ mode: m })} />
                <span>{MODE_LABEL[m]}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="text-button" aria-pressed={guides} title="Show the dashed guide spokes" onClick={() => usePreferencesStore.setState({ guides: !guides })}>
            Guides
          </button>
          <button type="button" className="text-button" aria-pressed={highlight} title="Highlight the layer under the pointer" onClick={() => usePreferencesStore.setState({ highlight: !highlight })}>
            Highlight
          </button>
          <button type="button" className="text-button" aria-pressed={dependents} title="Emphasize what depends on the selection, not what it depends on" onClick={() => usePreferencesStore.setState({ dependents: !dependents })}>
            Dependents
          </button>
          {onExpandAll && (
            <>
              <button type="button" className="text-button" title="Show every hexagon in full" onClick={() => onExpandAll(true)}>
                Expand all
              </button>
              <button type="button" className="text-button" title="Show only the current hexagon in full" onClick={() => onExpandAll(false)}>
                Collapse all
              </button>
            </>
          )}
        </>
      ) : (
        <ChoiceMenu
          label={
            <>
              View
              <Icon name="chevron" />
            </>
          }
          choices={[
            { id: 'overview', label: MODE_LABEL.overview, checked: mode === 'overview' },
            { id: 'detailed', label: MODE_LABEL.detailed, checked: mode === 'detailed' },
            { id: 'guides', label: 'Guides', checked: guides },
            { id: 'highlight', label: 'Highlight', checked: highlight },
            { id: 'dependents', label: 'Dependents', checked: dependents },
            ...(onExpandAll ? [{ id: 'expand-all' as const, label: 'Expand all' }, { id: 'collapse-all' as const, label: 'Collapse all' }] : []),
          ]}
          onChoose={(id) => {
            if (id === 'guides') usePreferencesStore.setState({ guides: !guides })
            else if (id === 'highlight') usePreferencesStore.setState({ highlight: !highlight })
            else if (id === 'dependents') usePreferencesStore.setState({ dependents: !dependents })
            else if (id === 'expand-all' || id === 'collapse-all') onExpandAll?.(id === 'expand-all')
            else usePreferencesStore.setState({ mode: id })
          }}
        />
      )}

      <span className="divider" aria-hidden="true" />

      <button type="button" className={tool} aria-label="New diagram" title="New diagram" onClick={onNew}>
        <Icon name="new" />
        {roomy && 'New'}
      </button>
      <label className={`${tool} example-picker`} title="Load an example">
        <Icon name="example" />
        {roomy && 'Example'}
        <select
          aria-label="Load an example"
          value=""
          onChange={(e) => {
            const example = EXAMPLES.find((x) => x.id === e.currentTarget.value)
            if (example) onExample(example.id)
          }}
        >
          <option value="" disabled>
            Load an example
          </option>
          {(['Hexagonal', 'Onion', 'Clean'] as const).map((architecture) => (
            <optgroup key={architecture} label={architecture}>
              {EXAMPLES.filter((x) => x.architecture === architecture).map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className={tool} title="Open a .hexa file, replacing the map">
        <input
          type="file"
          accept=".hexa,application/json"
          className="visually-hidden"
          aria-label="Open a .hexa file, replacing the map"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) onOpen(file)
            e.currentTarget.value = ''
          }}
        />
        <Icon name="upload" />
        {roomy && 'Open…'}
      </label>
      <button type="button" className={tool} aria-label="Copy link" title="Copy a link to this map" onClick={onCopyLink}>
        <Icon name="link" />
        {roomy && 'Copy link'}
      </button>

      <span className="divider" aria-hidden="true" />

      {full ? (
        <span className="export">
          <span id="export-label" className="export-label">
            Export
          </span>
          {showScope && (
            <fieldset className="kinds">
              <legend className="visually-hidden">Export scope</legend>
              {(['map', 'hexagon'] as const).map((s) => (
                <label key={s} className="kind">
                  <input type="radio" name="export-scope" value={s} checked={exportScope === s} onChange={() => onExportScope(s)} />
                  <span>{SCOPE_LABEL[s]}</span>
                </label>
              ))}
            </fieldset>
          )}
          <span className="segmented" role="group" aria-labelledby="export-label">
            <button type="button" className="text-button" aria-label="Save as .hexa file" onClick={() => onExport('hexa')}>.hexa</button>
            <button type="button" className="text-button" aria-label="Export as SVG" onClick={() => onExport('svg')}>SVG</button>
            <button type="button" className="text-button" aria-label="Export as PNG" onClick={() => onExport('png')}>PNG</button>
          </span>
        </span>
      ) : (
        <ChoiceMenu
          label={
            <>
              Export
              <Icon name="chevron" />
            </>
          }
          choices={[
            ...(showScope ? (['map', 'hexagon'] as const).map((s) => ({ id: s, label: SCOPE_LABEL[s], checked: exportScope === s })) : []),
            ...EXPORT_CHOICES,
          ]}
          onChoose={(id) => (id === 'map' || id === 'hexagon' ? onExportScope(id) : onExport(id))}
        />
      )}

      <span className="divider" aria-hidden="true" />

      <ChoiceMenu
        label={<Icon name={dark ? 'sun' : 'moon'} />}
        ariaLabel="Appearance"
        className="icon-trigger"
        align="end"
        choices={[
          ...(['light', 'dark', 'system'] as const).map((id) => ({ id, label: THEME_LABEL[id], checked: themeChoice === id })),
          ...(Object.keys(PALETTES) as PaletteId[]).map((id) => ({ id, label: PALETTES[id].label, description: PALETTES[id].description, checked: palette === id })),
        ]}
        onChoose={(id) => usePreferencesStore.setState(id === 'light' || id === 'dark' || id === 'system' ? { theme: id } : { palette: id })}
      />
      <a className="icon-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View the source on GitHub" title="Source on GitHub">
        <Icon name="github" />
      </a>
    </header>
  )
}
