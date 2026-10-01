import type { Ref } from 'react'
import type { LayoutMode } from '../layout/layout'
import type { CleanLayoutModel } from '../layout/clean'
import type { CleanFile } from '../model/schema'
import { Legend, type LegendProps } from './Legend'
import { CleanEditor } from './CleanEditor'
import { CleanStage } from './CleanStage'

interface CleanWorkspaceProps {
  editorOpen: boolean
  onToggleEditor: () => void
  legendPanel: LegendProps
  model: CleanLayoutModel
  doc: CleanFile
  mode: LayoutMode
  svgRef: Ref<SVGSVGElement>
  onReject: (message: string) => void
  onMutate: (message: string, before: CleanFile) => void
  onNamed: () => void
  onCancelMutate: () => void
}

export function CleanWorkspace({ editorOpen, onToggleEditor, legendPanel, model, doc, mode, svgRef, onReject, onMutate, onNamed, onCancelMutate }: CleanWorkspaceProps) {
  return (
    <>
      <CleanEditor open={editorOpen} onToggle={onToggleEditor} onMutate={onMutate} />
      <Legend {...legendPanel} />
      <CleanStage
        model={model}
        doc={doc}
        mode={mode}
        svgRef={svgRef}
        onReject={onReject}
        onMutate={onMutate}
        onNamed={onNamed}
        onCancelMutate={onCancelMutate}
        panelOpen={editorOpen}
        legendOpen={legendPanel.open}
      />
    </>
  )
}
