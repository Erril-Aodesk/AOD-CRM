import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'
import { ChevronDown, ChevronRight } from 'lucide-react'

const SCOPES = [
  { v: 'own', label: 'Own only' },
  { v: 'assigned_and_unassigned', label: 'Own + unassigned' },
  { v: 'all', label: 'All records' }
]

export default function Permissions() {
  const { objectTypes, fields, profile } = useAuth()
  const [roles, setRoles] = useState([])
  const [roleId, setRoleId] = useState('')
  const [objPerms, setObjPerms] = useState({})   // object_type_id -> perm row
  const [fieldPerms, setFieldPerms] = useState({}) // field_id -> perm row
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('roles').select('*').order('is_admin', { ascending: false }).then(({ data }) => {
      const list = data || []
      setRoles(list)
      const firstNonAdmin = list.find(r => !r.is_admin)
      setRoleId(firstNonAdmin?.id || list[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    if (!roleId) return
    setLoading(true)
    Promise.all([
      supabase.from('role_object_permissions').select('*').eq('role_id', roleId),
      supabase.from('role_field_permissions').select('*').eq('role_id', roleId)
    ]).then(([{ data: op }, { data: fp }]) => {
      setObjPerms(Object.fromEntries((op||[]).map(p => [p.object_type_id, p])))
      setFieldPerms(Object.fromEntries((fp||[]).map(p => [p.field_definition_id, p])))
      setLoading(false)
    })
  }, [roleId])

  const role = roles.find(r => r.id === roleId)
  const isAdminRole = role?.is_admin

  const saveObj = async (otId, patch) => {
    const base = objPerms[otId] || { role_id: roleId, org_id: profile.org_id, object_type_id: otId,
      can_view:false, can_create:false, can_edit:false, can_delete:false, scope:'own' }
    const row = { ...base, ...patch }
    setObjPerms(p => ({ ...p, [otId]: row }))
    await supabase.from('role_object_permissions').upsert(row, { onConflict: 'role_id,object_type_id' })
  }

  const saveField = async (fid, patch) => {
    const base = fieldPerms[fid] || { role_id: roleId, org_id: profile.org_id,
      field_definition_id: fid, can_view: true, can_edit: false }
    const row = { ...base, ...patch }
    setFieldPerms(p => ({ ...p, [fid]: row }))
    await supabase.from('role_field_permissions').upsert(row, { onConflict: 'role_id,field_definition_id' })
  }

  const Check = ({ on, onChange, disabled }) => (
    <input type="checkbox" className="h-4 w-4 accent-brand disabled:opacity-40"
      checked={!!on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
  )

  return (
    <div>
      <h1 className="text-xl font-semibold">Permissions</h1>
      <p className="mt-1 text-sm text-muted">Control what each role can see and do. Super Admin always has full access.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {roles.map(r => (
          <button key={r.id} onClick={() => setRoleId(r.id)}
            className={`chip border px-3 py-1.5 ${roleId === r.id ? 'bg-brand text-white border-brand' : 'border-line text-ink hover:bg-black/5'}`}>
            {r.name}
          </button>
        ))}
      </div>

      {isAdminRole ? (
        <div className="card mt-5 p-8 text-center text-sm text-muted">
          Super Admin has unrestricted access to every record type and field. Nothing to configure.
        </div>
      ) : loading ? <Spinner /> : (
        <div className="card mt-5 divide-y divide-line">
          {objectTypes.length === 0 && <p className="p-6 text-sm text-muted">Create a record type first.</p>}
          {objectTypes.map(ot => {
            const p = objPerms[ot.id] || {}
            const defs = fields.filter(f => f.object_type_id === ot.id)
            const open = expanded === ot.id
            return (
              <div key={ot.id} className="p-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <button className="flex items-center gap-1 font-medium" onClick={() => setExpanded(open ? null : ot.id)}>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {ot.name}
                  </button>
                  <div className="flex items-center gap-4 text-sm text-muted">
                    <label className="flex items-center gap-1.5"><Check on={p.can_view} onChange={v => saveObj(ot.id, { can_view: v })} /> View</label>
                    <label className="flex items-center gap-1.5"><Check on={p.can_create} onChange={v => saveObj(ot.id, { can_create: v })} /> Create</label>
                    <label className="flex items-center gap-1.5"><Check on={p.can_edit} onChange={v => saveObj(ot.id, { can_edit: v })} /> Edit</label>
                    <label className="flex items-center gap-1.5"><Check on={p.can_delete} onChange={v => saveObj(ot.id, { can_delete: v })} /> Delete</label>
                  </div>
                  <select className="input ml-auto w-44" value={p.scope || 'own'} onChange={e => saveObj(ot.id, { scope: e.target.value })}>
                    {SCOPES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>

                {open && (
                  <div className="mt-3 rounded-lg border border-line">
                    <table className="w-full">
                      <thead><tr><th className="th">Field</th><th className="th w-24">Visible</th><th className="th w-24">Editable</th></tr></thead>
                      <tbody>
                        {defs.map(f => {
                          const fp = fieldPerms[f.id] || { can_view: true, can_edit: false }
                          return (
                            <tr key={f.id}>
                              <td className="td">{f.label}</td>
                              <td className="td"><Check on={fp.can_view} onChange={v => saveField(f.id, { can_view: v })} /></td>
                              <td className="td"><Check on={fp.can_edit} disabled={!fp.can_view} onChange={v => saveField(f.id, { can_edit: v })} /></td>
                            </tr>
                          )
                        })}
                        {defs.length === 0 && <tr><td className="td text-muted" colSpan={3}>No fields defined.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
