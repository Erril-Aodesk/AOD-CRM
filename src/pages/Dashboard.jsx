import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { aggregateFieldCounts } from '../lib/reportAggregates'
import { resolveStatusField } from '../lib/fieldMatch'
import { PhoneCall, PhoneOutgoing, Tag, CalendarCheck } from 'lucide-react'

// The "by status" breakdown below shows one record type at a time, switched
// via a toggle rather than stacking every qualifying type — these are the
// two types currently in scope for it.
const STATUS_BREAKDOWN_TYPES = ['BDM Leads', 'Ria Other Leads']

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
  const [dialedToday, setDialedToday] = useState(0)
  const visible = objectTypes.filter(ot => perms?.canView(ot.id))
  const breakdownTypes = STATUS_BREAKDOWN_TYPES.filter(name => visible.some(ot => ot.name === name))
  const [selectedType, setSelectedType] = useState(STATUS_BREAKDOWN_TYPES[0])

  // The three sections below are independent of each other, so each runs as
  // its own fire-and-forget chain instead of one sequential await-chain —
  // they load in parallel and each tile populates as soon as its own query
  // resolves, rather than the whole page waiting on the slowest of the three.
  useEffect(() => {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    // callback_date_time is stored as a naive "YYYY-MM-DDTHH:mm" string (the
    // raw value of a datetime-local input, no timezone) — this boundary is
    // built in the same format so a lexical <= comparison matches "due
    // today or earlier" without pulling every callback row to filter in JS.
    const endOfToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59`
    const callbackTypes = visible.filter(ot => fields.some(f => f.object_type_id === ot.id && f.key === 'callback_date_time'))
    Promise.all(callbackTypes.map(ot =>
      supabase.from('records').select('id', { count: 'exact', head: true })
        .eq('object_type_id', ot.id)
        .not('data->>callback_date_time', 'is', null)
        .lte('data->>callback_date_time', endOfToday)
    )).then(results => {
      setDueCount(results.reduce((n, { count }) => n + (count || 0), 0))
    })

    // Status breakdown is scoped to whichever of the two types is selected
    // in the toggle, not stacked for every qualifying type — one count:
    // 'exact' query (see aggregateFieldCounts) for just that type, accurate
    // even past Supabase's 1000-row response cap. resolveStatusField falls
    // back to a free-typed text field for types like Ria Other Leads that
    // don't have a flagged is_status_field.
    const chosenOt = visible.find(ot => ot.name === selectedType)
    const chosenStatusField = chosenOt && resolveStatusField(chosenOt.id, fields.filter(f => f.object_type_id === chosenOt.id))
    if (chosenOt && chosenStatusField) {
      aggregateFieldCounts(chosenOt.id, chosenStatusField).then(data => {
        const byName = new Map(data.map(d => [d.name.toLowerCase(), d]))
        const large = PROMINENT_STATUSES.map(name => byName.get(name.toLowerCase())).filter(Boolean)
        const largeNames = new Set(large.map(d => d.name.toLowerCase()))
        const small = data.filter(d => !largeNames.has(d.name.toLowerCase()) && d.count > 0)
        setStatusSections(large.length > 0 || small.length > 0 ? [{ ot: chosenOt, large, small }] : [])
      })
    } else {
      setStatusSections([])
    }

    if (profile?.org_id) {
      supabase.from('appointments')
        .select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id)
        .then(({ count }) => setAppointmentCount(count || 0))
    }

    // "Numbers dialed today" = status_history rows logged today for records
    // this agent currently owns (no changed_by column exists, so ownership
    // is the same stand-in the Activity page uses for "who made the call").
    if (profile?.org_id && profile?.id) {
      const start = new Date(); start.setUTCHours(0, 0, 0, 0)
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1)
      supabase.from('status_history')
        .select('id, records!inner(owner_id)', { count: 'exact', head: true })
        .eq('org_id', profile.org_id).eq('records.owner_id', profile.id)
        .gte('changed_at', start.toISOString()).lt('changed_at', end.toISOString())
        .then(({ count }) => setDialedToday(count || 0))
    }
  }, [objectTypes.length, fields.length, profile?.org_id, profile?.id, selectedType])

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
        <Link to="/appointments" className="card p-5 hover:shadow-pop transition-shadow">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand"><CalendarCheck size={20} /></div>
            <div>
              <p className="text-2xl font-semibold">{appointmentCount}</p>
              <p className="text-sm text-muted">Appointments</p>
            </div>
          </div>
        </Link>
        <Link to="/activity" className="card p-5 hover:shadow-pop transition-shadow">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-ok/10 text-ok"><PhoneOutgoing size={20} /></div>
            <div>
              <p className="text-2xl font-semibold">{dialedToday}</p>
              <p className="text-sm text-muted">Numbers dialed today</p>
            </div>
          </div>
        </Link>
      </div>

      {breakdownTypes.length > 0 && (
        <div className="mt-8 flex items-center gap-2">
          {breakdownTypes.map(name => (
            <button key={name} onClick={() => setSelectedType(name)}
              className={`chip border px-3 py-1.5 text-xs ${selectedType === name ? 'bg-brand text-white border-brand' : 'border-line text-muted hover:bg-black/5'}`}>
              {name}
            </button>
          ))}
        </div>
      )}

      {statusSections.map(sec => (
        <div key={sec.ot.id} className="mt-4">
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
