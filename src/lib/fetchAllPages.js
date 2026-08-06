// Pages through every matching row in 1000-row chunks — Supabase caps a plain
// select() at 1000, and these can all run well past that on an active org.
// buildQuery is a factory (not a pre-built query) so each page issues a fresh
// request rather than mutating and re-awaiting the same builder instance.
export async function fetchAllPages(buildQuery, pick) {
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
