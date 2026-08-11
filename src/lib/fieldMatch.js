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

// Record types whose "status" is a plain free-typed text field rather than
// one flagged is_status_field — scoped narrowly by id so the flag itself
// doesn't need to be set (that would also wire the field into Kanban
// grouping and the Appointment-popup trigger, neither of which apply to a
// plain text field). Add an object_type_id here if another type needs the
// same treatment.
export const FREE_TEXT_STATUS_TYPE_IDS = ['9d0dc1be-9c8e-4e0a-b8bc-cd86ad3cb7b4']

// The field to treat as "status" for a record type — the flagged
// is_status_field if one exists, else the free-typed text fallback above.
// Used anywhere the app needs to filter/group/link by a type's status
// regardless of which of the two forms it takes.
export function resolveStatusField(objectTypeId, fieldsForType) {
  return fieldsForType.find(f => f.is_status_field) ||
    (FREE_TEXT_STATUS_TYPE_IDS.includes(objectTypeId) ? fieldsForType.find(f => f.key === 'status') : undefined)
}
