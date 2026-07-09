export default function ProgressBar({ label, real, objetivo }: { label: string; real: number; objetivo: number }) {
  const pct = objetivo > 0 ? Math.min(100, Math.round((real / objetivo) * 100)) : 0
  const color = pct >= 100 ? '#10b981' : pct >= 60 ? '#7048e8' : pct >= 30 ? '#f59e0b' : '#ef4444'
  return (
    <div>
      <div className="flex justify-between text-xs text-muted mb-1">
        <span>{label}</span>
        <span className="font-medium text-ink">
          {real} / {objetivo || '—'} {objetivo > 0 && <span className="text-faint">({pct}%)</span>}
        </span>
      </div>
      <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${objetivo > 0 ? pct : 0}%`, background: color }}
        />
      </div>
    </div>
  )
}
