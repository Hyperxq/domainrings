import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { KINDS } from '../model/kinds'
import { KindSchema, type ArchitectureKind } from '../model/schema'
import { Icon } from './Icon'

const REPOSITORY_URL = 'https://github.com/Hyperxq/domainrings'

export type ExportScope = 'map' | 'hexagon'

interface ToolbarProps {
  kind: ArchitectureKind
  /** A map with more than one hexagon is always hexagonal (MIG-04) — the kind radios go inert and explain why. */
  kindLocked: boolean
  theme: 'light' | 'dark'
  onKind: (kind: ArchitectureKind) => void
  onNew: () => void
  onExample: (id: (typeof EXAMPLES)[number]['id']) => void
  onImport: (file: File) => void
  onExport: (format: 'hexa' | 'svg' | 'png') => void
  onTheme: () => void
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

export function Toolbar({ kind, kindLocked, theme, onKind, onNew, onExample, onImport, onExport, onTheme, mode, onMode, guides, onGuides, highlight, onHighlight, showScope, exportScope, onExportScope }: ToolbarProps) {
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      <fieldset className="kinds">
        <legend className="visually-hidden">Architecture style</legend>
        {KindSchema.options.map((k) => (
          <label key={k} className="kind">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              aria-disabled={kindLocked || undefined}
              aria-describedby={kindLocked ? 'kind-lock-hint' : undefined}
              onChange={() => onKind(k)}
            />
            <span>{KINDS[k].label}</span>
          </label>
        ))}
        {kindLocked && (
          <p id="kind-lock-hint" className="kind-lock-hint">
            {KIND_LOCK_HINT}
          </p>
        )}
      </fieldset>

      <span className="divider" aria-hidden="true" />

      <fieldset className="kinds">
        <legend className="visually-hidden">Detail level</legend>
        {(['overview', 'detailed'] as const).map((m) => (
          <label key={m} className="kind">
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => onMode(m)} />
            <span>{m === 'overview' ? 'Overview' : 'Detailed'}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className="text-button" aria-pressed={guides} title="Show the dashed guide spokes" onClick={() => onGuides(!guides)}>
        Guides
      </button>
      <button type="button" className="text-button" aria-pressed={highlight} title="Highlight the layer under the pointer" onClick={() => onHighlight(!highlight)}>
        Highlight
      </button>

      <span className="divider" aria-hidden="true" />

      <button type="button" className="tool" aria-label="New diagram" title="New diagram" onClick={onNew}>
        <Icon name="new" />
        <span className="tool-text">New</span>
      </button>
      <label className="tool example-picker" title="Load an example">
        <Icon name="example" />
        <span className="tool-text">Example</span>
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
      <label className="tool" title="Import a .hexa file">
        <input
          type="file"
          accept=".hexa,application/json"
          className="visually-hidden"
          aria-label="Import a .hexa file"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) onImport(file)
            e.currentTarget.value = ''
          }}
        />
        <Icon name="upload" />
        <span className="tool-text">Import</span>
      </label>

      <span className="divider" aria-hidden="true" />

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

      <span className="export">
        <span id="export-label" className="export-label">
          Export
        </span>
        <span className="segmented" role="group" aria-labelledby="export-label">
          <button type="button" className="text-button" aria-label="Save as .hexa file" onClick={() => onExport('hexa')}>.hexa</button>
          <button type="button" className="text-button" aria-label="Export as SVG" onClick={() => onExport('svg')}>SVG</button>
          <button type="button" className="text-button" aria-label="Export as PNG" onClick={() => onExport('png')}>PNG</button>
        </span>
      </span>

      <span className="divider" aria-hidden="true" />

      <button
        type="button"
        className="icon-button"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title="Toggle theme"
        onClick={onTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <a className="icon-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View the source on GitHub" title="Source on GitHub">
        <Icon name="code" />
      </a>
    </header>
  )
}
