import { useEffect, useMemo } from 'react'
import { flowOf, type FlowRole } from '../model/flow'
import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { threadSlots } from '../model/threads'
import { threadStyle } from '../render/ThreadDots'
import { Icon } from './Icon'
import { typing } from './keys'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const ROLE: Record<FlowRole, string> = {
  actor: 'actor',
  adapter: 'adapter',
  drivingPort: 'driving port',
  useCase: 'use case',
  aggregate: 'aggregate',
  drivenPort: 'driven port',
  drivenAdapter: 'adapter',
  external: 'external',
  linkedPort: 'linked port',
}

/** The flow being walked through and its current step; null while not presenting. */
export function usePresentation() {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const useCaseId = useViewStore((s) => s.focusedFlow)
  const presentStep = useViewStore((s) => s.presentStep)
  return useMemo(() => {
    const diagram = diagramOf(map, hexId)
    const useCase = useCaseId && presentStep !== null ? diagram.useCases.find((u) => u.id === useCaseId) : undefined
    if (!useCase) return null
    const flow = flowOf(map, hexId, useCase.id)
    const index = Math.min(presentStep!, flow.steps.length - 1)
    return { flow, name: useCase.name, index, step: flow.steps[index], style: threadStyle(threadSlots(diagram).get(useCase.id)!) }
  }, [map, hexId, useCaseId, presentStep])
}

const { focusFlow, present } = useViewStore.getState()

/** View mode's sidebar while walking through one flow, step by step. */
export function PresentPanel() {
  const presenting = usePresentation()
  const count = presenting?.flow.steps.length ?? 0
  const index = presenting?.index ?? 0
  useEffect(() => {
    if (!presenting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') return present(null)
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') present(Math.min(index + 1, count - 1))
      if (e.key === 'ArrowLeft') present(Math.max(index - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [presenting, index, count])
  if (!presenting) return null
  const { flow, name, style } = presenting

  return (
    <aside className="island editor flows-panel present-panel" aria-label="Present" style={style}>
      <header className="editor-head">
        <button type="button" className="text-button" onClick={() => focusFlow(null)}>
          ← All flows
        </button>
        <button type="button" className="text-button" title="Stop presenting, keep this flow (Esc)" onClick={() => present(null)}>
          Exit
        </button>
      </header>
      <div className="editor-body">
        <h2 className="present-title">{name}</h2>
        {flow.description && <p className="present-description">{flow.description}</p>}
        <ol className="present-steps">
          {flow.steps.map((step, i) => (
            <li key={`${step.hexId}:${step.id}:${i}`} aria-current={i === index ? 'step' : undefined}>
              <button type="button" onClick={() => present(i)}>
                <span className="present-no">{i + 1}</span>
                <span className="present-name">{step.name}</span>
                <span className="present-tag">{ROLE[step.role]}</span>
                {(step.verb ?? step.useCaseName) && <span className="present-detail">{step.verb ?? step.useCaseName}</span>}
              </button>
              {i === index && step.note && <p className="present-note">{step.note}</p>}
            </li>
          ))}
        </ol>
      </div>
      <footer className="present-foot">
        <button type="button" className="text-button" disabled={index === 0} onClick={() => present(index - 1)}>
          ← Back
        </button>
        {index === count - 1 ? (
          <button type="button" className="text-button primary" onClick={() => present(null)}>
            Done
          </button>
        ) : (
          <button type="button" className="text-button primary" onClick={() => present(index + 1)}>
            Next →
          </button>
        )}
        <p>Step {index + 1} of {count} · ← → move · Esc exits</p>
      </footer>
    </aside>
  )
}

/** The current step named over the canvas. */
export function StepCard() {
  const presenting = usePresentation()
  if (!presenting) return null
  const { step, index, style } = presenting
  return (
    <aside className="island step-card" aria-live="polite" style={style}>
      <p className="step-card-kicker">STEP {index + 1} · {ROLE[step.role].toUpperCase()}</p>
      <p className="step-card-name">{step.name}</p>
      {step.note && <p className="step-card-note">{step.note}</p>}
    </aside>
  )
}

/** Starts the walkthrough of the focused flow, or of the first one the Flows panel lists when none is focused. */
export function PresentButton() {
  const viewOnly = usePreferencesStore((s) => s.viewOnly)
  const map = useMapStore((s) => s.map)
  const focused = useViewStore((s) => s.focusedFlow)
  const presenting = useViewStore((s) => s.presentStep !== null)
  const first = map.hexagons.find((h) => h.useCases.length > 0)
  if (!viewOnly || presenting || !first) return null
  return (
    <button
      type="button"
      className="text-button primary"
      onClick={() => {
        if (!focused) useMapStore.getState().setFocus(first.id)
        focusFlow(focused ?? first.useCases[0].id)
        present(0)
      }}
    >
      <Icon name="play" /> Present
    </button>
  )
}
