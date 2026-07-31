// Sends the invitation email via Resend after an invitation row has been created.
import { Resend } from 'resend'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { email, link } = req.body || {}
  if (!email || !link) return res.status(400).json({ error: 'Missing email or link' })

  const resend = new Resend(process.env.RESEND_API_KEY)

  const { error } = await resend.emails.send({
    from: 'AODesk CRM <invites@aodesk.com.au>',
    to: email,
    subject: "You've been invited",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p>You've been invited to join. Click below to set your password and get started.</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
            Set your password
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">If the button doesn't work, copy this link into your browser:<br>${link}</p>
      </div>
    `
  })
  if (error) return res.status(500).json({ error: error.message || 'Failed to send email' })

  return res.status(200).json({ ok: true })
}
