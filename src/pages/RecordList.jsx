import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldValue, FieldInput, PhoneCopyButton, coerceDefaultValue } from '../components/DynamicField'
import Spinner from '../components/Spinner'
import Modal from '../components/Modal'
import { Plus, Search, Trash2, Check, List, LayoutGrid } from 'lucide-react'

const MIN_COL_WIDTH = 90
const DEFAULT_COL_WIDTH = 160

export default function RecordList() {
  const { objectTypeId } = useParams()
  const { objectTypes, fields, perms, profile } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [deleteAll, setDeleteAll] = useState(false)
  const [toast, setToast] = useState('')
  const [view, setView] = useState('list')
  const [creating, setCreating] = useState(false)
  const [filterValues, setFilterValues] = useState({})
  const [colWidths, setColWidths] = useState({})

  const ot = objectTypes.find(o => o.id === objectTypeId)
  const cols = useMemo(() =>
    fields.filter(f => f.object_type_id === objectTypeId && f.show_in_list !== false &&
      // The status field drives Kanban grouping and the filter bar regardless of a
      // role's field-view override (see statusField/filterableFields below) — keep
      // the List view's column set consistent with that instead of hiding it.
      (f.is_status_field || perms?.fieldVisible(f.id)))
          .sort((a, b) => a.sort_order - b.sort_order),
    [fields, objectTypeId, perms])
  const statusField = fields.find(f => f.object_type_id === objectTypeId && f.is_status_field)
  const callbackField = fields.find(f => f.object_type_id === objectTypeId && f.key === 'callback_date_time')
  const filterableFields = fields.filter(f =>
    f.object_type_id === objectTypeId && perms?.fieldVisible(f.id) &&
    (f.field_type === 'select' || f.is_status_field || f.key?.toLowerCase() === 'industry' || f.label?.toLowerCase() === 'industry')
  ).sort((a, b) => a.sort_order - b.sort_order)

  const fieldValues = (r, field) => {
    const v = r.data[field.key]
    if (v === null || v === undefined || v === '') return []
    return Array.isArray(v) ? v : [v]
  }
  const filterOptions = (field) => {
    const set = new Set()
    rows?.forEach(r => fieldValues(r, field).forEach(v => set.add(v)))
    return [...set].sort()
  }
  const activeFilterCount = filterableFields.filter(f => filterValues[f.id]).length
  const isRecordToday = (r) => {
    if (!callbackField) return false
    const raw = r.data[callbackField.key]
    if (!raw) return false
    const d = new Date(raw)
    if (isNaN(d)) return false
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }
  const byPriority = (a, b) => (isRecordToday(b) ? 1 : 0) - (isRecordToday(a) ? 1 : 0)

  const loadRows = () =>
    supabase.from('records').select('*').eq('object_type_id', objectTypeId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))

  useEffect(() => {
    setRows(null)
    loadRows()
  }, [objectTypeId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleDeletedAll = (count) => {
    setDeleteAll(false)
    setToast(`Deleted ${count} record${count === 1 ? '' : 's'}`)
    loadRows()
  }

  const widthOf = (fieldId) => colWidths[fieldId] ?? DEFAULT_COL_WIDTH

  const startResize = (e, fieldId) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = widthOf(fieldId)
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
      setColWidths(w => ({ ...w, [fieldId]: next }))
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const saveField = async (record, field, value) => {
    const newData = { ...record.data, [field.key]: value }
    const { error } = await supabase.from('records').update({ data: newData }).eq('id', record.id)
    if (error) { alert(error.message); return false }
    setRows(rs => rs.map(r => r.id === record.id ? { ...r, data: newData } : r))
    return true
  }

  if (!ot) return <p className="text-muted">Record type not found or no access.</p>
  if (rows === null) return <Spinner label={`Loading ${ot.name}…`} />

  const filtered = (q
    ? rows.filter(r => JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()))
    : rows
  ).filter(r => filterableFields.every(f => {
    const sel = filterValues[f.id]
    return !sel || fieldValues(r, f).includes(sel)
  }))

  const statusOptions = statusField?.options || []
  const kanbanColumns = statusField
    ? [...statusOptions.map(o => ({ key: o, label: o, records: filtered.filter(r => r.data[statusField.key] === o).sort(byPriority) })),
       { key: '__none', label: '—', records: filtered.filter(r => !statusOptions.includes(r.data[statusField.key])).sort(byPriority) }]
    : null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{ot.name}</h1>
        <span className="chip bg-brand-soft text-brand-dark">{rows.length}</span>
        <div className="inline-flex rounded-lg border border-line p-0.5">
          <button className={`rounded-md px-2.5 py-1.5 ${view === 'list' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            title="List view" onClick={() => setView('list')}><List size={15} /></button>
          <button className={`rounded-md px-2.5 py-1.5 ${view === 'kanban' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            title="Kanban view" onClick={() => setView('kanban')}><LayoutGrid size={15} /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
            <input className="input pl-8 w-44 sm:w-56" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {perms?.canCreate(objectTypeId) &&
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New</button>}
          {perms?.isAdmin &&
            <button className="btn-ghost text-danger" onClick={() => setDeleteAll(true)}>
              <Trash2 size={16} /> Delete all
            </button>}
        </div>
      </div>

      {filterableFields.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {filterableFields.map(f => (
            <select key={f.id} className="input w-auto min-w-[140px]" value={filterValues[f.id] || ''}
              onChange={e => setFilterValues(v => ({ ...v, [f.id]: e.target.value }))}>
              <option value="">{f.label}: All</option>
              {filterOptions(f).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {activeFilterCount > 0 &&
            <button className="btn-ghost text-sm" onClick={() => setFilterValues({})}>Clear filters</button>}
        </div>
      )}

      {view === 'kanban' ? (
        statusField ? (
          <KanbanBoard columns={kanbanColumns} cols={cols.slice(0, 3)} objectTypeId={objectTypeId} nav={nav} isToday={isRecordToday} />
        ) : (
          <div className="card p-8 text-center text-sm text-muted">
            No status field is set for {ot.name}. Mark one as the status field in Record types to use Kanban view.
          </div>
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto sm:block">
            <table style={{ tableLayout: 'fixed', width: cols.reduce((sum, c) => sum + widthOf(c.id), 0), minWidth: '100%' }}>
              <colgroup>{cols.map(c => <col key={c.id} style={{ width: widthOf(c.id) }} />)}</colgroup>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c.id} className="th relative select-none">
                      <span className="block truncate pr-2">{c.label}</span>
                      <div onMouseDown={e => startResize(e, c.id)}
                        className="absolute inset-y-0 right-0 w-2 cursor-col-resize hover:bg-brand/40" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="cursor-pointer hover:bg-black/[.02]"
                      onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}>
                    {cols.map(c => {
                      const editable = perms?.canEdit(objectTypeId) && perms?.fieldEditable(c.id)
                      if (editable && c.is_status_field) {
                        return <td key={c.id} className="td">
                          <StatusCell field={c} value={r.data[c.key]} onSave={v => saveField(r, c, v)} />
                        </td>
                      }
                      if (editable && c.key === 'notes') {
                        return <td key={c.id} className="td">
                          <NotesCell field={c} value={r.data[c.key]} onSave={v => saveField(r, c, v)} />
                        </td>
                      }
                      if (editable && c.key === 'callback_date_time') {
                        return <td key={c.id} className="td">
                          <DateTimeCell value={r.data[c.key]} onSave={v => saveField(r, c, v)} />
                        </td>
                      }
                      return <td key={c.id} className="td break-words"><FieldValue field={c} value={r.data[c.key]} /></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted">No records yet. Create one or import from Excel.</p>}
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {filtered.map(r => (
              <div key={r.id} role="button" tabIndex={0} className="card w-full cursor-pointer p-4 text-left"
                onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}
                onKeyDown={e => { if (e.key === 'Enter') nav(`/records/${objectTypeId}/${r.id}`) }}>
                {cols.slice(0, 4).map(c => (
                  <div key={c.id} className="flex justify-between gap-3 py-0.5 text-sm">
                    <span className="text-muted">{c.label}</span>
                    <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                  </div>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">No records yet.</p>}
          </div>
        </>
      )}

      {creating &&
        <NewRecordModal ot={ot} fields={fields} perms={perms} profile={profile}
          onClose={() => setCreating(false)}
          onCreated={rec => nav(`/records/${objectTypeId}/${rec.id}`)} />}

      {deleteAll &&
        <DeleteAllModal objectTypeId={objectTypeId} typeName={ot.name}
          onClose={() => setDeleteAll(false)} onDeleted={handleDeletedAll} />}

      {toast &&
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-ok px-4 py-2.5 text-sm font-medium text-white shadow-pop">
          {toast}
        </div>}
    </div>
  )
}

const isEmptyValue = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

function NewRecordModal({ ot, fields, perms, profile, onClose, onCreated }) {
  const defs = fields.filter(f => f.object_type_id === ot.id && perms?.fieldVisible(f.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  const [data, setData] = useState(() => {
    const initial = {}
    defs.forEach(f => {
      const dv = coerceDefaultValue(f)
      if (dv !== undefined) initial[f.key] = dv
    })
    return initial
  })
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const missing = defs.filter(f => f.is_required && isEmptyValue(data[f.key]))

  const save = async () => {
    if (missing.length > 0) { setAttempted(true); return }
    setSaving(true)
    const { data: rec, error } = await supabase.from('records')
      .insert({ object_type_id: ot.id, data,
                owner_id: ot.default_agent_id || profile.id,
                org_id: ot.org_id }).select().single()
    setSaving(false)
    if (error) return alert(error.message)
    onCreated(rec)
  }

  return (
    <Modal title={`New ${ot.name}`} onClose={onClose} wide
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="space-y-3">
        {attempted && missing.length > 0 && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Please fill in: {missing.map(f => f.label).join(', ')}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {defs.map(f => {
            const editable = perms?.fieldEditable(f.id)
            const isMissing = attempted && f.is_required && isEmptyValue(data[f.key])
            return (
              <div key={f.id} className={f.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label">{f.label}{f.is_required && <span className="text-danger"> *</span>}</label>
                {f.field_type === 'phone' ? (
                  <div className="flex items-center gap-2">
                    <FieldInput field={f} value={data[f.key]} disabled={!editable}
                      onChange={v => setData(d => ({ ...d, [f.key]: v }))} />
                    <PhoneCopyButton value={data[f.key]} />
                  </div>
                ) : (
                  <FieldInput field={f} value={data[f.key]} disabled={!editable}
                    onChange={v => setData(d => ({ ...d, [f.key]: v }))} />
                )}
                {isMissing && <p className="mt-1 text-xs text-danger">Required</p>}
              </div>
            )
          })}
          {defs.length === 0 && <p className="text-sm text-muted sm:col-span-2">No fields defined yet for this record type.</p>}
        </div>
      </div>
    </Modal>
  )
}

function DeleteAllModal({ objectTypeId, typeName, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    const { error, count } = await supabase.from('records')
      .delete({ count: 'exact' }).eq('object_type_id', objectTypeId)
    setDeleting(false)
    if (error) return alert(error.message)
    onDeleted(count ?? 0)
  }

  return (
    <Modal title={`Delete all "${typeName}" records`} onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-danger" disabled={confirmText !== typeName || deleting} onClick={remove}>
          {deleting ? 'Deleting…' : 'Delete all'}
        </button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          This permanently deletes every record of type <strong>{typeName}</strong>. This cannot be undone.
        </p>
        <div>
          <label className="label">Type "{typeName}" to confirm</label>
          <input className="input" value={confirmText} onChange={e => setConfirmText(e.target.value)}
            placeholder={typeName} />
        </div>
      </div>
    </Modal>
  )
}

function StatusCell({ field, value, onSave }) {
  const [saved, setSaved] = useState(false)

  const change = async (e) => {
    const ok = await onSave(e.target.value)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <select className="input !h-8 !py-1 text-sm" value={value ?? ''} onChange={change}>
        <option value="">—</option>
        {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function NotesCell({ field, value, onSave }) {
  const [text, setText] = useState(value ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setText(value ?? '') }, [value])

  const commit = async () => {
    if (text === (value ?? '')) return
    const ok = await onSave(text)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input className="input !h-8 !py-1 text-sm" value={text}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} />
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function DateTimeCell({ value, onSave }) {
  const [val, setVal] = useState(value ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setVal(value ?? '') }, [value])

  const commit = async () => {
    if (val === (value ?? '')) return
    const ok = await onSave(val)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input type="datetime-local" className="input !h-8 !py-1 text-sm" value={val}
        onChange={e => setVal(e.target.value)} onBlur={commit} />
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function KanbanBoard({ columns, cols, objectTypeId, nav, isToday }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map(col => (
        <div key={col.key} className="w-72 shrink-0">
          <div className="mb-2 flex items-center gap-2 px-1">
            <h3 className="text-sm font-semibold">{col.label}</h3>
            <span className="chip bg-brand-soft text-brand-dark">{col.records.length}</span>
          </div>
          <div className="space-y-2">
            {col.records.map(r => {
              const today = isToday(r)
              return (
                <div key={r.id} role="button" tabIndex={0}
                  className={`card w-full cursor-pointer p-3 text-left transition-shadow hover:shadow-pop ${today ? 'border-warn ring-1 ring-warn/40' : ''}`}
                  onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') nav(`/records/${objectTypeId}/${r.id}`) }}>
                  {today && <span className="mb-1.5 inline-block rounded-full bg-warn px-2 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                  {cols.map(c => (
                    <div key={c.id} className="flex justify-between gap-3 py-0.5 text-xs">
                      <span className="text-muted">{c.label}</span>
                      <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                    </div>
                  ))}
                </div>
              )
            })}
            {col.records.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted">No records</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
