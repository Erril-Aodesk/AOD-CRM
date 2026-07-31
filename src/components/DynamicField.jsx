// Renders the correct input for a field definition, or a read-only value.
export function FieldInput({ field, value, onChange, disabled }) {
  const v = value ?? ''
  const common = 'input'
  switch (field.field_type) {
    case 'textarea':
      return <textarea className={common} rows={3} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
    case 'number':
    case 'currency':
      return <input type="number" className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'date':
      return <input type="date" className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
    case 'datetime':
      return <input type="datetime-local" className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
    case 'boolean':
      return <input type="checkbox" className="h-4 w-4 accent-brand" checked={!!value} disabled={disabled}
               onChange={e => onChange(e.target.checked)} />
    case 'email':
      return <input type="email" className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
    case 'phone':
      return <input type="tel" className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
    case 'select':
      return (
        <select className={common} value={v} disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multiselect':
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options || []).map(o => {
            const arr = Array.isArray(value) ? value : []
            const on = arr.includes(o)
            return (
              <button key={o} type="button" disabled={disabled}
                className={`chip border ${on ? 'bg-brand-soft border-brand text-brand-dark' : 'border-line text-muted'}`}
                onClick={() => onChange(on ? arr.filter(x => x !== o) : [...arr, o])}>
                {o}
              </button>
            )
          })}
        </div>
      )
    default:
      return <input className={common} value={v} disabled={disabled}
               onChange={e => onChange(e.target.value)} />
  }
}

export function FieldValue({ field, value }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted/60">—</span>
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (field.field_type === 'multiselect' && Array.isArray(value)) return value.join(', ')
  if (field.field_type === 'currency') return typeof value === 'number' ? value.toLocaleString(undefined,{style:'currency',currency:'USD'}) : value
  return String(value)
}
