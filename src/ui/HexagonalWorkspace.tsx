import type { ComponentProps } from 'react'
import { Editor } from './Editor'
import { Legend, type LegendProps } from './Legend'
import { Stage } from './Stage'

type EditorProps = ComponentProps<typeof Editor>
type StageProps = ComponentProps<typeof Stage>

type HexagonalWorkspaceProps = Omit<EditorProps, 'open' | 'onToggle'> &
  Omit<StageProps, 'legend' | 'legendOpen' | 'panelOpen'> & {
    editorOpen: boolean
    onToggleEditor: () => void
    legendPanel: LegendProps
  }

export function HexagonalWorkspace({
  editorOpen,
  onToggleEditor,
  legendPanel,
  onPrune,
  onRecord,
  fieldSession,
  onAddHexagon,
  onDeleteHexagon,
  onMoveToContext,
  onAddFromFile,
  contextLabel,
  onRenameContext,
  onCreateLink,
  onUpdateLink,
  onDeleteLink,
  ...stage
}: HexagonalWorkspaceProps) {
  return (
    <>
      <Editor
        open={editorOpen}
        onToggle={onToggleEditor}
        onPrune={onPrune}
        onRecord={onRecord}
        fieldSession={fieldSession}
        onAddHexagon={onAddHexagon}
        onDeleteHexagon={onDeleteHexagon}
        onMoveToContext={onMoveToContext}
        onAddFromFile={onAddFromFile}
        contextLabel={contextLabel}
        onRenameContext={onRenameContext}
        onCreateLink={onCreateLink}
        onUpdateLink={onUpdateLink}
        onDeleteLink={onDeleteLink}
      />
      <Legend {...legendPanel} />
      <Stage {...stage} onRecord={onRecord} contextLabel={contextLabel} legend={legendPanel.legend} panelOpen={editorOpen} legendOpen={legendPanel.open} />
    </>
  )
}
