// Emails a manager the details of a newly booked appointment. The appointment
// row is already saved by the time this is called — a failed send here
// doesn't block the booking, it's a best-effort notification.
import { Resend } from 'resend'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const {
    to, contact_name, position, business_name, looking_for, phone, address, email,
    appointment_at, notes, organization_size, business_goals, tasks_to_outsource, outsourced_before
  } = req.body || {}
  if (!to) return res.status(400).json({ error: 'Missing recipient' })

  if (!process.env.RESEND_API_KEY) {
    console.error('[send-appointment] RESEND_API_KEY is not set in this environment')
    return res.status(500).json({ error: 'Server is missing RESEND_API_KEY' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  const text = `APPOINTMENT

Name: ${contact_name || ''}
Position: ${position || ''}
Name of Business: ${business_name || ''}
Looking for: ${looking_for || ''}
Phone number: ${phone || ''}
Address: ${address || ''}
Email Address: ${email || ''}
Date of Appointment: ${appointment_at || ''}

Notes: ${notes || ''}

How large is your organization in terms of employees? ${organization_size || ''}
What are your primary business goals or challenges right now? ${business_goals || ''}
What specific task or processes are you considering outsourcing? ${tasks_to_outsource || ''}
Have you outsourced or have you look on outsourcing before? ${outsourced_before || ''}`

  try {
    const { data, error } = await resend.emails.send({
      from: 'AODesk CRM <invites@aodesk.com.au>',
      to,
      subject: 'New appointment booked',
      text
    })

    if (error) {
      console.error('[send-appointment] Resend API returned an error:', JSON.stringify(error))
      return res.status(500).json({ error: error.message || 'Failed to send email' })
    }

    console.log('[send-appointment] sent', { to, id: data?.id })
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[send-appointment] threw before/during Resend call:', err)
    return res.status(500).json({ error: err.message || 'Failed to send email' })
  }
}
