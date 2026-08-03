import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import { Download } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'

// Validated categorical palette (fixed order — see dataviz skill reference).
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const SINGLE_HUE = CATEGORICAL[0]
const OTHER_COLOR = '#c3c2b7'
const GRID_COLOR = '#E4E8EF'
const AXIS_COLOR = '#67728A'

const formatForExport = (field, value) => {
  if (value === null || value === undefined || value === '') return ''
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export default function Reports() {
  const { objectTypes, fields, perms } = useAuth()
  const viewable = useMemo(() => objectTypes.filter(ot => perms?.canView(ot.id)), [objectTypes, perms])
  const [otId, setOtId] = useState('')
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!otId && viewable[0]) setOtId(viewable[0].id)
  }, [viewable, otId])

  useEffect(() => {
    if (!otId) return
    setRows(null)
    supabase.from('records').select('*').eq('object_type_id', otId)
      .then(({ data }) => setRows(data || []))
  }, [otId])

  const ot = objectTypes.find(o => o.id === otId)
  const defs = useMemo(() =>
    fields.filter(f => f.object_type_id === otId && perms?.fieldVisible(f.id))
          .sort((a, b) => a.sort_order - b.sort_order),
    [fields, otId, perms])
  const statusField = fields.find(f => f.object_type_id === otId && f.is_status_field)
  const industryField = fields.find(f => f.object_type_id === otId &&
    (f.key?.toLowerCase() === 'industry' || f.label?.toLowerCase() === 'industry'))

  const statusData = useMemo(() => {
    if (!statusField || !rows) return []
    const opts = statusField.options || []
    const counts = new Map(opts.map(o => [o, 0]))
    let unset = 0
    rows.forEach(r => {
      const v = r.data[statusField.key]
      if (v && counts.has(v)) counts.set(v, counts.get(v) + 1)
      else unset++
    })
    const data = opts.map(o => ({ name: o, count: counts.get(o) }))
    if (unset > 0) data.push({ name: 'Unset', count: unset })
    return data
  }, [statusField, rows])

  const industryData = useMemo(() => {
    if (!industryField || !rows) return []
    const counts = new Map()
    rows.forEach(r => {
      const raw = r.data[industryField.key]
      const values = Array.isArray(raw) ? raw : (raw ? [raw] : [])
      if (values.length === 0) { counts.set('Unset', (counts.get('Unset') || 0) + 1); return }
      values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1))
    })
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [industryField, rows])

  // Pie slices are capped at 8 categorical slots; overflow folds into "Other" rather than generating more hues.
  const pieSlices = useMemo(() => {
    const nonZero = statusData.filter(d => d.count > 0)
    if (nonZero.length <= 8) return nonZero
    const top = nonZero.slice(0, 7)
    const rest = nonZero.slice(7).reduce((n, d) => n + d.count, 0)
    return [...top, { name: 'Other', count: rest }]
  }, [statusData])

  const exportExcel = () => {
    const summaryAoa = [
      ['Status', 'Count'],
      ...statusData.map(d => [d.name, d.count]),
      [],
      ['Industry', 'Count'],
      ...industryData.map(d => [d.name, d.count])
    ]
    const recordRows = (rows || []).map(r => {
      const row = {}
      defs.forEach(f => { row[f.label] = formatForExport(f, r.data[f.key]) })
      return row
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recordRows), 'Records')
    XLSX.writeFile(wb, `${(ot?.name || 'report').replace(/\s+/g, '-')}-report.xlsx`)
  }

  if (viewable.length === 0) return <p className="text-muted">No record types available to report on.</p>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <select className="input w-auto min-w-[180px]" value={otId} onChange={e => setOtId(e.target.value)}>
          {viewable.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="btn-outline ml-auto" disabled={!rows} onClick={exportExcel}>
          <Download size={15} /> Export to Excel
        </button>
      </div>

      {rows === null ? <Spinner label="Loading report…" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Records by status">
              {statusField ? (
                <>
                  <ResponsiveContainer width="100%" height={Math.max(220, statusData.length * 40 + 40)}>
                    <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
                      <XAxis type="number" allowDecimals={false} stroke={AXIS_COLOR} fontSize={12}
                        tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <YAxis type="category" dataKey="name" width={100} stroke={AXIS_COLOR} fontSize={12}
                        tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <Tooltip cursor={{ fill: 'rgba(36,86,166,0.06)' }} />
                      <Bar dataKey="count" name="Records" fill={SINGLE_HUE} radius={[0, 4, 4, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                  <TableView rows={statusData} />
                </>
              ) : <EmptyNote text="No status field is set for this record type." />}
            </ChartCard>

            <ChartCard title="Status breakdown">
              {statusField ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieSlices} dataKey="count" nameKey="name" innerRadius={55} outerRadius={90}
                      paddingAngle={2} label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}>
                      {pieSlices.map((d, i) => (
                        <Cell key={d.name} fill={d.name === 'Other' ? OTHER_COLOR : CATEGORICAL[i % CATEGORICAL.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyNote text="No status field is set for this record type." />}
            </ChartCard>
          </div>

          <ChartCard title="Records by industry">
            {industryField ? (
              industryData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={Math.max(220, industryData.length * 36 + 40)}>
                    <BarChart data={industryData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
                      <XAxis type="number" allowDecimals={false} stroke={AXIS_COLOR} fontSize={12}
                        tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <YAxis type="category" dataKey="name" width={130} stroke={AXIS_COLOR} fontSize={12}
                        tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <Tooltip cursor={{ fill: 'rgba(36,86,166,0.06)' }} />
                      <Bar dataKey="count" name="Records" fill={SINGLE_HUE} radius={[0, 4, 4, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                  <TableView rows={industryData} />
                </>
              ) : <EmptyNote text="No records have an industry value yet." />
            ) : <EmptyNote text='No "Industry" field is defined for this record type.' />}
          </ChartCard>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="card p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  )
}

function EmptyNote({ text }) {
  return <p className="py-10 text-center text-sm text-muted">{text}</p>
}

function TableView({ rows }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-t border-line first:border-0">
              <td className="py-1 pr-3 text-muted">{r.name}</td>
              <td className="py-1 text-right font-medium tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
