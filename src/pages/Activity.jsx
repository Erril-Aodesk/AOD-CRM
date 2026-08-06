import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { matchField } from '../lib/fieldMatch'
import { fetchAllPages } from '../lib/fetchAllPages'
import Spinner from '../components/Spinner'
import { PhoneCall } from 'lucide-react'

const pad = (n) => String(n).padStart(2, '0')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const addDays = (dateStr, delta) => {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const formatShort = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' }
]

// Local-midnight boundaries for the selected range, converted to UTC instants
// for the changed_at (timestamptz) comparison — matches how "today" is
// computed elsewhere in the app (e.g. Dashboard's due-callback check).
// A null `from` means no lower bound ("All time").
const rangeBounds = (from, to) => {
  const end = new Date(`${to}T00:00:00`)
  end.setDate(end.getDate() + 1)
  return {
    start: from ? new Date(`${from}T00:00:00`).toISOString() : null,
    end: end.toISOString()
  }
}

// A record has exactly one owner at any time, so "who made this call" is
// approximated as whoever currently owns the record — there's no changed_by
// column on status_history to say who actually made each individual change.
const fetchRangeChanges = (otId, orgId, start, end) =>
  fetchAllPages(() => {
    let q = supabase.from('status_history')
      .select('id, old_status, new_status, changed_at, record_id, records(owner_id, data)')
      .eq('org_id', orgId).eq('object_type_id', otId)
      .lt('changed_at', end)
      .order('changed_at', { ascending: false })
    if (start) q = q.gte('changed_at', start)
    return q
  })

export default function Activity() {
  const { objectTypes, fields, perms } = useAuth()
  const viewable = useMemo(() => objectTypes.filter(ot => perms?.canView(ot.id)), [objectTypes, perms])
  const [otId, setOtId] = useState('')
  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState(todayStr)
  const [changes, setChanges] = useState(null)
  const [profiles, setProfiles] = useState([])

  useEffect(() => {
    if (!otId && viewable[0]) setOtId(viewable[0].id)
  }, [viewable, otId])

  const ot = objectTypes.find(o => o.id === otId)
  const nameField = matchField(
    fields.filter(f => f.object_type_id === otId && perms?.fieldVisible(f.id)),
    { keys: ['name', 'full_name', 'contact_name', 'lead_name'] }
  )

  useEffect(() => {
    if (!ot?.org_id) return
    supabase.from('profiles').select('id, full_name, email').eq('org_id', ot.org_id)
      .then(({ data }) => setProfiles(data || []))
  }, [ot?.org_id])

  useEffect(() => {
    if (!otId || !ot?.org_id) return
    setChanges(null)
    const { start, end } = rangeBounds(fromDate, toDate)
    fetchRangeChanges(otId, ot.org_id, start, end).then(setChanges)
  }, [otId, ot?.org_id, fromDate, toDate])

  const applyPreset = (key) => {
    const today = todayStr()
    if (key === 'today') { setFromDate(today); setToDate(today) }
    if (key === '7d') { setFromDate(addDays(today, -6)); setToDate(today) }
    if (key === '30d') { setFromDate(addDays(today, -29)); setToDate(today) }
    if (key === 'all') { setFromDate(''); setToDate(today) }
  }

  const activePreset = useMemo(() => {
    const today = todayStr()
    if (toDate !== today) return null
    if (fromDate === today) return 'today'
    if (fromDate === addDays(today, -6)) return '7d'
    if (fromDate === addDays(today, -29)) return '30d'
    if (fromDate === '') return 'all'
    return null
  }, [fromDate, toDate])

  const multiDay = !fromDate || fromDate !== toDate
  const rangeLabel = !fromDate ? `through ${formatShort(toDate)}` : multiDay ? `${formatShort(fromDate)} – ${formatShort(toDate)}` : formatShort(fromDate)

  const nameOf = (id) => {
    if (!id) return 'Unassigned'
    const p = profiles.find(p => p.id === id)
    return p?.full_name || p?.email || 'Unknown'
  }

  const perAgent = useMemo(() => {
    if (!changes) return []
    const counts = new Map()
    changes.forEach(c => {
      const owner = c.records?.owner_id || null
      counts.set(owner, (counts.get(owner) || 0) + 1)
    })
    return [...counts.entries()]
      .map(([owner, count]) => ({ owner, name: nameOf(owner), count }))
      .sort((a, b) => b.count - a.count)
  }, [changes, profiles])

  const dispositionCounts = useMemo(() => {
    if (!changes) return []
    const counts = new Map()
    changes.forEach(c => counts.set(c.new_status, (counts.get(c.new_status) || 0) + 1))
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [changes])

  if (viewable.length === 0) return <p className="text-muted">No record types available.</p>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Activity</h1>
        <select className="input w-auto min-w-[180px]" value={otId} onChange={e => setOtId(e.target.value)}>
          {viewable.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={fromDate} max={toDate || todayStr()}
            onChange={e => setFromDate(e.target.value)} />
          <span className="text-sm text-muted">–</span>
          <input type="date" className="input w-auto" value={toDate} max={todayStr()} min={fromDate || undefined}
            onChange={e => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`chip border px-3 py-1.5 text-xs ${activePreset === p.key ? 'bg-brand text-white border-brand' : 'border-line text-muted hover:bg-black/5'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {changes === null ? <Spinner label="Loading activity…" /> : (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand"><PhoneCall size={20} /></div>
              <div>
                <p className="text-2xl font-semibold">{changes.length}</p>
                <p className="text-sm text-muted">Total status changes (calls) · {rangeLabel}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Dispositions</h2>
            {dispositionCounts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No status changes in this range.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {dispositionCounts.map(d => (
                  <div key={d.name} className="rounded-lg bg-bg p-3 text-center">
                    <p className="text-lg font-semibold">{d.count}</p>
                    <p className="truncate text-xs text-muted">{d.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold sm:px-5">Calls per agent</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr><th className="th text-left">Agent</th><th className="th text-right">Calls</th></tr>
                </thead>
                <tbody>
                  {perAgent.map(a => (
                    <tr key={a.owner ?? 'unassigned'} className="border-t border-line">
                      <td className="td">{a.name}</td>
                      <td className="td text-right font-medium tabular-nums">{a.count}</td>
                    </tr>
                  ))}
                  {perAgent.length === 0 && (
                    <tr><td colSpan={2} className="py-8 text-center text-sm text-muted">No calls logged in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold sm:px-5">Activity log</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">{multiDay ? 'Date, time' : 'Time'}</th>
                    <th className="th text-left">Lead</th>
                    <th className="th text-left">Change</th>
                    <th className="th text-left">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => (
                    <tr key={c.id} className="border-t border-line hover:bg-black/[.02]">
                      <td className="td whitespace-nowrap">
                        {multiDay
                          ? new Date(c.changed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : new Date(c.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="td">
                        <Link className="text-brand hover:underline" to={`/records/${otId}/${c.record_id}`}>
                          {(nameField && c.records?.data?.[nameField.key]) || '—'}
                        </Link>
                      </td>
                      <td className="td whitespace-nowrap">{c.old_status || '—'} → {c.new_status}</td>
                      <td className="td">{nameOf(c.records?.owner_id)}</td>
                    </tr>
                  ))}
                  {changes.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-sm text-muted">No activity in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
