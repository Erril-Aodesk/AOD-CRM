import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'
import Spinner from './Spinner'
import { LayoutGrid, PhoneCall, Upload, Settings, Users, Database,
         Shield, LogOut, Menu, X, BarChart3, CalendarCheck, Activity } from 'lucide-react'

export default function Layout() {
  const { profile, role, perms, objectTypes, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [totalLeads, setTotalLeads] = useState(null)
  const nav = useNavigate()
  const visibleTypes = objectTypes.filter(ot => perms?.canView(ot.id))

  useEffect(() => {
    if (visibleTypes.length === 0) { setTotalLeads(0); return }
    let cancelled = false
    Promise.all(visibleTypes.map(ot =>
      supabase.from('records').select('id', { count: 'exact', head: true }).eq('object_type_id', ot.id)
    )).then(results => {
      if (cancelled) return
      setTotalLeads(results.reduce((n, { count }) => n + (count || 0), 0))
    })
    return () => { cancelled = true }
  }, [visibleTypes.map(ot => ot.id).join(','), profile?.org_id])

  const Item = ({ to, icon: Icon, children, end }) => (
    <NavLink to={to} end={end} onClick={() => setOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
         ${isActive ? 'bg-brand text-white' : 'text-ink/80 hover:bg-black/5'}`}>
      <Icon size={17} /> {children}
    </NavLink>
  )

  const SideContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white font-display font-bold">C</div>
        <span className="font-display text-lg font-semibold">CRM</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        <Item to="/" icon={LayoutGrid} end>Dashboard</Item>
        <Item to="/callbacks" icon={PhoneCall}>Callbacks</Item>
        {perms?.isManager && <Item to="/reports" icon={BarChart3}>Reports</Item>}
        {perms?.isManager && <Item to="/appointments" icon={CalendarCheck}>Appointments</Item>}
        {perms?.canViewActivity && <Item to="/activity" icon={Activity}>Activity</Item>}
        {visibleTypes.length > 0 && (
          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Records</p>
        )}
        {visibleTypes.map(ot => (
          <Item key={ot.id} to={`/records/${ot.id}`} icon={Database}>{ot.name}</Item>
        ))}
        <Item to="/import" icon={Upload}>Import Excel</Item>
        {perms?.isAdmin && (
          <>
            <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Admin</p>
            <Item to="/admin/objects" icon={Settings}>Record types</Item>
            <Item to="/admin/permissions" icon={Shield}>Permissions</Item>
            <Item to="/admin/users" icon={Users}>Users</Item>
          </>
        )}
      </nav>
      <div className="border-t border-line p-3">
        <div className="mb-2 px-2">
          <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
          <p className="text-xs text-muted">{role?.name}</p>
        </div>
        <button className="btn-ghost w-full justify-start" onClick={() => signOut().then(() => nav('/login'))}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-line bg-surface">
        <SideContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface shadow-pop"><SideContent /></aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur">
          <button className="btn-ghost md:hidden !px-2" onClick={() => setOpen(o => !o)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="md:hidden font-display font-semibold">CRM</div>
          <div className="ml-auto flex items-center gap-3">
            {totalLeads !== null && (
              <span className="hidden sm:inline-flex items-center rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-muted">
                {totalLeads.toLocaleString()} leads
              </span>
            )}
            <NotificationBell />
          </div>
        </header>
        {/* Only this pane scrolls — header/footer stay put and the window
            itself never grows a scrollbar, however long the page content is. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Suspense fallback={<Spinner label="Loading…" />}><Outlet /></Suspense>
        </main>
        <footer className="shrink-0 border-t border-line bg-surface px-4 py-2 text-center text-xs text-muted">
          Australian Outsource Desk © {new Date().getFullYear()} · Powered by Qwerrilty
        </footer>
      </div>
    </div>
  )
}
