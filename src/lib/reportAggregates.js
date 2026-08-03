// Counts records grouped by a field's value without ever fetching the full
// row set — Supabase caps a plain select() at 1000 rows, but count-only
// queries (head: true) return an exact total regardless of that cap.
import { supabase } from './supabase'

const countForValue = (objectTypeId, field, value) => {
  const q = supabase.from('records').select('id', { count: 'exact', head: true }).eq('object_type_id', objectTypeId)
  return field.field_type === 'multiselect' ? q.contains(`data->${field.key}`, [value]) : q.eq(`data->>${field.key}`, value)
}

// Fields without a fixed option list (free text) can't be aggregated with one
// query per value, since the values aren't known up front — page through all
// records instead, extracting only the one field to keep payloads small.
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

export async function aggregateFieldCounts(objectTypeId, field) {
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
