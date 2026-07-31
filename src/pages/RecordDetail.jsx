import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldInput } from '../components/DynamicField'
import Spinner from '../components/Spinner'
import { Trash2, ArrowLeft, Save } from 'lucide-react'

export default function RecordDetail() {
  const { objectTypeId, recordId } = useParams()
  const { objectTypes, fields, perms } = useAuth()
  const nav = useNavigate()
  const [rec, setRec] = useState(null)
  const [data, setData] = useState({})
  const [saving, setSaving] = useState(false)

  const ot = objectTypes.find(o => o.id === objectTypeId)
  const defs = useMemo(() =>
    fields.filter(f => f.object_type_id === objectTypeId && perms?.fieldVisible(f.id))
          .sort((a, b) => a.sort_order - b.sort_order), [fields, objectTypeId, perms])
  const canEdit = perms?.canEdit(objectTypeId)
  const canAssign = perms?.isManager
  const [users, setUsers] = useState([])

  useEffect(() => {
    supabase.from('records').select('*').eq('id', recordId).single()
      .then(({ data: r }) => { setRec(r); setData(r?.data || {}) })
  }, [recordId])

  useEffect(() => {
    if (!ot?.org_id) return
    supabase.from('profiles').select('id, full_name, email, is_active')
      .eq('org_id', ot.org_id).order('full_name')
      .then(({ data }) => setUsers(data || []))
  }, [ot?.org_id])

  const changeOwner = async (id) => {
    const { error } = await supabase.from('records').update({ owner_id: id || null }).eq('id', recordId)
    if (error) return alert(error.message)
    setRec(r => ({ ...r, owner_id: id || null }))
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('records').update({ data }).eq('id', recordId)
    setSaving(false)
    if (error) alert(error.message); else nav(`/records/${objectTypeId}`)
  }

  const remove = async () => {
    if (!confirm('Delete this record?')) return
    const { error } = await supabase.from('records').delete().eq('id', recordId)
    if (error) alert(error.message); else nav(`/records/${objectTypeId}`)
  }

  if (!ot) return <p className="text-muted">Not found.</p>
  if (rec === null) return <Spinner label="Loading record…" />

  return (
    <div className="mx-auto max-w-2xl">
      <button className="btn-ghost mb-3 -ml-2" onClick={() => nav(`/records/${objectTypeId}`)}>
        <ArrowLeft size={16} /> {ot.name}
      </button>

      <div className="card p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{ot.name} record</h1>
          <div className="ml-auto flex gap-2">
            {perms?.canDelete(objectTypeId) &&
              <button className="btn-ghost text-danger" onClick={remove}><Trash2 size={15} /></button>}
          </div>
        </div>

        <div className="mb-5">
          <label className="label">Assigned to</label>
          {canAssign ? (
            <select className="input max-w-xs" value={rec.owner_id || ''} onChange={e => changeOwner(e.target.value)}>
              <option value="">— Unassigned —</option>
              {users.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          ) : (
            <p className="text-sm">
              {users.find(u => u.id === rec.owner_id)?.full_name || users.find(u => u.id === rec.owner_id)?.email || '—'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {defs.map(f => {
            const editable = canEdit && perms?.fieldEditable(f.id)
            return (
              <div key={f.id} className={f.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label">{f.label}{f.is_required && <span className="text-danger"> *</span>}</label>
                <FieldInput field={f} value={data[f.key]} disabled={!editable}
                  onChange={v => setData(d => ({ ...d, [f.key]: v }))} />
              </div>
            )
          })}
          {defs.length === 0 && <p className="text-sm text-muted sm:col-span-2">No fields defined yet for this record type.</p>}
        </div>

        {canEdit && (
          <div className="mt-6 flex justify-end">
            <button className="btn-primary" disabled={saving} onClick={save}>
              <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
