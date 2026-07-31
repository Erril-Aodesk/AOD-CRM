// Vercel Cron endpoint — runs on the schedule in vercel.json.
// Calls the Postgres function daily_agent_run() with the service role.
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Vercel Cron sends this header; also allow a manual secret for testing.
  const auth = req.headers.authorization || ''
  const secret = process.env.CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1'
  if (!isCron && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data, error } = await supabase.rpc('daily_agent_run')
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ escalated: data })
}
