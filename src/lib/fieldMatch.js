// Best-effort mapping from a record type's dynamic fields to a fixed concept
// (name/company/phone/etc.) — field keys/labels vary per org, so a dedicated
// field_type (e.g. phone) is trusted first, then common key/label spellings.
export function matchField(defs, { type, keys }) {
  if (type) {
    const byType = defs.find(f => f.field_type === type)
    if (byType) return byType
  }
  return defs.find(f => keys.some(k => f.key?.toLowerCase() === k || f.label?.toLowerCase() === k))
}
