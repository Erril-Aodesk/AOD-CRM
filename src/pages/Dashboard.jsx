import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Database, PhoneCall } from 'lucide-react'

export default function Dashboard() {
  const { profile, objectTypes, fields, perms } = useAuth()
  const [counts, setCounts] = useState({})
  const [dueCount, setDueCount] = useState(0)
  const visible = objectTypes.filter(ot => perms?.canView(ot.id))

  useEffect(() => {
    (async () => {
      const c = {}
      for (const ot of visible) {
        const { count } = await supabase.from('records')
          .select('id', { count: 'exact', head: true }).eq('object_type_id', ot.id)
        c[ot.id] = count || 0
      }
      setCounts(c)

      const now = new Date()
      const isDueOrOverdue = (raw) => {
        if (!raw) return false
        const dt = new Date(raw)
        if (isNaN(dt)) return false
        return dt < now ||
          (dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate())
      }
      const callbackTypes = visible.filter(ot => fields.some(f => f.object_type_id === ot.id && f.key === 'callback_date_time'))
      const results = await Promise.all(callbackTypes.map(ot =>
        supabase.from('records')
          .select('callback_date_time:data->>callback_date_time')
          .eq('object_type_id', ot.id)
          .not('data->>callback_date_time', 'is', null)
      ))
      const due = results.reduce((n, { data }) =>
        n + (data || []).filter(r => isDueOrOverdue(r.callback_date_time)).length, 0)
      setDueCount(due)
    })()
  }, [objectTypes.length, fields.length])

  return (
    <div>
      <h1 className="text-xl font-semibold">Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="mt-1 text-sm text-muted">Here's where things stand today.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/callbacks" className="card p-5 hover:shadow-pop transition-shadow">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-warn/10 text-warn"><PhoneCall size={20} /></div>
            <div>
              <p className="text-2xl font-semibold">{dueCount}</p>
              <p className="text-sm text-muted">Callbacks due</p>
            </div>
          </div>
        </Link>
        {visible.map(ot => (
          <Link key={ot.id} to={`/records/${ot.id}`} className="card p-5 hover:shadow-pop transition-shadow">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand"><Database size={20} /></div>
              <div>
                <p className="text-2xl font-semibold">{counts[ot.id] ?? '—'}</p>
                <p className="text-sm text-muted">{ot.name}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
