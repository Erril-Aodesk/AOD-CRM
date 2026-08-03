import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

export default function Appointments() {
  const { profile } = useAuth()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!profile?.org_id) return
    supabase.from('appointments')
      .select('*, sent_to:profiles!sent_to_manager(full_name, email), booked_by:profiles!created_by(full_name, email)')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [profile?.org_id])

  if (rows === null) return <Spinner label="Loading appointments…" />

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Appointments</h1>
        <span className="chip bg-brand-soft text-brand-dark">{rows.length}</span>
      </div>

      {/* Desktop table */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <th className="th">Business</th>
              <th className="th">Contact</th>
              <th className="th">Date of appointment</th>
              <th className="th">Sent to</th>
              <th className="th">Booked by</th>
              <th className="th">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td className="td font-medium">{a.business_name || '—'}</td>
                <td className="td">{a.contact_name || '—'}</td>
                <td className="td">{a.appointment_at ? new Date(a.appointment_at).toLocaleString() : '—'}</td>
                <td className="td">{a.sent_to?.full_name || a.sent_to?.email || '—'}</td>
                <td className="td">{a.booked_by?.full_name || a.booked_by?.email || '—'}</td>
                <td className="td text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted">No appointments booked yet.</p>}
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 sm:hidden">
        {rows.map(a => (
          <div key={a.id} className="card p-4">
            <p className="font-medium">{a.business_name || '—'}</p>
            <p className="text-sm text-muted">{a.contact_name || '—'}</p>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Date</span>
                <span>{a.appointment_at ? new Date(a.appointment_at).toLocaleString() : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">Sent to</span>
                <span>{a.sent_to?.full_name || a.sent_to?.email || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">Booked by</span>
                <span>{a.booked_by?.full_name || a.booked_by?.email || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">Created</span>
                <span>{new Date(a.created_at).toLocaleDateString()}</span></div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">No appointments booked yet.</p>}
      </div>
    </div>
  )
}
