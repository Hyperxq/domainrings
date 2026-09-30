interface Option {
  id: string
  name: string
}

export function LinkSelect({ label, value, options, onChange }: { label: string; value?: string; options: Option[]; onChange: (id: string | undefined) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Not linked</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name || 'Unnamed'}</option>
        ))}
      </select>
    </label>
  )
}
