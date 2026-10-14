import type { HexaMap, LinkEnd } from '../model/schema'
import { diagramOf, UNTITLED_HEXAGON, type Destination, type LinkPatch } from '../model/map'
import { useMapStore } from '../model/store'
import { useViewStore } from './state/viewStore'
import { FlowsSection } from './FlowsSection'
import { Icon } from './Icon'
import { session } from './editor/fieldSession'
import { CollectionSections } from './editor/CollectionSections'
import { Fold } from './Fold'
import { LinksSection } from './editor/LinksSection'
import { MapSection } from './editor/MapSection'
import { SubdomainSection, type SubdomainActions } from './editor/SubdomainSection'

export function Editor({
  onAddHexagon,
  onDeleteHexagon,
  onMoveToContext,
  onAddFromFile,
  contextLabel,
  onRenameContext,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
}: SubdomainActions & {
  /** Reads the picked file (IMP-01): resolves to the step that finishes the import once the author picks a
   * destination when the file holds one hexagon, or to nothing when it needed no question or was refused. */
  onAddFromFile: (file: File) => Promise<((context: Destination) => void) | undefined>
  /** The current hexagon's own bounded context, for the import menu's "Import into {context}" choice. */
  contextLabel: string
  /** Reports a context rename/clear session (focus → blur) that actually changed the name, with the map from
   * just before it started — the toast/undo snapshot (NAME-03). Not called when a blur never changed anything. */
  onRenameContext: (before: HexaMap, contextId: string) => void
  /** Creates a map-level link from the Links section's own create form — the second of the two entry points
   * ADR-02 requires to share one write path with the canvas "Link to…" chip. */
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void
  /** Patches an existing link's adapter(s) or pattern from its row's edit disclosure (REQ-LNK-02). */
  onUpdateLink: (id: string, patch: LinkPatch) => void
  /** Deletes an existing link from its row (REQ-LNK-04). */
  onDeleteLink: (id: string) => void
}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const d = diagramOf(map, hexId)
  const open = useViewStore((s) => s.editorOpen)

  return (
    <aside className={`island editor${open ? '' : ' is-collapsed'}`} aria-label="Diagram editor">
      <header className="editor-head">
        <h2>{d.title || UNTITLED_HEXAGON}</h2>
        <button type="button" className="icon-button" aria-expanded={open} aria-controls="editor-body" aria-label={open ? 'Collapse editor' : 'Expand editor'} title={open ? 'Collapse editor' : 'Expand editor'} onClick={() => useViewStore.setState({ editorOpen: !open })}>
          <Icon name="panel" />
        </button>
      </header>

      <div id="editor-body" className="editor-body" hidden={!open}>
        <FlowsSection />

        <div data-subdomain={hexId}>
          <h2 className="elements-head">Elements</h2>
          <CollectionSections hexId={hexId} map={map} diagram={d} />
          {map.hexagons.length > 1 && <LinksSection map={map} onCreateLink={onCreateLink} onUpdateLink={onUpdateLink} onDeleteLink={onDeleteLink} />}

          <Fold id="diagram-settings" title="Diagram settings · layers, titles" defaultOpen={false}>
            <MapSection title={map.title} contextLabel={contextLabel} onAddFromFile={onAddFromFile} session={session} />
            <SubdomainSection map={map} hexId={hexId} onRenameContext={onRenameContext} onAddHexagon={onAddHexagon} onDeleteHexagon={onDeleteHexagon} onMoveToContext={onMoveToContext} />
          </Fold>
        </div>
      </div>
    </aside>
  )
}
