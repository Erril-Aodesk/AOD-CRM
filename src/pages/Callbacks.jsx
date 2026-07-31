import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

export default function Callbacks() {
  const [rows, setRows] = useState(null)

  const load = () => supabase.from('callbacks')
    .select('*, object_types(name)').eq('is_completed', false)
    .order('callback_at', { ascending: true })
    .then(({ data }) => setRows(data || []))

  useEffect(() => { load() }, [])

  const complete = async (id) => {
    await supabase.from('callbacks').update({ is_completed: true, completed_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  if (rows === null) return <Spinner label="Loading callbacks…" />

  return (
    <div>
      <h1 className="text-xl font-semibold">Callbacks</h1>
      <p className="mt-1 text-sm text-muted">Open callbacks, soonest first. Overdue ones with no status change escalate to the manager.</p>

      <div className="mt-5 space-y-3">
        {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">No open callbacks.</div>}
        {rows.map(cb => {
          const overdue = new Date(cb.callback_at) < new Date()
          return (
            <div key={cb.id} className="card flex flex-wrap items-center gap-3 p-4">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg
                ${overdue ? 'bg-danger/10 text-danger' : 'bg-brand-soft text-brand'}`}>
                {overdue ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {cb.object_types?.name || 'Record'} callback
                  {cb.escalated && <span className="chip ml-2 bg-danger/10 text-danger">Escalated</span>}
                </p>
                <p className="text-xs text-muted">
                  {new Date(cb.callback_at).toLocaleString()} {overdue && '· overdue'}
                  {cb.note ? ` · ${cb.note}` : ''}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Link className="btn-outline" to={`/records/${cb.object_type_id}/${cb.record_id}`}>Open</Link>
                <button className="btn-primary" onClick={() => complete(cb.id)}>Mark done</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
