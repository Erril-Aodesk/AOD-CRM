export default function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
