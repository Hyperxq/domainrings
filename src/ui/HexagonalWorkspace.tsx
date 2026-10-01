import type { ComponentProps } from 'react'
import { usePreferencesStore } from './state/preferencesStore'
import { contextName } from '../model/map'
import { Editor } from './Editor'
import { Legend } from './Legend'
import { Stage } from './Stage'
import { useHexagonalCommands } from './useHexagonalCommands'

type CommandsContext = Parameters<typeof useHexagonalCommands>[0]
type StageProps = ComponentProps<typeof Stage>

type HexagonalWorkspaceProps = Omit<StageProps, 'contextLabel' | 'onDelete' | 'onLink' | 'onGrow'> &
  CommandsContext & {
  }

/** Editor, legend and stage for a Hexagonal map, wired to the edit commands that toast an undoable step. */
export function HexagonalWorkspace({ nameOf, parseFile, ...stage }: HexagonalWorkspaceProps) {
  const { map, hexId, diagram } = stage
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  const commands = useHexagonalCommands({ map, hexId, diagram, nameOf, parseFile })
  const contextLabel = contextName(map, map.hexagons.find((h) => h.id === hexId)!.contextId)
  return (
    <>
      {!viewOnly && (
        <Editor
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
      )}
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
