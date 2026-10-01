import type { ComponentProps } from 'react'
import { contextName } from '../model/map'
import { Editor } from './Editor'
import type { FieldSession } from './editor/fieldSession'
import { Legend, type LegendProps } from './Legend'
import { Stage } from './Stage'
import { useHexagonalCommands } from './useHexagonalCommands'

type CommandsContext = Parameters<typeof useHexagonalCommands>[0]
type StageProps = ComponentProps<typeof Stage>

type HexagonalWorkspaceProps = Omit<StageProps, 'legend' | 'legendOpen' | 'panelOpen' | 'contextLabel' | 'onDelete' | 'onLink' | 'onGrow'> &
  CommandsContext & {
    editorOpen: boolean
    onToggleEditor: () => void
    legendPanel: LegendProps
    fieldSession: FieldSession
  }

/** Editor, legend and stage for a Hexagonal map, wired to the edit commands that toast an undoable step. */
export function HexagonalWorkspace({ editorOpen, onToggleEditor, legendPanel, fieldSession, show, nameOf, setGrowing, setLinking, parseFile, ...stage }: HexagonalWorkspaceProps) {
  const { map, hexId, diagram, onRecord } = stage
  const commands = useHexagonalCommands({ map, hexId, diagram, show, nameOf, setGrowing, setLinking, parseFile })
  const contextLabel = contextName(map, map.hexagons.find((h) => h.id === hexId)!.contextId)
  return (
    <>
      <Editor
        open={editorOpen}
        onToggle={onToggleEditor}
        onPrune={commands.pruneToast}
        onRecord={onRecord}
        fieldSession={fieldSession}
        onAddHexagon={() => commands.completeGrow(undefined, 'same')}
        onDeleteHexagon={commands.handleDelete}
        onMoveToContext={commands.handleMoveToContext}
        onAddFromFile={commands.handleAddFromFile}
        contextLabel={contextLabel}
        onRenameContext={commands.handleRenameContext}
        onCreateLink={commands.createLink}
        onUpdateLink={commands.editLink}
        onDeleteLink={commands.deleteLink}
      />
      <Legend {...legendPanel} />
      <Stage
        {...stage}
        legend={legendPanel.legend}
        panelOpen={editorOpen}
        legendOpen={legendPanel.open}
        contextLabel={contextLabel}
        onDelete={commands.deleteItem}
        onLink={commands.link}
        onGrow={commands.completeGrow}
      />
    </>
  )
}
