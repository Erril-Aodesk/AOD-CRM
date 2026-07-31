import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      const userId = data.user?.id
      const res = await fetch('/api/accept-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, userId, fullName })
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not accept invitation')
      // sign in (in case email confirmation is disabled)
      await supabase.auth.signInWithPassword({ email, password })
      nav('/')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!token) return <div className="grid min-h-screen place-items-center p-6 text-muted">Invalid invitation link.</div>

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Accept your invitation</h1>
        <p className="mt-1 text-sm text-muted">Set a password to join the workspace.</p>
        <div className="mt-5 space-y-3">
          <div><label className="label">Full name</label>
            <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} /></div>
          <div><label className="label">Email</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <button className="btn-primary w-full" disabled={busy} onClick={submit}>
            {busy ? 'Creating account…' : 'Join workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
