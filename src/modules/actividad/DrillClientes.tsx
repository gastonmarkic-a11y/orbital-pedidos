import { ReactNode, useState } from 'react'
import { ChevronRight } from 'lucide-react'

// Escalafón desplegable tipo Territorios: zona → provincia → ciudad → cliente.
// Se entra por tarjetas con conteo; breadcrumb para volver. Reutilizable en agenda,
// cartera y prospección (julio). El nivel de barrio se pasa como "ciudad" cuando aplica (CABA/GBA).

export interface DrillRow {
  region: string | null; provincia: string | null; localidad: string | null
  cod: string; nombre: string | null
  // cualquier campo extra lo consume renderItem
  [k: string]: unknown
}

const NIVELES = ['region', 'provincia', 'localidad'] as const
const NIVEL_LABEL = ['Zona', 'Provincia', 'Ciudad/Barrio']

export default function DrillClientes({ rows, renderItem }: { rows: DrillRow[]; renderItem: (r: DrillRow) => ReactNode }) {
  const [path, setPath] = useState<string[]>([])
  const nivel = path.length
  const val = (r: DrillRow, k: (typeof NIVELES)[number]) => (r[k] as string) || '—'
  const filtrados = rows.filter((r) => path.every((v, i) => val(r, NIVELES[i]) === v))

  const breadcrumb = (
    <div className="flex items-center gap-1.5 text-[12px] flex-wrap mb-2">
      <button onClick={() => setPath([])} className={`font-medium ${nivel ? 'text-brandDark' : 'text-ink'}`}>Todo</button>
      {path.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={12} className="text-faint" />
          <button onClick={() => setPath(path.slice(0, i + 1))} className={`font-medium ${i === nivel - 1 ? 'text-ink' : 'text-brandDark'}`}>{p}</button>
        </span>
      ))}
      {nivel > 0 && <button onClick={() => setPath(path.slice(0, -1))} className="ml-2 text-[11px] text-brandDark font-medium">← Volver</button>}
    </div>
  )

  if (nivel < NIVELES.length) {
    const key = NIVELES[nivel]
    const m: Record<string, DrillRow[]> = {}
    for (const r of filtrados) { const k = val(r, key); (m[k] ??= []).push(r) }
    const entries = Object.entries(m).sort((a, b) => b[1].length - a[1].length)
    return (
      <div>
        {breadcrumb}
        <p className="text-[10px] text-faint uppercase tracking-wide mb-1.5">{NIVEL_LABEL[nivel]} · tocá para entrar</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {entries.map(([k, rs]) => (
            <button key={k} onClick={() => setPath([...path, k])} className="text-left bg-white rounded-xl border border-black/10 p-3 transition hover:border-brand/40">
              <p className="text-sm font-semibold text-ink truncate">{k}</p>
              <p className="text-[11px] text-muted mt-0.5">{rs.length} cliente{rs.length !== 1 ? 's' : ''}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {breadcrumb}
      <p className="text-[11px] text-faint mb-1.5">{filtrados.length} cliente{filtrados.length !== 1 ? 's' : ''}</p>
      <div className="space-y-1.5">{filtrados.map((r) => renderItem(r))}</div>
    </div>
  )
}
