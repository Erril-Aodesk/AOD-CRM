import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldValue } from '../components/DynamicField'
import Spinner from '../components/Spinner'
import { AlertTriangle, Clock } from 'lucide-react'

export default function Callbacks() {
  const { objectTypes, fields, perms } = useAuth()
  const [rows, setRows] = useState(null)

  const callbackTypes = objectTypes.filter(ot =>
    perms?.canView(ot.id) && fields.some(f => f.object_type_id === ot.id && f.key === 'callback_date_time'))

  useEffect(() => {
    if (!perms) return
    setRows(null)
    // Sorted and capped server-side (soonest 300 per type) instead of an
    // unbounded select('*') — that used to silently drop anything past
    // Supabase's 1000-row response cap once a type had that many callbacks set.
    Promise.all(callbackTypes.map(ot =>
      supabase.from('records').select('*').eq('object_type_id', ot.id)
        .not('data->>callback_date_time', 'is', null)
        .order('data->>callback_date_time', { ascending: true })
        .limit(300)
        .then(({ data }) => (data || []).map(r => ({ ...r, _ot: ot })))
    )).then(results => {
      const all = results.flat().sort((a, b) =>
        new Date(a.data.callback_date_time) - new Date(b.data.callback_date_time))
      setRows(all)
    })
  }, [perms, objectTypes, fields])

  if (rows === null) return <Spinner label="Loading callbacks…" />

  return (
    <div>
      <h1 className="text-xl font-semibold">Callbacks</h1>
      <p className="mt-1 text-sm text-muted">Records with a callback date set, soonest first.</p>

      <div className="mt-5 space-y-3">
        {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">No callbacks scheduled.</div>}
        {rows.map(r => {
          const dt = new Date(r.data.callback_date_time)
          const now = new Date()
          const overdue = dt < now
          const dueToday = dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate()
          const infoCols = fields
            .filter(f => f.object_type_id === r._ot.id && f.show_in_list !== false && f.key !== 'callback_date_time' && perms?.fieldVisible(f.id))
            .sort((a, b) => a.sort_order - b.sort_order).slice(0, 3)

          return (
            <div key={r.id}
              className={`card flex flex-wrap items-center gap-3 p-4
                ${overdue ? 'border-danger ring-1 ring-danger/30' : dueToday ? 'border-warn ring-1 ring-warn/30' : ''}`}>
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg
                ${overdue ? 'bg-danger/10 text-danger' : dueToday ? 'bg-warn/10 text-warn' : 'bg-brand-soft text-brand'}`}>
                {overdue ? <AlertTriangle size={18} /> : <Clock size={18} />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r._ot.name}
                  {overdue && <span className="chip ml-2 bg-danger/10 text-danger">Overdue</span>}
                  {!overdue && dueToday && <span className="chip ml-2 bg-warn/10 text-warn">Due today</span>}
                </p>
                <p className="text-xs text-muted">{dt.toLocaleString()}</p>
                {infoCols.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                    {infoCols.map(c => (
                      <span key={c.id}><span className="text-muted/70">{c.label}: </span><FieldValue field={c} value={r.data[c.key]} /></span>
                    ))}
                  </div>
                )}
              </div>
              <Link className="btn-outline ml-auto" to={`/records/${r._ot.id}/${r.id}`}>Open</Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
