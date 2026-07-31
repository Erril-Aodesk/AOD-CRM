import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldValue } from '../components/DynamicField'
import Spinner from '../components/Spinner'
import Modal from '../components/Modal'
import { Plus, Search, Trash2, Check, List, LayoutGrid } from 'lucide-react'

export default function RecordList() {
  const { objectTypeId } = useParams()
  const { objectTypes, fields, perms, profile } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [deleteAll, setDeleteAll] = useState(false)
  const [toast, setToast] = useState('')
  const [view, setView] = useState('list')

  const ot = objectTypes.find(o => o.id === objectTypeId)
  const cols = useMemo(() =>
    fields.filter(f => f.object_type_id === objectTypeId && f.show_in_list !== false && perms?.fieldVisible(f.id))
          .sort((a, b) => a.sort_order - b.sort_order),
    [fields, objectTypeId, perms])
  const statusField = fields.find(f => f.object_type_id === objectTypeId && f.is_status_field)
  const callbackField = fields.find(f => f.object_type_id === objectTypeId && f.key === 'callback_date_time')
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

  const saveField = async (record, field, value) => {
    const newData = { ...record.data, [field.key]: value }
    const { error } = await supabase.from('records').update({ data: newData }).eq('id', record.id)
    if (error) { alert(error.message); return false }
    setRows(rs => rs.map(r => r.id === record.id ? { ...r, data: newData } : r))
    return true
  }

  const create = async () => {
    const { data, error } = await supabase.from('records')
      .insert({ object_type_id: objectTypeId, data: {},
                owner_id: ot.default_agent_id || profile.id,
                org_id: ot.org_id }).select().single()
    if (!error && data) nav(`/records/${objectTypeId}/${data.id}`)
    else alert(error?.message)
  }

  if (!ot) return <p className="text-muted">Record type not found or no access.</p>
  if (rows === null) return <Spinner label={`Loading ${ot.name}…`} />

  const filtered = q
    ? rows.filter(r => JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()))
    : rows

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
            <button className="btn-primary" onClick={create}><Plus size={16} /> New</button>}
          {perms?.isAdmin &&
            <button className="btn-ghost text-danger" onClick={() => setDeleteAll(true)}>
              <Trash2 size={16} /> Delete all
            </button>}
        </div>
      </div>

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
            <table className="w-full min-w-[640px]">
              <thead><tr>{cols.map(c => <th key={c.id} className="th">{c.label}</th>)}</tr></thead>
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
                      return <td key={c.id} className="td"><FieldValue field={c} value={r.data[c.key]} /></td>
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
              <button key={r.id} className="card w-full p-4 text-left" onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}>
                {cols.slice(0, 4).map(c => (
                  <div key={c.id} className="flex justify-between gap-3 py-0.5 text-sm">
                    <span className="text-muted">{c.label}</span>
                    <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                  </div>
                ))}
              </button>
            ))}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">No records yet.</p>}
          </div>
        </>
      )}

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
                <button key={r.id}
                  className={`card w-full p-3 text-left transition-shadow hover:shadow-pop ${today ? 'border-warn ring-1 ring-warn/40' : ''}`}
                  onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}>
                  {today && <span className="mb-1.5 inline-block rounded-full bg-warn px-2 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                  {cols.map(c => (
                    <div key={c.id} className="flex justify-between gap-3 py-0.5 text-xs">
                      <span className="text-muted">{c.label}</span>
                      <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                    </div>
                  ))}
                </button>
              )
            })}
            {col.records.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted">No records</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
