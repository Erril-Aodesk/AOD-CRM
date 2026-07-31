import { useEffect, useState, useRef } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function NotificationBell() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef()

  const load = async () => {
    const { data } = await supabase.from('notifications')
      .select('*').order('created_at', { ascending: false }).limit(20)
    setItems(data || [])
  }

  useEffect(() => {
    if (!profile) return
    load()
    const ch = supabase.channel('notif')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        payload => setItems(p => [payload.new, ...p]))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [profile])

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const unread = items.filter(i => !i.is_read).length
  const markAll = async () => {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    setItems(items.map(i => ({ ...i, is_read: true })))
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative !px-2" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center
                           rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] card shadow-pop z-50">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button className="text-xs text-brand hover:underline" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</p>}
            {items.map(n => (
              <div key={n.id} className={`px-4 py-3 border-b border-line last:border-0 ${!n.is_read ? 'bg-brand-soft/40' : ''}`}>
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted mt-0.5">{n.body}</p>}
                <p className="text-[11px] text-muted/70 mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
