import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async () => {
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(error.message)
    else nav('/')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white font-display font-bold">C</div>
          <span className="font-display text-xl font-semibold">Custom CRM</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Access is invite-only. Use the email your manager added.</p>
          <div className="mt-5 space-y-3">
            <div>
              <label className="label">Email</label>
              <input className="input" value={email} onChange={e => setEmail(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <button className="btn-primary w-full" disabled={busy} onClick={submit}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
