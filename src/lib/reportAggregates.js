// Counts records grouped by a field's value without ever fetching the full
// row set — Supabase caps a plain select() at 1000 rows, but count-only and
// grouped-count queries return exact totals straight from Postgres regardless.
import { supabase } from './supabase'

const countForValue = (objectTypeId, field, value) => {
  const q = supabase.from('records').select('id', { count: 'exact', head: true }).eq('object_type_id', objectTypeId)
  return field.field_type === 'multiselect' ? q.contains(`data->${field.key}`, [value]) : q.eq(`data->>${field.key}`, value)
}

// Fields without a fixed option list (free text) can't be grouped by a known
// set of values up front — page through all records instead, extracting only
// the one field to keep payloads small.
const countFreeTextValues = async (objectTypeId, field) => {
  const counts = new Map()
  let from = 0
  const chunk = 1000
  while (true) {
    const { data } = await supabase.from('records')
      .select(`value:data->>${field.key}`).eq('object_type_id', objectTypeId)
      .range(from, from + chunk - 1)
    if (!data || data.length === 0) break
    data.forEach(({ value }) => {
      const key = value || 'Unset'
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    if (data.length < chunk) break
    from += chunk
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

// One query, one per-option queries per group instead of one query per option.
// Falls back automatically if the RPC hasn't been deployed yet (see schema.sql).
async function legacyAggregateFieldCounts(objectTypeId, field) {
  const options = field.options || []
  if (options.length === 0) return countFreeTextValues(objectTypeId, field)

  const [{ count: total }, ...perOption] = await Promise.all([
    supabase.from('records').select('id', { count: 'exact', head: true }).eq('object_type_id', objectTypeId),
    ...options.map(o => countForValue(objectTypeId, field, o))
  ])
  const data = options.map((name, i) => ({ name, count: perOption[i].count ?? 0 }))
  const known = data.reduce((n, d) => n + d.count, 0)
  const unset = (total ?? 0) - known
  if (unset > 0) data.push({ name: 'Unset', count: unset })
  return data
}

function shapeGroupedCounts(field, rows) {
  const counts = new Map(rows.map(r => [r.value, Number(r.count)]))
  const options = field.options || []
  if (options.length === 0) {
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }
  const known = new Set(options)
  const data = options.map(name => ({ name, count: counts.get(name) || 0 }))
  // Anything not a known option — the synthetic "Unset" bucket, or a stray value
  // that doesn't match a current option — rolls into a single Unset tally.
  const extra = [...counts.entries()].reduce((n, [name, c]) => known.has(name) ? n : n + c, 0)
  if (extra > 0) data.push({ name: 'Unset', count: extra })
  return data
}

// Groups records by a field's value in a single round trip via the
// count_by_field_value RPC (see schema.sql) instead of one count query per
// option. The function runs with the caller's own permissions (no SECURITY
// DEFINER), so RLS still scopes the count the same way a normal query would.
// Multiselect fields can't be grouped this way — an array value groups by its
// whole array, not its individual members — so they use the slower per-option
// path, which is also the fallback if the RPC isn't deployed yet.
export async function aggregateFieldCounts(objectTypeId, field) {
  if (field.field_type !== 'multiselect') {
    const { data, error } = await supabase.rpc('count_by_field_value', {
      p_object_type_id: objectTypeId, p_field_key: field.key
    })
    if (!error && data) return shapeGroupedCounts(field, data)
  }
  return legacyAggregateFieldCounts(objectTypeId, field)
}
