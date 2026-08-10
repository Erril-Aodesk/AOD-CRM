import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FieldValue, FieldInput, PhoneCopyButton, coerceDefaultValue } from '../components/DynamicField'
import { matchField } from '../lib/fieldMatch'
import { fetchAllPages } from '../lib/fetchAllPages'
import Spinner from '../components/Spinner'
import Modal from '../components/Modal'
import AppointmentModal from '../components/AppointmentModal'
import { Plus, Search, Trash2, Check, List, LayoutGrid, ChevronLeft, ChevronRight } from 'lucide-react'

const MIN_COL_WIDTH = 90
const DEFAULT_COL_WIDTH = 160
// Kanban groups by status via one capped, indexed query per column instead of
// loading the whole table client-side — this is what keeps it usable well
// past the point where "fetch everything and group in JS" stops scaling.
// Kept short since a column's "See all in List view" button is right there
// for anything beyond a quick glance.
const KANBAN_CAP = 10

export default function RecordList() {
  const { objectTypeId } = useParams()
  const { objectTypes, fields, perms, profile } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const [kanbanData, setKanbanData] = useState(null)
  // qInput is what the search box shows immediately; q (debounced, 300ms) is
  // what actually drives queries — at 100k+ rows, querying on every keystroke
  // instead of once you pause typing is a lot of avoidable load.
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [deleteAll, setDeleteAll] = useState(false)
  const [toast, setToast] = useState('')
  const [view, setView] = useState('list')
  const [creating, setCreating] = useState(false)
  const [filterValues, setFilterValues] = useState({})
  const [colWidths, setColWidths] = useState({})
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [listRows, setListRows] = useState(null)
  const [listCount, setListCount] = useState(0)
  const [appointmentState, setAppointmentState] = useState(null)

  const ot = objectTypes.find(o => o.id === objectTypeId)
  const cols = useMemo(() =>
    fields.filter(f => f.object_type_id === objectTypeId && f.show_in_list !== false &&
      // The status field drives Kanban grouping and the filter bar regardless of a
      // role's field-view override (see statusField/filterableFields below) — keep
      // the List view's column set consistent with that instead of hiding it.
      (f.is_status_field || perms?.fieldVisible(f.id)))
          .sort((a, b) => a.sort_order - b.sort_order),
    [fields, objectTypeId, perms])
  const statusField = fields.find(f => f.object_type_id === objectTypeId && f.is_status_field)
  const statusKey = statusField?.key
  const statusOptions = statusField?.options || []
  const callbackField = fields.find(f => f.object_type_id === objectTypeId && f.key === 'callback_date_time')
  // Full field set (not just show_in_list columns) — AppointmentModal needs to
  // find fields like position/address/company that may not be list columns.
  const allFieldDefs = fields.filter(f => f.object_type_id === objectTypeId && perms?.fieldVisible(f.id))
  // Same heuristic the appointment popup uses to find these concepts among
  // this record type's dynamic fields — key/label spellings vary per org.
  const nameField = matchField(allFieldDefs, { keys: ['name', 'full_name', 'contact_name', 'lead_name'] })
  const companyField = matchField(allFieldDefs, { keys: ['company', 'business', 'business_name', 'company_name'] })
  const phoneField = matchField(allFieldDefs, { type: 'phone', keys: ['phone', 'phone_number', 'mobile'] })
  // Free-text fields that are still worth filtering on even though they're
  // not a `select` type — options are populated from distinct values already
  // present in the loaded records, same as any other filter.
  const FILTERABLE_TEXT_FIELDS = ['industry', 'state']
  const filterableFields = fields.filter(f =>
    f.object_type_id === objectTypeId && perms?.fieldVisible(f.id) &&
    (f.field_type === 'select' || f.is_status_field ||
      FILTERABLE_TEXT_FIELDS.includes(f.key?.toLowerCase()) || FILTERABLE_TEXT_FIELDS.includes(f.label?.toLowerCase()))
  ).sort((a, b) => a.sort_order - b.sort_order)

  // Select/status options come straight from the field's own admin-defined
  // list — always complete, no query needed. Free-text filterable fields
  // (Industry, State) have no fixed list, so their options come from the
  // distinct_field_values RPC (one grouped query in Postgres) instead of
  // paging through every record of this type to dedupe client-side.
  const [textFilterOptions, setTextFilterOptions] = useState({})
  const filterOptions = (field) =>
    (field.field_type === 'select' || field.is_status_field) ? (field.options || []) : (textFilterOptions[field.id] || [])

  useEffect(() => {
    const textFields = filterableFields.filter(f => f.field_type !== 'select' && !f.is_status_field)
    if (textFields.length === 0) { setTextFilterOptions({}); return }
    let cancelled = false
    Promise.all(textFields.map(async f => {
      const { data, error } = await supabase.rpc('distinct_field_values', { p_object_type_id: objectTypeId, p_field_key: f.key })
      if (!error && data) return [f.id, data.map(r => r.value).filter(Boolean)]
      // Fallback if the RPC hasn't been deployed yet — same result, slower.
      const values = await fetchAllPages(() => supabase.from('records').select(`value:data->>${f.key}`).eq('object_type_id', objectTypeId), r => r.value)
      return [f.id, [...new Set(values.filter(Boolean))].sort()]
    })).then(entries => { if (!cancelled) setTextFilterOptions(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [objectTypeId, filterableFields.map(f => f.id).join(',')])
  const activeFilterCount = filterableFields.filter(f => filterValues[f.id]).length
  const isRecordToday = (r) => {
    if (!callbackField) return false
    const raw = r.data[callbackField.key]
    if (!raw) return false
    const d = new Date(raw)
    if (isNaN(d)) return false
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }
  const byPriority = (a, b) => (isRecordToday(b) ? 1 : 0) - (isRecordToday(a) ? 1 : 0)

  // A Dashboard status tile links here with ?status=<value>. Applied synchronously
  // during render (React's supported "adjust state on prop change" escape hatch)
  // rather than in an effect, so the very first list query already carries the
  // filter — an effect would fire loadListRows once unfiltered before the state
  // update landed, racing an extra request against the correctly-filtered one.
  const appliedStatusRef = useRef(null)
  const statusParam = searchParams.get('status')
  const statusSyncKey = `${objectTypeId}::${statusParam || ''}`
  if (statusField && statusParam && appliedStatusRef.current !== statusSyncKey) {
    appliedStatusRef.current = statusSyncKey
    setFilterValues(v => ({ ...v, [statusField.id]: statusParam }))
    setPage(1)
  }

  // Column widths persist per user per record type, in this browser only.
  const colWidthsKey = profile?.id && `crm.colWidths.${profile.id}.${objectTypeId}`

  useEffect(() => {
    if (!colWidthsKey) return
    try {
      const raw = localStorage.getItem(colWidthsKey)
      setColWidths(raw ? JSON.parse(raw) : {})
    } catch {
      setColWidths({})
    }
  }, [colWidthsKey])

  // listCount comes from the same count: 'exact' query that loads the current
  // page, so it's an accurate total straight from Postgres — never capped at
  // Supabase's 1000-row response limit, and never a second, separate request.
  const totalPages = Math.max(1, Math.ceil(listCount / pageSize))
  const currentPage = Math.min(page, totalPages)

  // Search and filters are applied here, server-side, so they run against every
  // matching record instead of a client-side slice. A search term goes
  // through the search_records RPC, which also matches the
  // phone field digits-only so formatting (spaces, dashes, +) never blocks a
  // match — plain .filter('data::text','ilike',…) can't do that comparison.
  const buildListQuery = () => {
    let query = q
      ? supabase.rpc('search_records', {
          p_object_type_id: objectTypeId, p_query: q,
          p_name_key: nameField?.key || null, p_company_key: companyField?.key || null,
          p_phone_key: phoneField?.key || null
        }, { count: 'exact' })
      : supabase.from('records').select('*', { count: 'exact' }).eq('object_type_id', objectTypeId)
    filterableFields.forEach(f => {
      const sel = filterValues[f.id]
      if (!sel) return
      query = f.field_type === 'multiselect'
        ? query.contains(`data->${f.key}`, [sel])
        : query.eq(`data->>${f.key}`, sel)
    })
    return query
  }

  // One capped, filtered query per status column (plus a "no status" bucket)
  // instead of loading every record and grouping in JS — each request asks
  // Postgres for an exact count and only the newest KANBAN_CAP rows, so a
  // column with 40,000 leads costs the same as one with 40.
  const buildKanbanColumnQuery = (statusValue) => {
    let query = buildListQuery()
    if (statusValue === '__none') {
      const quoted = statusOptions.map(o => `"${String(o).replace(/"/g, '\\"')}"`).join(',')
      query = query.or(`data->>${statusKey}.is.null,data->>${statusKey}.not.in.(${quoted})`)
    } else {
      query = query.eq(`data->>${statusKey}`, statusValue)
    }
    return query.order('created_at', { ascending: false }).range(0, KANBAN_CAP - 1)
  }

  const loadKanbanData = () => {
    if (!statusField) return
    setKanbanData(null)
    const keys = [...statusOptions, '__none']
    Promise.all(keys.map(k =>
      buildKanbanColumnQuery(k).then(({ data, count }) => [k, { records: data || [], count: count ?? 0 }])
    )).then(entries => setKanbanData(Object.fromEntries(entries)))
  }

  const loadListRows = () => {
    setListRows(null)
    buildListQuery()
      .order('created_at', { ascending: false })
      .range((currentPage - 1) * pageSize, currentPage * pageSize - 1)
      .then(({ data, count }) => { setListRows(data || []); setListCount(count ?? 0) })
  }

  useEffect(() => {
    setPage(1)
  }, [objectTypeId])

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    loadListRows()
  }, [objectTypeId, q, filterValues, pageSize, currentPage])

  useEffect(() => {
    if (view === 'kanban') loadKanbanData()
  }, [view, objectTypeId, q, filterValues, statusField?.id])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleDeletedAll = (count) => {
    setDeleteAll(false)
    setToast(`Deleted ${count} record${count === 1 ? '' : 's'}`)
    setPage(1)
    loadListRows()
    if (view === 'kanban') loadKanbanData()
  }

  const widthOf = (fieldId) => colWidths[fieldId] ?? DEFAULT_COL_WIDTH

  const startResize = (e, fieldId) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = widthOf(fieldId)
    let latest = colWidths
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
      latest = { ...latest, [fieldId]: next }
      setColWidths(latest)
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Persist once, at drag end, rather than on every mousemove.
      if (colWidthsKey) {
        try { localStorage.setItem(colWidthsKey, JSON.stringify(latest)) } catch { /* storage unavailable */ }
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const saveField = async (record, field, value) => {
    const newData = { ...record.data, [field.key]: value }
    const { error } = await supabase.from('records').update({ data: newData }).eq('id', record.id)
    if (error) { alert(error.message); return false }
    setListRows(rs => rs?.map(r => r.id === record.id ? { ...r, data: newData } : r) ?? rs)
    return true
  }

  if (!ot) return <p className="text-muted">Record type not found or no access.</p>

  const columnFromBucket = (key, label, bucket) => ({
    key, label, count: bucket.count, capped: bucket.count > bucket.records.length,
    records: [...bucket.records].sort(byPriority)
  })
  const kanbanColumns = statusField && kanbanData
    ? [...statusOptions.map(o => columnFromBucket(o, o, kanbanData[o] || { records: [], count: 0 })),
       columnFromBucket('__none', '—', kanbanData.__none || { records: [], count: 0 })]
    : null

  const showColumnInList = (statusValue) => {
    if (statusValue !== '__none' && statusField) {
      setFilterValues(v => ({ ...v, [statusField.id]: statusValue }))
      setPage(1)
    }
    setView('list')
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{ot.name}</h1>
        <span className="chip bg-brand-soft text-brand-dark">{listCount}</span>
        <div className="inline-flex rounded-lg border border-line p-0.5">
          <button className={`rounded-md px-2.5 py-1.5 ${view === 'list' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            title="List view" onClick={() => setView('list')}><List size={15} /></button>
          <button className={`rounded-md px-2.5 py-1.5 ${view === 'kanban' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
            title="Kanban view" onClick={() => setView('kanban')}><LayoutGrid size={15} /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
            <input className="input pl-8 w-44 sm:w-56" placeholder="Search name, company, phone…" value={qInput}
              onChange={e => setQInput(e.target.value)} />
          </div>
          {perms?.canCreate(objectTypeId) &&
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New</button>}
          {perms?.isAdmin &&
            <button className="btn-ghost text-danger" onClick={() => setDeleteAll(true)}>
              <Trash2 size={16} /> Delete all
            </button>}
        </div>
      </div>

      {filterableFields.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {filterableFields.map(f => (
            <select key={f.id} className="input w-auto min-w-[140px]" value={filterValues[f.id] || ''}
              onChange={e => { setFilterValues(v => ({ ...v, [f.id]: e.target.value })); setPage(1) }}>
              <option value="">{f.label}: All</option>
              {filterOptions(f).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {activeFilterCount > 0 &&
            <button className="btn-ghost text-sm" onClick={() => { setFilterValues({}); setPage(1) }}>Clear filters</button>}
        </div>
      )}

      {view === 'kanban' ? (
        statusField ? (
          kanbanColumns === null ? (
            <Spinner label="Loading board…" />
          ) : (
            <KanbanBoard columns={kanbanColumns} cols={cols.slice(0, 3)} objectTypeId={objectTypeId} nav={nav}
              isToday={isRecordToday} onSeeMore={showColumnInList} />
          )
        ) : (
          <div className="card p-8 text-center text-sm text-muted">
            No status field is set for {ot.name}. Mark one as the status field in Record types to use Kanban view.
          </div>
        )
      ) : listRows === null ? (
        <Spinner label="Loading records…" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto sm:block">
            <table style={{ tableLayout: 'fixed', width: cols.reduce((sum, c) => sum + widthOf(c.id), 0), minWidth: '100%' }}>
              <colgroup>{cols.map(c => <col key={c.id} style={{ width: widthOf(c.id) }} />)}</colgroup>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c.id} className="th relative select-none">
                      <span className="block truncate pr-2">{c.label}</span>
                      <div onMouseDown={e => startResize(e, c.id)}
                        className="absolute inset-y-0 right-0 w-2 cursor-col-resize hover:bg-brand/40" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listRows.map(r => (
                  <tr key={r.id} className="cursor-pointer hover:bg-black/[.02]"
                      onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}>
                    {cols.map(c => {
                      const editable = perms?.canEdit(objectTypeId) && perms?.fieldEditable(c.id)
                      if (editable && c.is_status_field) {
                        return <td key={c.id} className="td">
                          <StatusCell field={c} value={r.data[c.key]} onSave={v => saveField(r, c, v)}
                            onAppointment={revert => setAppointmentState({ record: r, revert })} />
                        </td>
                      }
                      if (editable && c.key === 'notes') {
                        return <td key={c.id} className="td">
                          <NotesCell field={c} value={r.data[c.key]} onSave={v => saveField(r, c, v)} />
                        </td>
                      }
                      if (editable && c.key === 'callback_date_time') {
                        return <td key={c.id} className="td">
                          <DateTimeCell value={r.data[c.key]} onSave={v => saveField(r, c, v)} />
                        </td>
                      }
                      return <td key={c.id} className="td break-words"><FieldValue field={c} value={r.data[c.key]} /></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {listRows.length === 0 && <p className="p-8 text-center text-sm text-muted">No records yet. Create one or import from Excel.</p>}
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {listRows.map(r => (
              <div key={r.id} role="button" tabIndex={0} className="card w-full cursor-pointer p-4 text-left"
                onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}
                onKeyDown={e => { if (e.key === 'Enter') nav(`/records/${objectTypeId}/${r.id}`) }}>
                {cols.slice(0, 4).map(c => (
                  <div key={c.id} className="flex justify-between gap-3 py-0.5 text-sm">
                    <span className="text-muted">{c.label}</span>
                    <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                  </div>
                ))}
              </div>
            ))}
            {listRows.length === 0 && <p className="py-8 text-center text-sm text-muted">No records yet.</p>}
          </div>

          {listCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted">Rows per page</span>
                <select className="input w-auto" value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}>
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted">Page {currentPage} of {totalPages}</span>
                <button className="btn-outline !px-2.5" disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button>
                <button className="btn-outline !px-2.5" disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button>
              </div>
            </div>
          )}
        </>
      )}

      {creating &&
        <NewRecordModal ot={ot} fields={fields} perms={perms} profile={profile}
          onClose={() => setCreating(false)}
          onCreated={rec => nav(`/records/${objectTypeId}/${rec.id}`)} />}

      {deleteAll &&
        <DeleteAllModal objectTypeId={objectTypeId} typeName={ot.name}
          onClose={() => setDeleteAll(false)} onDeleted={handleDeletedAll} />}

      {appointmentState &&
        <AppointmentModal record={appointmentState.record} ot={ot} defs={allFieldDefs} statusField={statusField}
          onClose={() => { appointmentState.revert(); setAppointmentState(null) }}
          onBooked={newData => {
            const id = appointmentState.record.id
            setListRows(rs => rs?.map(r => r.id === id ? { ...r, data: newData } : r) ?? rs)
            setAppointmentState(null)
            setToast('Appointment booked and sent to manager')
          }} />}

      {toast &&
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-ok px-4 py-2.5 text-sm font-medium text-white shadow-pop">
          {toast}
        </div>}
    </div>
  )
}

const isEmptyValue = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

function NewRecordModal({ ot, fields, perms, profile, onClose, onCreated }) {
  const defs = fields.filter(f => f.object_type_id === ot.id && perms?.fieldVisible(f.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  const [data, setData] = useState(() => {
    const initial = {}
    defs.forEach(f => {
      const dv = coerceDefaultValue(f)
      if (dv !== undefined) initial[f.key] = dv
    })
    return initial
  })
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const missing = defs.filter(f => f.is_required && isEmptyValue(data[f.key]))

  const save = async () => {
    if (missing.length > 0) { setAttempted(true); return }
    setSaving(true)
    const { data: rec, error } = await supabase.from('records')
      .insert({ object_type_id: ot.id, data,
                owner_id: ot.default_agent_id || profile.id,
                org_id: ot.org_id }).select().single()
    setSaving(false)
    if (error) return alert(error.message)
    onCreated(rec)
  }

  return (
    <Modal title={`New ${ot.name}`} onClose={onClose} wide
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="space-y-3">
        {attempted && missing.length > 0 && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Please fill in: {missing.map(f => f.label).join(', ')}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {defs.map(f => {
            const editable = perms?.fieldEditable(f.id)
            const isMissing = attempted && f.is_required && isEmptyValue(data[f.key])
            return (
              <div key={f.id} className={f.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label">{f.label}{f.is_required && <span className="text-danger"> *</span>}</label>
                {f.field_type === 'phone' ? (
                  <div className="flex items-center gap-2">
                    <FieldInput field={f} value={data[f.key]} disabled={!editable}
                      onChange={v => setData(d => ({ ...d, [f.key]: v }))} />
                    <PhoneCopyButton value={data[f.key]} />
                  </div>
                ) : (
                  <FieldInput field={f} value={data[f.key]} disabled={!editable}
                    onChange={v => setData(d => ({ ...d, [f.key]: v }))} />
                )}
                {isMissing && <p className="mt-1 text-xs text-danger">Required</p>}
              </div>
            )
          })}
          {defs.length === 0 && <p className="text-sm text-muted sm:col-span-2">No fields defined yet for this record type.</p>}
        </div>
      </div>
    </Modal>
  )
}

function DeleteAllModal({ objectTypeId, typeName, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    const { error, count } = await supabase.from('records')
      .delete({ count: 'exact' }).eq('object_type_id', objectTypeId)
    setDeleting(false)
    if (error) return alert(error.message)
    onDeleted(count ?? 0)
  }

  return (
    <Modal title={`Delete all "${typeName}" records`} onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-danger" disabled={confirmText !== typeName || deleting} onClick={remove}>
          {deleting ? 'Deleting…' : 'Delete all'}
        </button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          This permanently deletes every record of type <strong>{typeName}</strong>. This cannot be undone.
        </p>
        <div>
          <label className="label">Type "{typeName}" to confirm</label>
          <input className="input" value={confirmText} onChange={e => setConfirmText(e.target.value)}
            placeholder={typeName} />
        </div>
      </div>
    </Modal>
  )
}

function StatusCell({ field, value, onSave, onAppointment }) {
  const [saved, setSaved] = useState(false)
  // "Appointment" is deferred: selecting it opens the booking popup instead of
  // saving right away, so the dropdown shows it optimistically until the popup
  // is submitted (real save) or cancelled (reverts, since nothing was ever saved).
  const [pending, setPending] = useState(false)

  useEffect(() => { if (value === 'Appointment') setPending(false) }, [value])

  const change = async (e) => {
    const newValue = e.target.value
    if (newValue === 'Appointment') {
      setPending(true)
      onAppointment?.(() => setPending(false))
      return
    }
    const ok = await onSave(newValue)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <select className="input !h-8 !py-1 text-sm" value={pending ? 'Appointment' : (value ?? '')} onChange={change}>
        <option value="">—</option>
        {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function NotesCell({ field, value, onSave }) {
  const [text, setText] = useState(value ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setText(value ?? '') }, [value])

  const commit = async () => {
    if (text === (value ?? '')) return
    const ok = await onSave(text)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input className="input !h-8 !py-1 text-sm" value={text}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} />
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function DateTimeCell({ value, onSave }) {
  const [val, setVal] = useState(value ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setVal(value ?? '') }, [value])

  const commit = async () => {
    if (val === (value ?? '')) return
    const ok = await onSave(val)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input type="datetime-local" className="input !h-8 !py-1 text-sm" value={val}
        onChange={e => setVal(e.target.value)} onBlur={commit} />
      {saved && <Check size={14} className="shrink-0 text-ok" />}
    </div>
  )
}

function KanbanBoard({ columns, cols, objectTypeId, nav, isToday, onSeeMore }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map(col => (
        <div key={col.key} className="w-72 shrink-0">
          <div className="mb-2 flex items-center gap-2 px-1">
            <h3 className="text-sm font-semibold">{col.label}</h3>
            <span className="chip bg-brand-soft text-brand-dark">{col.count}</span>
          </div>
          <div className="space-y-2">
            {col.records.map(r => {
              const today = isToday(r)
              return (
                <div key={r.id} role="button" tabIndex={0}
                  className={`card w-full cursor-pointer p-3 text-left transition-shadow hover:shadow-pop ${today ? 'border-warn ring-1 ring-warn/40' : ''}`}
                  onClick={() => nav(`/records/${objectTypeId}/${r.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') nav(`/records/${objectTypeId}/${r.id}`) }}>
                  {today && <span className="mb-1.5 inline-block rounded-full bg-warn px-2 py-0.5 text-[10px] font-semibold text-white">Today</span>}
                  {cols.map(c => (
                    <div key={c.id} className="flex justify-between gap-3 py-0.5 text-xs">
                      <span className="text-muted">{c.label}</span>
                      <span className="text-right"><FieldValue field={c} value={r.data[c.key]} /></span>
                    </div>
                  ))}
                </div>
              )
            })}
            {col.records.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted">No records</p>}
            {col.capped && col.key !== '__none' && (
              <button className="btn-outline w-full text-xs" onClick={() => onSeeMore(col.key)}>
                See all {col.count} in List view
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
