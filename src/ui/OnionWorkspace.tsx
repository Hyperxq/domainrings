import type { Ref } from 'react'
import type { OnionLayoutModel } from '../layout/onion'
import type { OnionFile } from '../model/schema'
import type { LegendModel } from '../layout/legend'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'
import { Legend } from './Legend'
import { OnionEditor } from './OnionEditor'
import { OnionStage } from './OnionStage'

interface OnionWorkspaceProps {
  legend: LegendModel
  model: OnionLayoutModel
  doc: OnionFile
  svgRef: Ref<SVGSVGElement>
  onReject: (message: string) => void
  onMutate: (message: string, before: OnionFile) => void
  onNamed: () => void
  onCancelMutate: () => void
}

export function OnionWorkspace({ legend, model, doc, svgRef, onReject, onMutate, onNamed, onCancelMutate }: OnionWorkspaceProps) {
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  const editorOpen = useViewStore((s) => s.editorOpen) && !viewOnly
  const mode = usePreferencesStore((s) => s.mode)
  const legendOpen = usePreferencesStore((s) => s.legendOpen)
  return (
    <>
      {!viewOnly && <OnionEditor open={editorOpen} onToggle={() => useViewStore.setState({ editorOpen: !editorOpen })} onMutate={onMutate} />}
      <Legend legend={legend} />
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
        legendOpen={legendOpen}
      />
    </>
  )
}
