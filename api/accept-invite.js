// Completes an invitation: validates the token and creates the user's profile
// (row-level security blocks self-insert, so this runs with the service role).
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { token, userId, fullName } = req.body || {}
  if (!token || !userId) return res.status(400).json({ error: 'Missing token or userId' })

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: invite, error: e1 } = await admin
    .from('invitations').select('*').eq('token', token).single()
  if (e1 || !invite) return res.status(404).json({ error: 'Invitation not found' })
  if (invite.accepted) return res.status(400).json({ error: 'Invitation already used' })
  if (new Date(invite.expires_at) < new Date())
    return res.status(400).json({ error: 'Invitation expired' })

  const { error: e2 } = await admin.from('profiles').insert({
    id: userId,
    org_id: invite.org_id,
    role_id: invite.role_id,
    full_name: fullName || invite.email,
    email: invite.email
  })
  if (e2) return res.status(500).json({ error: e2.message })

  await admin.from('invitations').update({ accepted: true }).eq('id', invite.id)
  return res.status(200).json({ ok: true })
}
