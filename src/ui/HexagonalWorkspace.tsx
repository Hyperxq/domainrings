import type { ComponentProps } from 'react'
import { contextName } from '../model/map'
import { Editor } from './Editor'
import type { FieldSession } from './editor/fieldSession'
import { Legend } from './Legend'
import { Stage } from './Stage'
import { useViewStore } from './state/viewStore'
import { useHexagonalCommands } from './useHexagonalCommands'

type CommandsContext = Parameters<typeof useHexagonalCommands>[0]
type StageProps = ComponentProps<typeof Stage>

type HexagonalWorkspaceProps = Omit<StageProps, 'contextLabel' | 'onDelete' | 'onLink' | 'onGrow'> &
  CommandsContext & {
    fieldSession: FieldSession
  }

/** Editor, legend and stage for a Hexagonal map, wired to the edit commands that toast an undoable step. */
export function HexagonalWorkspace({ fieldSession, show, nameOf, parseFile, ...stage }: HexagonalWorkspaceProps) {
  const { map, hexId, diagram, onRecord } = stage
  const commands = useHexagonalCommands({ map, hexId, diagram, show, nameOf, parseFile })
  const editorOpen = useViewStore((s) => s.editorOpen)
  const contextLabel = contextName(map, map.hexagons.find((h) => h.id === hexId)!.contextId)
  return (
    <>
      <Editor
        open={editorOpen}
        onToggle={() => useViewStore.setState({ editorOpen: !editorOpen })}
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
      <Legend legend={stage.legend} />
      <Stage
        {...stage}
        contextLabel={contextLabel}
        onDelete={commands.deleteItem}
        onLink={commands.link}
        onGrow={commands.completeGrow}
      />
    </>
  )
}
