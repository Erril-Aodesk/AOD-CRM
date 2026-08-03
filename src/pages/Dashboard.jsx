import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { aggregateFieldCounts } from '../lib/reportAggregates'
import { Database, PhoneCall, Tag } from 'lucide-react'

// "Unset" is a synthetic bucket for missing values, not a real status option —
// there's no dropdown value to filter by, so those tiles link unfiltered.
const statusLink = (otId, statusName) =>
  statusName === 'Unset' ? `/records/${otId}` : `/records/${otId}?status=${encodeURIComponent(statusName)}`

const PROMINENT_STATUSES = ['New', 'Callback', 'Qualified', 'Rejected']
const PROMINENT_STYLES = {
  new: 'bg-brand-soft text-brand',
  callback: 'bg-warn/10 text-warn',
  qualified: 'bg-ok/10 text-ok',
  rejected: 'bg-danger/10 text-danger'
}

export default function Dashboard() {
  const { profile, objectTypes, fields, perms } = useAuth()
  const [counts, setCounts] = useState({})
  const [dueCount, setDueCount] = useState(0)
  const [statusSections, setStatusSections] = useState([])
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

      // Per-status counts, per record type that has a status field. Each count comes
      // from a count: 'exact' query (see aggregateFieldCounts) so it's accurate even
      // when a type has more than Supabase's 1000-row response cap worth of records.
      const withStatus = visible
        .map(ot => ({ ot, statusField: fields.find(f => f.object_type_id === ot.id && f.is_status_field) }))
        .filter(x => x.statusField)
      const sections = await Promise.all(withStatus.map(async ({ ot, statusField }) => {
        const data = await aggregateFieldCounts(ot.id, statusField)
        const byName = new Map(data.map(d => [d.name.toLowerCase(), d]))
        const large = PROMINENT_STATUSES.map(name => byName.get(name.toLowerCase())).filter(Boolean)
        const largeNames = new Set(large.map(d => d.name.toLowerCase()))
        const small = data.filter(d => !largeNames.has(d.name.toLowerCase()) && d.count > 0)
        return { ot, large, small }
      }))
      setStatusSections(sections.filter(s => s.large.length > 0 || s.small.length > 0))
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

      {statusSections.map(sec => (
        <div key={sec.ot.id} className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-muted">{sec.ot.name} by status</h2>

          {sec.large.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {sec.large.map(s => (
                <Link key={s.name} to={statusLink(sec.ot.id, s.name)} className="card p-5 hover:shadow-pop transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${PROMINENT_STYLES[s.name.toLowerCase()] || 'bg-brand-soft text-brand'}`}>
                      <Tag size={20} />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold">{s.count}</p>
                      <p className="text-sm text-muted">{s.name}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {sec.small.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {sec.small.map(s => (
                <Link key={s.name} to={statusLink(sec.ot.id, s.name)} className="card p-3 text-center hover:shadow-pop transition-shadow">
                  <p className="text-lg font-semibold">{s.count}</p>
                  <p className="truncate text-xs text-muted">{s.name}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
