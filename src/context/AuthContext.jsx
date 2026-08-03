import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { buildPermissions } from '../lib/permissions'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [role, setRole] = useState(null)
  const [objectTypes, setObjectTypes] = useState([])
  const [fields, setFields] = useState([])
  const [perms, setPerms] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadContext = useCallback(async (uid) => {
    const { data: prof } = await supabase.from('profiles')
      .select('*, roles(*)').eq('id', uid).single()
    if (!prof) { setProfile(null); setLoading(false); return }
    setProfile(prof); setRole(prof.roles)

    const [{ data: ots }, { data: flds }, { data: op }, { data: fp }] = await Promise.all([
      supabase.from('object_types').select('*').order('sort_order'),
      supabase.from('field_definitions').select('*').order('sort_order'),
      supabase.from('role_object_permissions').select('*').eq('role_id', prof.role_id),
      supabase.from('role_field_permissions').select('*').eq('role_id', prof.role_id)
    ])
    setObjectTypes(ots || []); setFields(flds || [])
    setPerms(buildPermissions({ role: prof.roles, objectPerms: op || [], fieldPerms: fp || [] }))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadContext(data.session.user.id)
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // TOKEN_REFRESHED (and USER_UPDATED) fire silently in the background as the
      // access token renews — the signed-in user hasn't changed, so don't blank
      // the whole app to a loading spinner and remount everything. That was wiping
      // out whatever an agent had open (e.g. a lead's detail view mid-call) every
      // time the token refreshed. Only a real sign-in/out should reload context.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      if (s) { setLoading(true); loadContext(s.user.id) }
      else { setProfile(null); setRole(null); setPerms(null) }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadContext])

  const refresh = useCallback(() => {
    if (session) return loadContext(session.user.id)
  }, [session, loadContext])

  const signOut = () => supabase.auth.signOut()

  return (
    <Ctx.Provider value={{ session, profile, role, perms, objectTypes, fields, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  )
}
