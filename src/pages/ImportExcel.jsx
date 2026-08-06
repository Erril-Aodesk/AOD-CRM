import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { coerceDefaultValue } from '../components/DynamicField'
import { matchField } from '../lib/fieldMatch'
import { fetchAllPages } from '../lib/fetchAllPages'
import { Upload, CheckCircle2 } from 'lucide-react'

const normalizePhone = (v) => String(v ?? '').replace(/[^0-9]/g, '')

export default function ImportExcel() {
  const { objectTypes, fields, perms, profile } = useAuth()
  const creatable = objectTypes.filter(ot => perms?.canCreate(ot.id))
  const [otId, setOtId] = useState('')
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [map, setMap] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const defs = fields.filter(f => f.object_type_id === otId).sort((a,b)=>a.sort_order-b.sort_order)

  const onFile = async (file) => {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
    setRows(json)
    const hs = json.length ? Object.keys(json[0]) : []
    setHeaders(hs)
    // auto-map by matching header to field label/key
    const auto = {}
    defs.forEach(f => {
      const hit = hs.find(h => h.toLowerCase() === f.label.toLowerCase() || h.toLowerCase() === f.key.toLowerCase())
      if (hit) auto[f.key] = hit
    })
    setMap(auto)
    setResult(null)
  }

  const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

  const runImport = async () => {
    setBusy(true)
    const ot = objectTypes.find(o => o.id === otId)

    // Duplicate check is keyed on whichever field is the phone field for this
    // record type, and only runs if that field is actually mapped to a column.
    const phoneField = matchField(defs, { type: 'phone', keys: ['phone', 'phone_number', 'mobile'] })
    const phoneKey = phoneField && map[phoneField.key] ? phoneField.key : null

    // recordId -> normalized phone, for every existing record of this type.
    // Paginated so the check covers everything, not just the first 1000.
    const phoneToId = new Map()
    if (phoneKey) {
      const existing = await fetchAllPages(
        () => supabase.from('records').select(`id, value:data->>${phoneKey}`).eq('object_type_id', otId)
      )
      existing.forEach(r => { const n = normalizePhone(r.value); if (n) phoneToId.set(n, r.id) })
    }

    const payload = []
    const mergeGroups = new Map() // existing record id -> array of incoming data objects
    const fileSeenPhones = new Set()
    let duplicates = 0

    rows.forEach(row => {
      const data = {}
      defs.forEach(f => {
        const h = map[f.key]
        let val = h ? row[h] : undefined
        if (h) {
          if (f.field_type === 'number' || f.field_type === 'currency') val = val === '' ? '' : Number(val)
          if (f.field_type === 'boolean') val = ['true','yes','1','y'].includes(String(val).toLowerCase())
        }
        if (val === undefined || val === '') {
          const dv = coerceDefaultValue(f)
          if (dv !== undefined) val = dv
        }
        if (val !== undefined && val !== '') data[f.key] = val
      })

      const n = phoneKey && data[phoneKey] ? normalizePhone(data[phoneKey]) : ''
      if (n && phoneToId.has(n)) {
        // Matches a record already in the database — merge into it instead
        // of inserting, and instead of skipping it outright.
        const id = phoneToId.get(n)
        if (!mergeGroups.has(id)) mergeGroups.set(id, [])
        mergeGroups.get(id).push(data)
        return
      }
      if (n && fileSeenPhones.has(n)) {
        // Same phone appears twice in this file, neither matching an
        // existing record — nothing to merge into yet, so just skip the repeat.
        duplicates++
        return
      }
      if (n) fileSeenPhones.add(n)
      payload.push({ org_id: ot.org_id, object_type_id: otId, owner_id: ot.default_agent_id || profile.id, created_by: profile.id, data })
    })

    // insert in chunks of 500
    let ok = 0, fail = 0
    for (let i = 0; i < payload.length; i += 500) {
      const { error, count } = await supabase.from('records').insert(payload.slice(i, i+500), { count: 'exact' })
      if (error) fail += payload.slice(i, i+500).length; else ok += (count ?? payload.slice(i,i+500).length)
    }

    // Fill in only whatever's currently blank on each matched existing
    // record — anything already filled in (status included) is left alone,
    // and "Assigned to" (owner_id) is never touched by an import.
    let updated = 0
    if (mergeGroups.size > 0) {
      const ids = [...mergeGroups.keys()]
      const { data: existingRecords } = await supabase.from('records').select('id, data').in('id', ids)
      const currentById = new Map((existingRecords || []).map(r => [r.id, { ...(r.data || {}) }]))
      for (const [id, incomingRows] of mergeGroups) {
        const merged = currentById.get(id) || {}
        let changed = false
        incomingRows.forEach(incoming => {
          Object.entries(incoming).forEach(([k, v]) => {
            if (isBlank(merged[k])) { merged[k] = v; changed = true }
          })
        })
        if (changed) {
          const { error } = await supabase.from('records').update({ data: merged }).eq('id', id)
          if (!error) updated++
        }
      }
    }

    setBusy(false); setResult({ ok, fail, duplicates, updated })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Import from Excel</h1>
      <p className="mt-1 text-sm text-muted">Upload an .xlsx file, map its columns to fields, and create records in bulk.</p>

      <div className="card mt-5 p-5 space-y-5">
        <div>
          <label className="label">Record type</label>
          <select className="input" value={otId} onChange={e => { setOtId(e.target.value); setRows([]); setHeaders([]) }}>
            <option value="">Choose a record type…</option>
            {creatable.map(ot => <option key={ot.id} value={ot.id}>{ot.name}</option>)}
          </select>
        </div>

        {otId && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-8 text-muted hover:bg-black/[.02]">
            <Upload size={22} />
            <span className="text-sm">{rows.length ? `${rows.length} rows loaded — choose another file to replace` : 'Click to choose an .xlsx / .csv file'}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          </label>
        )}

        {headers.length > 0 && (
          <div>
            <p className="label">Map columns</p>
            <div className="space-y-2">
              {defs.map(f => (
                <div key={f.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm">{f.label}</span>
                  <select className="input" value={map[f.key] || ''}
                    onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button className="btn-primary mt-4" disabled={busy} onClick={runImport}>
              {busy ? 'Importing…' : `Import ${rows.length} records`}
            </button>
          </div>
        )}

        {result && (
          <div className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
            <CheckCircle2 size={16} /> Imported {result.ok} new record{result.ok === 1 ? '' : 's'}
            {result.updated ? `, filled in missing details on ${result.updated} existing record${result.updated === 1 ? '' : 's'} matched by phone number` : ''}
            {result.duplicates ? `, skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} within the file` : ''}
            {result.fail ? `, ${result.fail} failed` : ''}.
          </div>
        )}
      </div>
    </div>
  )
}
