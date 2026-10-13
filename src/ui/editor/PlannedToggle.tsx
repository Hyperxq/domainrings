export function PlannedToggle({ planned, onChange, label }: { planned: boolean; onChange: (planned: boolean) => void; label?: string }) {
  return (
    <label className="planned-toggle">
      <input type="checkbox" aria-label={label} checked={planned} onChange={(e) => onChange(e.target.checked)} />
      <span>Planned</span>
    </label>
  )
}
