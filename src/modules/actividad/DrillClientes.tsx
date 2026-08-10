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

// Normalización para AGRUPAR: colapsa espacios, saca acentos y case → misma clave para
// "mendoza"/"Mendoza"/"MENDOZA " o "Lanús"/"LANUS". Así el escalafón no se parte por tipeo.
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const canon = (s: string | null | undefined) => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') || '—'
const esPlaceholder = (s: string) => /^\(|^—$|^sin (zona|provincia|ciudad)/i.test(s)
// Etiqueta legible: Title Case, salvo placeholders "(sin …)" / "Sin zona" que se dejan igual.
const titulo = (s: string) => esPlaceholder(s) ? s : s.replace(/\p{L}[\p{L}'’]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())

export default function DrillClientes({ rows, renderItem }: { rows: DrillRow[]; renderItem: (r: DrillRow) => ReactNode }) {
  // path guarda las claves CANÓNICAS (case-insensitive) de cada nivel
  const [path, setPath] = useState<string[]>([])
  const nivel = path.length
  const canonOf = (r: DrillRow, k: (typeof NIVELES)[number]) => canon(r[k] as string)
  const filtrados = rows.filter((r) => path.every((v, i) => canonOf(r, NIVELES[i]) === v))

  const breadcrumb = (
    <div className="flex items-center gap-1.5 text-[12px] flex-wrap mb-2">
      <button onClick={() => setPath([])} className={`font-medium ${nivel ? 'text-brandDark' : 'text-ink'}`}>Todo</button>
      {path.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight size={12} className="text-faint" />
          <button onClick={() => setPath(path.slice(0, i + 1))} className={`font-medium ${i === nivel - 1 ? 'text-ink' : 'text-brandDark'}`}>{titulo(p)}</button>
        </span>
      ))}
      {nivel > 0 && <button onClick={() => setPath(path.slice(0, -1))} className="ml-2 text-[11px] text-brandDark font-medium">← Volver</button>}
    </div>
  )

  if (nivel < NIVELES.length) {
    const key = NIVELES[nivel]
    const m: Record<string, { display: string; rows: DrillRow[] }> = {}
    for (const r of filtrados) {
      const c = canonOf(r, key)
      ;(m[c] ??= { display: titulo(norm(r[key] as string) || '—'), rows: [] }).rows.push(r)
    }
    const entries = Object.entries(m).sort((a, b) => b[1].rows.length - a[1].rows.length)
    return (
      <div>
        {breadcrumb}
        <p className="text-[10px] text-faint uppercase tracking-wide mb-1.5">{NIVEL_LABEL[nivel]} · tocá para entrar</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {entries.map(([c, g]) => (
            <button key={c} onClick={() => setPath([...path, c])} className="text-left bg-white rounded-xl border border-black/10 p-3 transition hover:border-brand/40">
              <p className="text-sm font-semibold text-ink truncate">{g.display}</p>
              <p className="text-[11px] text-muted mt-0.5">{g.rows.length} cliente{g.rows.length !== 1 ? 's' : ''}</p>
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
