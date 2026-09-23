import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { KINDS } from '../model/kinds'
import { KindSchema, type ArchitectureKind } from '../model/schema'
import { Icon } from './Icon'

interface ToolbarProps {
  kind: ArchitectureKind
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
}

export function Toolbar({ kind, theme, onKind, onNew, onExample, onImport, onExport, onTheme, mode, onMode, guides, onGuides, highlight, onHighlight }: ToolbarProps) {
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      <fieldset className="kinds">
        <legend className="visually-hidden">Architecture style</legend>
        {KindSchema.options.map((k) => (
          <label key={k} className="kind">
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => onKind(k)} />
            <span>{KINDS[k].label}</span>
          </label>
        ))}
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

      <button type="button" className="icon-button" aria-label="New diagram" title="New diagram" onClick={onNew}>
        <Icon name="new" />
      </button>
      <label className="icon-button example-picker" title="Load an example">
        <Icon name="example" />
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
      <label className="icon-button" title="Open a .hexa file">
        <input
          type="file"
          accept=".hexa,application/json"
          className="visually-hidden"
          aria-label="Open a .hexa file"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) onImport(file)
            e.currentTarget.value = ''
          }}
        />
        <Icon name="open" />
      </label>

      <span className="divider" aria-hidden="true" />

      <span className="export" role="group" aria-label="Export">
        <Icon name="download" />
        <button type="button" className="text-button" aria-label="Save as .hexa file" onClick={() => onExport('hexa')}>.hexa</button>
        <button type="button" className="text-button" aria-label="Export as SVG" onClick={() => onExport('svg')}>SVG</button>
        <button type="button" className="text-button" aria-label="Export as PNG" onClick={() => onExport('png')}>PNG</button>
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
    </header>
  )
}
