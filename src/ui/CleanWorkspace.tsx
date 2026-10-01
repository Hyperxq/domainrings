import type { Ref } from 'react'
import type { CleanLayoutModel } from '../layout/clean'
import type { CleanFile } from '../model/schema'
import type { LegendModel } from '../layout/legend'
import { usePreferencesStore } from './state/preferencesStore'
import { Legend } from './Legend'
import { CleanEditor } from './CleanEditor'
import { CleanStage } from './CleanStage'

interface CleanWorkspaceProps {
  editorOpen: boolean
  onToggleEditor: () => void
  legend: LegendModel
  model: CleanLayoutModel
  doc: CleanFile
  svgRef: Ref<SVGSVGElement>
  onReject: (message: string) => void
  onMutate: (message: string, before: CleanFile) => void
  onNamed: () => void
  onCancelMutate: () => void
}

export function CleanWorkspace({ editorOpen, onToggleEditor, legend, model, doc, svgRef, onReject, onMutate, onNamed, onCancelMutate }: CleanWorkspaceProps) {
  const mode = usePreferencesStore((s) => s.mode)
  const legendOpen = usePreferencesStore((s) => s.legendOpen)
  return (
    <>
      <CleanEditor open={editorOpen} onToggle={onToggleEditor} onMutate={onMutate} />
      <Legend legend={legend} />
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
        legendOpen={legendOpen}
      />
    </>
  )
}
