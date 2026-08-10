import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { aggregateFieldCounts } from '../lib/reportAggregates'
import { PhoneCall, Tag, CalendarCheck } from 'lucide-react'

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
  const [dueCount, setDueCount] = useState(0)
  const [statusSections, setStatusSections] = useState([])
  const [appointmentCount, setAppointmentCount] = useState(0)
  const visible = objectTypes.filter(ot => perms?.canView(ot.id))

  useEffect(() => {
    (async () => {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      // callback_date_time is stored as a naive "YYYY-MM-DDTHH:mm" string (the
      // raw value of a datetime-local input, no timezone) — this boundary is
      // built in the same format so a lexical <= comparison matches "due
      // today or earlier" without pulling every callback row to filter in JS.
      const endOfToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59`
      const callbackTypes = visible.filter(ot => fields.some(f => f.object_type_id === ot.id && f.key === 'callback_date_time'))
      const results = await Promise.all(callbackTypes.map(ot =>
        supabase.from('records').select('id', { count: 'exact', head: true })
          .eq('object_type_id', ot.id)
          .not('data->>callback_date_time', 'is', null)
          .lte('data->>callback_date_time', endOfToday)
      ))
      const due = results.reduce((n, { count }) => n + (count || 0), 0)
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

      if (profile?.org_id) {
        const { count } = await supabase.from('appointments')
          .select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id)
        setAppointmentCount(count || 0)
      }
    })()
  }, [objectTypes.length, fields.length, profile?.org_id])

  return (
    <div>
      <h1 className="text-xl font-semibold">Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="mt-1 text-sm text-muted">Here's where things stand today.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/callbacks" className="card p-5 hover:shadow-pop transition-shadow">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-warn/10 text-warn"><PhoneCall size={20} /></div>
            <div>
              <p className="text-2xl font-semibold">{dueCount}</p>
              <p className="text-sm text-muted">Callbacks due</p>
            </div>
          </div>
        </Link>
        <Link to="/appointments" className="card p-5 hover:shadow-pop transition-shadow">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand"><CalendarCheck size={20} /></div>
            <div>
              <p className="text-2xl font-semibold">{appointmentCount}</p>
              <p className="text-sm text-muted">Appointments</p>
            </div>
          </div>
        </Link>
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
