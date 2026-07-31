import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Upload, CheckCircle2 } from 'lucide-react'

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

  const runImport = async () => {
    setBusy(true)
    const ot = objectTypes.find(o => o.id === otId)
    const payload = rows.map(row => {
      const data = {}
      defs.forEach(f => {
        const h = map[f.key]
        if (!h) return
        let val = row[h]
        if (f.field_type === 'number' || f.field_type === 'currency') val = val === '' ? null : Number(val)
        if (f.field_type === 'boolean') val = ['true','yes','1','y'].includes(String(val).toLowerCase())
        data[f.key] = val
      })
      return { org_id: ot.org_id, object_type_id: otId, owner_id: ot.default_agent_id || profile.id, created_by: profile.id, data }
    })
    // insert in chunks of 500
    let ok = 0, fail = 0
    for (let i = 0; i < payload.length; i += 500) {
      const { error, count } = await supabase.from('records').insert(payload.slice(i, i+500), { count: 'exact' })
      if (error) fail += payload.slice(i, i+500).length; else ok += (count ?? payload.slice(i,i+500).length)
    }
    setBusy(false); setResult({ ok, fail })
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
            <CheckCircle2 size={16} /> Imported {result.ok} records{result.fail ? `, ${result.fail} failed` : ''}.
          </div>
        )}
      </div>
    </div>
  )
}
