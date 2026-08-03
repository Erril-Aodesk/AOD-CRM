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

const PERIODS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biyearly', label: 'Bi-yearly' },
  { value: 'yearly', label: 'Yearly' }
]

// Changes INTO these statuses are what the conversions chart tracks, in a fixed
// order so each keeps the same categorical color regardless of which periods
// have data.
const CONVERSION_STATUSES = ['Callback', 'Disconnected', 'Qualified', 'Rejected', 'Not Interested']

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Lexicographically-sortable bucket key — zero-padded so string sort order
// always matches chronological order, for any of the four granularities.
const periodKey = (dateStr, period) => {
  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = d.getMonth()
  if (period === 'quarterly') return `${y}-Q${Math.floor(m / 3) + 1}`
  if (period === 'biyearly') return `${y}-H${m < 6 ? 1 : 2}`
  if (period === 'yearly') return `${y}`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

const periodLabel = (key, period) => {
  if (period === 'monthly') {
    const [y, m] = key.split('-')
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`
  }
  return key
}

const bucketCounts = (dates, period) => {
  const counts = new Map()
  dates.forEach(d => {
    const key = periodKey(d, period)
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return [...counts.keys()].sort().map(key => ({ period: periodLabel(key, period), count: counts.get(key) }))
}

const bucketConversions = (rows, period) => {
  const buckets = new Map()
  rows.forEach(({ new_status, changed_at }) => {
    const key = periodKey(changed_at, period)
    if (!buckets.has(key)) buckets.set(key, {})
    const b = buckets.get(key)
    b[new_status] = (b[new_status] || 0) + 1
  })
  return [...buckets.keys()].sort().map(key => {
    const counts = buckets.get(key)
    const row = { period: periodLabel(key, period) }
    CONVERSION_STATUSES.forEach(s => { row[s] = counts[s] || 0 })
    return row
  })
}

const formatForExport = (field, value) => {
  if (value === null || value === undefined || value === '') return ''
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return value
}

// Pages through every matching row in 1000-row chunks — Supabase caps a plain
// select() at 1000, and these can all run well past that on an active org.
// buildQuery is a factory (not a pre-built query) so each page issues a fresh
// request rather than mutating and re-awaiting the same builder instance.
async function fetchAllPages(buildQuery, pick) {
  const results = []
  let from = 0
  const chunk = 1000
  while (true) {
    const { data } = await buildQuery().range(from, from + chunk - 1)
    if (!data || data.length === 0) break
    results.push(...(pick ? data.map(pick) : data))
    if (data.length < chunk) break
    from += chunk
  }
  return results
}

const fetchAllRecords = (otId) =>
  fetchAllPages(() => supabase.from('records').select('*').eq('object_type_id', otId))

const fetchCreatedDates = (otId) =>
  fetchAllPages(() => supabase.from('records').select('created_at').eq('object_type_id', otId), r => r.created_at)

const fetchCallbackDates = (otId, fieldKey) =>
  fetchAllPages(
    () => supabase.from('records').select(`value:data->>${fieldKey}`).eq('object_type_id', otId).not(`data->>${fieldKey}`, 'is', null),
    r => r.value
  )

const fetchStatusChanges = (otId, orgId) =>
  fetchAllPages(() =>
    supabase.from('status_history').select('new_status, changed_at')
      .eq('org_id', orgId).eq('object_type_id', otId).in('new_status', CONVERSION_STATUSES)
  )

export default function Reports() {
  const { objectTypes, fields, perms } = useAuth()
  const viewable = useMemo(() => objectTypes.filter(ot => perms?.canView(ot.id)), [objectTypes, perms])
  const [otId, setOtId] = useState('')
  const [statusData, setStatusData] = useState(null)
  const [industryData, setIndustryData] = useState(null)
  const [period, setPeriod] = useState('monthly')
  const [createdDates, setCreatedDates] = useState(null)
  const [callbackDates, setCallbackDates] = useState(null)
  const [statusChanges, setStatusChanges] = useState(null)
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
  const callbackField = fields.find(f => f.object_type_id === otId && f.key === 'callback_date_time')

  useEffect(() => {
    if (!otId) return
    setStatusData(null)
    setIndustryData(null)
    if (statusField) aggregateFieldCounts(otId, statusField).then(setStatusData)
    else setStatusData([])
    if (industryField) aggregateFieldCounts(otId, industryField).then(setIndustryData)
    else setIndustryData([])
  }, [otId, statusField, industryField])

  useEffect(() => {
    if (!otId) return
    setCreatedDates(null)
    setCallbackDates(null)
    setStatusChanges(null)
    fetchCreatedDates(otId).then(setCreatedDates)
    if (callbackField) fetchCallbackDates(otId, callbackField.key).then(setCallbackDates)
    else setCallbackDates([])
    fetchStatusChanges(otId, ot?.org_id).then(setStatusChanges)
  }, [otId, callbackField, ot?.org_id])

  const loading = statusData === null || industryData === null
  const trendsLoading = createdDates === null || callbackDates === null || statusChanges === null

  const leadsByPeriod = useMemo(() => bucketCounts(createdDates || [], period), [createdDates, period])
  const callbacksByPeriod = useMemo(() => bucketCounts(callbackDates || [], period), [callbackDates, period])
  const conversionsByPeriod = useMemo(() => bucketConversions(statusChanges || [], period), [statusChanges, period])

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
    const leadsAoa = [['Period', 'Leads created'], ...leadsByPeriod.map(d => [d.period, d.count])]
    const callbacksAoa = [['Period', 'Callbacks'], ...callbacksByPeriod.map(d => [d.period, d.count])]
    const conversionsAoa = [
      ['Period', ...CONVERSION_STATUSES],
      ...conversionsByPeriod.map(d => [d.period, ...CONVERSION_STATUSES.map(s => d[s])])
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recordRows), 'Records')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(leadsAoa), 'Leads by Period')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(callbacksAoa), 'Callbacks by Period')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(conversionsAoa), 'Status Conversions')
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

          <div className="mb-1 mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Trends</h2>
            <select className="input w-auto" value={period} onChange={e => setPeriod(e.target.value)}>
              {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {trendsLoading ? <Spinner label="Loading trends…" /> : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Leads created">
                  {leadsByPeriod.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={leadsByPeriod} margin={{ top: 8, right: 8 }}>
                        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                        <XAxis dataKey="period" stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                        <YAxis allowDecimals={false} stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                        <Tooltip cursor={{ fill: 'rgba(36,86,166,0.06)' }} />
                        <Bar dataKey="count" name="Leads" fill={SINGLE_HUE} radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyNote text="No records yet for this period breakdown." />}
                </ChartCard>

                <ChartCard title="Callbacks">
                  {callbackField ? (
                    callbacksByPeriod.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={callbacksByPeriod} margin={{ top: 8, right: 8 }}>
                          <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                          <XAxis dataKey="period" stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                          <YAxis allowDecimals={false} stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                          <Tooltip cursor={{ fill: 'rgba(36,86,166,0.06)' }} />
                          <Bar dataKey="count" name="Callbacks" fill={CATEGORICAL[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyNote text="No callbacks scheduled yet." />
                  ) : <EmptyNote text="No callback date field is defined for this record type." />}
                </ChartCard>
              </div>

              <ChartCard title="Status conversions">
                {conversionsByPeriod.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={conversionsByPeriod} margin={{ top: 8, right: 8 }}>
                      <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                      <XAxis dataKey="period" stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <YAxis allowDecimals={false} stroke={AXIS_COLOR} fontSize={12} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
                      <Tooltip />
                      <Legend />
                      {CONVERSION_STATUSES.map((s, i) => (
                        <Bar key={s} dataKey={s} fill={CATEGORICAL[i % CATEGORICAL.length]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyNote text="No status changes recorded into any of the tracked statuses yet." />}
              </ChartCard>
            </>
          )}
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
