import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { KINDS } from '../model/kinds'
import { useSyncExternalStore } from 'react'
import { KindSchema, type ArchitectureKind } from '../model/schema'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'
import { PALETTES, type PaletteId } from './palette'

const REPOSITORY_URL = 'https://github.com/Hyperxq/domainrings'

export type ExportScope = 'map' | 'hexagon'
/** `system` means no stored preference: the OS decides. */
export type ThemeChoice = 'light' | 'dark' | 'system'

interface ToolbarProps {
  kind: ArchitectureKind
  /** A map with more than one hexagon is always hexagonal (MIG-04) — the kind radios go inert and explain why. */
  kindLocked: boolean
  themeChoice: ThemeChoice
  palette: PaletteId
  onKind: (kind: ArchitectureKind) => void
  onNew: () => void
  onExample: (id: (typeof EXAMPLES)[number]['id']) => void
  /** Replaces the whole map — distinct from Editor's "Add hexagon from file…", which adds one hexagon. */
  onOpen: (file: File) => void
  onExport: (format: 'hexa' | 'svg' | 'png') => void
  onTheme: (choice: ThemeChoice) => void
  onPalette: (id: PaletteId) => void
  mode: LayoutMode
  onMode: (mode: LayoutMode) => void
  guides: boolean
  onGuides: (show: boolean) => void
  highlight: boolean
  onHighlight: (on: boolean) => void
  /** Only a multi-hexagon map has more than one thing to export (EXPORT-03) — a single hexagon has nothing to choose between. */
  showScope: boolean
  exportScope: ExportScope
  onExportScope: (scope: ExportScope) => void
}

const KIND_LOCK_HINT = 'A map with more than one hexagon is always hexagonal.'
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

export function Toolbar({ kind, kindLocked, themeChoice, palette, onKind, onNew, onExample, onOpen, onExport, onTheme, onPalette, mode, onMode, guides, onGuides, highlight, onHighlight, showScope, exportScope, onExportScope }: ToolbarProps) {
  const full = useSyncExternalStore(fullMedia.subscribe, fullMedia.matches)
  const roomy = useSyncExternalStore(roomyMedia.subscribe, roomyMedia.matches)
  const systemDark = useSyncExternalStore(darkMedia.subscribe, darkMedia.matches)
  const dark = themeChoice === 'system' ? systemDark : themeChoice === 'dark'
  const lock = {
    title: kindLocked ? KIND_LOCK_HINT : undefined,
    'aria-disabled': kindLocked || undefined,
    'aria-describedby': kindLocked ? 'kind-lock-hint' : undefined,
  }
  const tool = roomy ? 'tool' : 'icon-button'
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      {full ? (
        <fieldset className="kinds" title={lock.title}>
          <legend className="visually-hidden">Architecture style</legend>
          {KindSchema.options.map((k) => (
            <label key={k} className="kind">
              <input type="radio" name="kind" value={k} checked={kind === k} aria-disabled={lock['aria-disabled']} aria-describedby={lock['aria-describedby']} onChange={() => onKind(k)} />
              <span>{KINDS[k].label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <select className="kind-select" aria-label="Architecture style" value={kind} {...lock} onChange={(e) => onKind(e.currentTarget.value as ArchitectureKind)}>
          {KindSchema.options.map((k) => (
            <option key={k} value={k}>{KINDS[k].label}</option>
          ))}
        </select>
      )}
      {/* Out of flow (REQ-04.2 keeps it assistive-tech only): a visible hint pushes a multi-hexagon toolbar past
          the viewport; the locked control's title carries it for sighted pointer users instead. */}
      {kindLocked && (
        <p id="kind-lock-hint" className="visually-hidden">
          {KIND_LOCK_HINT}
        </p>
      )}

      <span className="divider" aria-hidden="true" />

      {roomy ? (
        <>
          <fieldset className="kinds">
            <legend className="visually-hidden">Detail level</legend>
            {(['overview', 'detailed'] as const).map((m) => (
              <label key={m} className="kind">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => onMode(m)} />
                <span>{MODE_LABEL[m]}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="text-button" aria-pressed={guides} title="Show the dashed guide spokes" onClick={() => onGuides(!guides)}>
            Guides
          </button>
          <button type="button" className="text-button" aria-pressed={highlight} title="Highlight the layer under the pointer" onClick={() => onHighlight(!highlight)}>
            Highlight
          </button>
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
          ]}
          onChoose={(id) => {
            if (id === 'guides') onGuides(!guides)
            else if (id === 'highlight') onHighlight(!highlight)
            else onMode(id)
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
          {EXAMPLES.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
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
        onChoose={(id) => (id === 'light' || id === 'dark' || id === 'system' ? onTheme(id) : onPalette(id))}
      />
      <a className="icon-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View the source on GitHub" title="Source on GitHub">
        <Icon name="github" />
      </a>
    </header>
  )
}
