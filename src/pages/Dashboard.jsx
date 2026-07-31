import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Database, PhoneCall } from 'lucide-react'

export default function Dashboard() {
  const { profile, objectTypes, perms } = useAuth()
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
      const { count } = await supabase.from('callbacks')
        .select('id', { count: 'exact', head: true })
        .eq('is_completed', false).lte('callback_at', new Date().toISOString())
      setDueCount(count || 0)
    })()
  }, [objectTypes.length])

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
