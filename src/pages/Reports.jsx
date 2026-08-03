import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { aggregateFieldCounts } from '../lib/reportAggregates'
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

// Fetches every matching record in 1000-row pages — a plain select() alone would
// silently stop at Supabase's default response cap.
const fetchAllRecords = async (otId) => {
  const all = []
  let from = 0
  const chunk = 1000
  while (true) {
    const { data } = await supabase.from('records').select('*').eq('object_type_id', otId).range(from, from + chunk - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < chunk) break
    from += chunk
  }
  return all
}

export default function Reports() {
  const { objectTypes, fields, perms } = useAuth()
  const viewable = useMemo(() => objectTypes.filter(ot => perms?.canView(ot.id)), [objectTypes, perms])
  const [otId, setOtId] = useState('')
  const [statusData, setStatusData] = useState(null)
  const [industryData, setIndustryData] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!otId && viewable[0]) setOtId(viewable[0].id)
  }, [viewable, otId])

  const ot = objectTypes.find(o => o.id === otId)
  const defs = useMemo(() =>
    fields.filter(f => f.object_type_id === otId && perms?.fieldVisible(f.id))
          .sort((a, b) => a.sort_order - b.sort_order),
    [fields, otId, perms])
  const statusField = fields.find(f => f.object_type_id === otId && f.is_status_field)
  const industryField = fields.find(f => f.object_type_id === otId &&
    (f.key?.toLowerCase() === 'industry' || f.label?.toLowerCase() === 'industry'))

  useEffect(() => {
    if (!otId) return
    setStatusData(null)
    setIndustryData(null)
    if (statusField) aggregateFieldCounts(otId, statusField).then(setStatusData)
    else setStatusData([])
    if (industryField) aggregateFieldCounts(otId, industryField).then(setIndustryData)
    else setIndustryData([])
  }, [otId, statusField, industryField])

  const loading = statusData === null || industryData === null

  // Pie slices are capped at 8 categorical slots; overflow folds into "Other" rather than generating more hues.
  const pieSlices = useMemo(() => {
    const nonZero = (statusData || []).filter(d => d.count > 0)
    if (nonZero.length <= 8) return nonZero
    const top = nonZero.slice(0, 7)
    const rest = nonZero.slice(7).reduce((n, d) => n + d.count, 0)
    return [...top, { name: 'Other', count: rest }]
  }, [statusData])

  const exportExcel = async () => {
    setExporting(true)
    const allRecords = await fetchAllRecords(otId)
    setExporting(false)

    const summaryAoa = [
      ['Status', 'Count'],
      ...(statusData || []).map(d => [d.name, d.count]),
      [],
      ['Industry', 'Count'],
      ...(industryData || []).map(d => [d.name, d.count])
    ]
    const recordRows = allRecords.map(r => {
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
        <button className="btn-outline ml-auto" disabled={loading || exporting} onClick={exportExcel}>
          <Download size={15} /> {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {loading ? <Spinner label="Loading report…" /> : (
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
