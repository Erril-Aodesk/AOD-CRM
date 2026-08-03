import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'

// Best-effort mapping from this record type's dynamic fields to the fixed
// concepts the appointment form needs — field keys/labels vary per org, so a
// dedicated field_type (phone/email) is trusted first, then common key/label
// spellings. A field that doesn't match just shows "—" in the snapshot.
function matchField(defs, { type, keys }) {
  if (type) {
    const byType = defs.find(f => f.field_type === type)
    if (byType) return byType
  }
  return defs.find(f => keys.some(k => f.key?.toLowerCase() === k || f.label?.toLowerCase() === k))
}

export default function AppointmentModal({ record, ot, defs, onClose, onBooked }) {
  const { profile } = useAuth()
  const [managers, setManagers] = useState([])
  const [managerId, setManagerId] = useState('')
  const [lookingFor, setLookingFor] = useState('')
  const [appointmentAt, setAppointmentAt] = useState('')
  const [orgSize, setOrgSize] = useState('')
  const [businessGoals, setBusinessGoals] = useState('')
  const [tasksToOutsource, setTasksToOutsource] = useState('')
  const [outsourcedBefore, setOutsourcedBefore] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!ot?.org_id) return
    supabase.from('profiles').select('id, full_name, email, is_active, roles(is_manager)')
      .eq('org_id', ot.org_id).eq('is_active', true).order('full_name')
      .then(({ data }) => setManagers((data || []).filter(u => u.roles?.is_manager)))
  }, [ot?.org_id])

  const nameField = matchField(defs, { keys: ['name', 'full_name', 'contact_name', 'lead_name'] })
  const positionField = matchField(defs, { keys: ['position', 'title', 'job_title'] })
  const businessField = matchField(defs, { keys: ['company', 'business', 'business_name', 'company_name'] })
  const phoneField = matchField(defs, { type: 'phone', keys: ['phone', 'phone_number', 'mobile'] })
  const addressField = matchField(defs, { keys: ['address'] })
  const emailField = matchField(defs, { type: 'email', keys: ['email'] })

  const val = (f) => (f ? record.data?.[f.key] : '') || ''
  const contactName = val(nameField)
  const position = val(positionField)
  const businessName = val(businessField)
  const phone = val(phoneField)
  const address = val(addressField)
  const email = val(emailField)

  const submit = async () => {
    if (!managerId) return
    setSaving(true)

    const { error: insertError } = await supabase.from('appointments').insert({
      org_id: ot.org_id, record_id: record.id,
      contact_name: contactName, position, business_name: businessName, phone, address, email,
      looking_for: lookingFor,
      appointment_at: appointmentAt ? new Date(appointmentAt).toISOString() : null,
      organization_size: orgSize, business_goals: businessGoals,
      tasks_to_outsource: tasksToOutsource, outsourced_before: outsourcedBefore, notes,
      created_by: profile.id, sent_to_manager: managerId
    })
    if (insertError) { setSaving(false); return alert(insertError.message) }

    const manager = managers.find(m => m.id === managerId)
    try {
      await fetch('/api/send-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: manager?.email,
          contact_name: contactName, position, business_name: businessName, looking_for: lookingFor,
          phone, address, email,
          appointment_at: appointmentAt ? new Date(appointmentAt).toLocaleString() : '',
          notes, organization_size: orgSize, business_goals: businessGoals,
          tasks_to_outsource: tasksToOutsource, outsourced_before: outsourcedBefore
        })
      })
    } catch {
      // Booking is already saved; a failed email shouldn't block the flow.
    }

    await supabase.from('notifications').insert({
      org_id: ot.org_id, user_id: managerId, type: 'appointment_booked',
      title: 'New appointment booked',
      body: `${contactName || 'A lead'}${businessName ? ` at ${businessName}` : ''} — appointment booked for your review.`,
      record_id: record.id
    })

    setSaving(false)
    onBooked?.()
  }

  return (
    <Modal title="Book an appointment" onClose={onClose} wide
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving || !managerId} onClick={submit}>
          {saving ? 'Sending…' : 'Send to manager'}
        </button>
      </>}>
      <div className="space-y-5">
        <div>
          <p className="label mb-2">Lead details</p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg bg-bg p-3 text-sm sm:grid-cols-2">
            <ReadOnlyRow label="Name" value={contactName} />
            <ReadOnlyRow label="Position" value={position} />
            <ReadOnlyRow label="Business" value={businessName} />
            <ReadOnlyRow label="Phone" value={phone} />
            <ReadOnlyRow label="Address" value={address} />
            <ReadOnlyRow label="Email" value={email} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">Looking for</label>
            <input className="input" value={lookingFor} onChange={e => setLookingFor(e.target.value)} /></div>
          <div><label className="label">Date of appointment</label>
            <input type="datetime-local" className="input" value={appointmentAt} onChange={e => setAppointmentAt(e.target.value)} /></div>
          <div><label className="label">Organization size</label>
            <input className="input" value={orgSize} onChange={e => setOrgSize(e.target.value)}
              placeholder="e.g. 10-50 employees" /></div>
          <div><label className="label">Outsourced before?</label>
            <input className="input" value={outsourcedBefore} onChange={e => setOutsourcedBefore(e.target.value)} /></div>
        </div>

        <div><label className="label">Business goals / challenges</label>
          <textarea className="input" rows={2} value={businessGoals} onChange={e => setBusinessGoals(e.target.value)} /></div>
        <div><label className="label">Tasks / processes to outsource</label>
          <textarea className="input" rows={2} value={tasksToOutsource} onChange={e => setTasksToOutsource(e.target.value)} /></div>
        <div><label className="label">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>

        <div><label className="label">Send to manager</label>
          <select className="input" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">Choose a manager…</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

function ReadOnlyRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  )
}
