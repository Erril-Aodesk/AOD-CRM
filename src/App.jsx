import { lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Spinner from './components/Spinner'
import Layout from './components/Layout'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'

// Routed pages are code-split so the initial bundle only ships what a fresh
// login actually needs — Reports (recharts) and ImportExcel (xlsx) are large
// libraries that previously loaded on every visit even to the Dashboard.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const RecordList = lazy(() => import('./pages/RecordList'))
const RecordDetail = lazy(() => import('./pages/RecordDetail'))
const Callbacks = lazy(() => import('./pages/Callbacks'))
const Reports = lazy(() => import('./pages/Reports'))
const Appointments = lazy(() => import('./pages/Appointments'))
const Activity = lazy(() => import('./pages/Activity'))
const ImportExcel = lazy(() => import('./pages/ImportExcel'))
const ObjectTypes = lazy(() => import('./pages/admin/ObjectTypes'))
const Permissions = lazy(() => import('./pages/admin/Permissions'))
const UsersAdmin = lazy(() => import('./pages/admin/Users'))

function RequireAdmin({ children }) {
  const { perms } = useAuth()
  if (!perms?.isAdmin) return <Navigate to="/" replace />
  return children
}

function RequireManager({ children }) {
  const { perms } = useAuth()
  if (!perms?.isManager) return <Navigate to="/" replace />
  return children
}

function RequireActivityAccess({ children }) {
  const { perms } = useAuth()
  if (!perms?.canViewActivity) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { session, profile, loading } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/*" element={
        loading ? <Spinner label="Loading your workspace…" />
        : !session ? <Navigate to="/login" replace />
        : !profile ? <NoProfile />
        : <Layout />
      }>
        <Route index element={<Dashboard />} />
        <Route path="records/:objectTypeId" element={<RecordList />} />
        <Route path="records/:objectTypeId/:recordId" element={<RecordDetail />} />
        <Route path="callbacks" element={<Callbacks />} />
        <Route path="reports" element={<RequireManager><Reports /></RequireManager>} />
        <Route path="appointments" element={<RequireManager><Appointments /></RequireManager>} />
        <Route path="activity" element={<RequireActivityAccess><Activity /></RequireActivityAccess>} />
        <Route path="import" element={<ImportExcel />} />
        <Route path="admin/objects" element={<RequireAdmin><ObjectTypes /></RequireAdmin>} />
        <Route path="admin/permissions" element={<RequireAdmin><Permissions /></RequireAdmin>} />
        <Route path="admin/users" element={<RequireAdmin><UsersAdmin /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}

function NoProfile() {
  const { signOut } = useAuth()
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="card max-w-md p-8">
        <h2 className="text-lg font-semibold">No workspace access yet</h2>
        <p className="mt-2 text-sm text-muted">Your account isn't linked to a workspace. Ask an admin to invite you, or check your invite link.</p>
        <button className="btn-outline mt-5" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
