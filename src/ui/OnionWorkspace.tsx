import type { Ref } from 'react'
import type { LayoutMode } from '../layout/layout'
import type { OnionLayoutModel } from '../layout/onion'
import type { OnionFile } from '../model/schema'
import { Legend, type LegendProps } from './Legend'
import { OnionEditor } from './OnionEditor'
import { OnionStage } from './OnionStage'

interface OnionWorkspaceProps {
  editorOpen: boolean
  onToggleEditor: () => void
  legendPanel: LegendProps
  model: OnionLayoutModel
  doc: OnionFile
  mode: LayoutMode
  svgRef: Ref<SVGSVGElement>
  onReject: (message: string) => void
  onMutate: (message: string, before: OnionFile) => void
  onNamed: () => void
  onCancelMutate: () => void
}

export function OnionWorkspace({ editorOpen, onToggleEditor, legendPanel, model, doc, mode, svgRef, onReject, onMutate, onNamed, onCancelMutate }: OnionWorkspaceProps) {
  return (
    <>
      <OnionEditor open={editorOpen} onToggle={onToggleEditor} onMutate={onMutate} />
      <Legend {...legendPanel} />
      <OnionStage
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
