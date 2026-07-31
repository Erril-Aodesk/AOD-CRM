import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldValue } from '../components/DynamicField'
import Spinner from '../components/Spinner'
import { Plus, Search } from 'lucide-react'

export default function RecordList() {
  const { objectTypeId } = useParams()
  const { objectTypes, fields, perms } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  const ot = objectTypes.find(o => o.id === objectTypeId)
  const cols = useMemo(() =>
    fields.filter(f => f.object_type_id === objectTypeId && perms?.fieldVisible(f.id))
          .sort((a, b) => a.sort_order - b.sort_order).slice(0, 6),
    [fields, objectTypeId, perms])

  useEffect(() => {
    setRows(null)
    supabase.from('records').select('*').eq('object_type_id', objectTypeId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [objectTypeId])

  const create = async () => {
    const { data, error } = await supabase.from('records')
      .insert({ object_type_id: objectTypeId, data: {},
                owner_id: (await supabase.auth.getUser()).data.user.id,
                org_id: ot.org_id }).select().single()
    if (!error && data) nav(`/records/${objectTypeId}/${data.id}`)
    else alert(error?.message)
  }

  if (!ot) return <p className="text-muted">Record type not found or no access.</p>
  if (rows === null) return <Spinner label={`Loading ${ot.name}…`} />

  const filtered = q
    ? rows.filter(r => JSON.stringify(r.data).toLowerCase().includes(q.toLowerCase()))
    : rows

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{ot.name}</h1>
        <span className="chip bg-brand-soft text-brand-dark">{rows.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
            <input className="input pl-8 w-44 sm:w-56" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {perms?.canCreate(objectTypeId) &&
            <button className="btn-primary" onClick={create}><Plus size={16} /> New</button>}
        </div>
      </div>

      {/* Desktop table */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px]">
          <thead><tr>{cols.map(c => <th key={c.id} className="th">{c.label}</th>)}</tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="cursor-pointer hover:bg-black/[.02]"
                  onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}>
                {cols.map(c => <td key={c.id} className="td"><FieldValue field={c} value={r.data[c.key]} /></td>)}
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
    </div>
  )
}
