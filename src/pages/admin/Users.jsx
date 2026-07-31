import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Modal from '../../components/Modal'
import Spinner from '../../components/Spinner'
import { UserPlus, Copy, Check } from 'lucide-react'

export default function UsersAdmin() {
  const { profile } = useAuth()
  const [users, setUsers] = useState(null)
  const [roles, setRoles] = useState([])
  const [invite, setInvite] = useState(false)

  const load = () => Promise.all([
    supabase.from('profiles').select('*, roles(name)').order('created_at'),
    supabase.from('roles').select('*')
  ]).then(([{ data: u }, { data: r }]) => { setUsers(u || []); setRoles(r || []) })

  useEffect(() => { load() }, [])

  const toggleActive = async (u) => {
    await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id)
    load()
  }

  if (users === null) return <Spinner label="Loading users…" />

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <button className="btn-primary ml-auto" onClick={() => setInvite(true)}><UserPlus size={16} /> Invite user</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="td font-medium">{u.full_name || '—'}</td>
                <td className="td text-muted">{u.email}</td>
                <td className="td"><span className="chip bg-brand-soft text-brand-dark">{u.roles?.name}</span></td>
                <td className="td">
                  <span className={`chip ${u.is_active ? 'bg-ok/10 text-ok' : 'bg-line text-muted'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="td text-right">
                  {u.id !== profile.id &&
                    <button className="btn-ghost" onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invite && <InviteModal roles={roles} orgId={profile.org_id} invitedBy={profile.id}
        onClose={() => { setInvite(false); load() }} />}
    </div>
  )
}

function InviteModal({ roles, orgId, invitedBy, onClose }) {
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(roles.find(r => !r.is_admin)?.id || roles[0]?.id || '')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  const create = async () => {
    const { data, error } = await supabase.from('invitations')
      .insert({ org_id: orgId, email, role_id: roleId, invited_by: invitedBy })
      .select().single()
    if (error) return alert(error.message)
    setLink(`${window.location.origin}/accept-invite?token=${data.token}`)
  }
  const copy = () => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <Modal title="Invite user" onClose={onClose}
      footer={link
        ? <button className="btn-primary" onClick={onClose}>Done</button>
        : <><button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!email} onClick={create}>Create invite</button></>}>
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Share this link with {email}. It expires in 7 days.</p>
          <div className="flex gap-2">
            <input className="input" readOnly value={link} />
            <button className="btn-outline shrink-0" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div><label className="label">Email</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><label className="label">Role</label>
            <select className="input" value={roleId} onChange={e => setRoleId(e.target.value)}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
        </div>
      )}
    </Modal>
  )
}
