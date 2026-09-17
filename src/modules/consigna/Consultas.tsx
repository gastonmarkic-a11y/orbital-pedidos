// ── Consultas de clientes derivadas por IRIS ─────────────────────────────────
// Cuando IRIS deriva a un cliente final que preguntó por un modelo a una sucursal de consigna,
// queda en consigna_consulta (RPC consigna_consulta_registrar, solo service role). La central ve
// todas; el link de sucursal ve y atiende solo las suyas.
import { useEffect, useState } from 'react'
import { MessageCircle, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import type { Central } from './CentralConsigna'

type Estado = 'nueva' | 'contactado' | 'vendio' | 'no_compro'
type Consulta = {
  id: number; sucursal_id: number; canal: string | null; cliente_nombre: string | null; cliente_tel: string | null
  modelo: string | null; codigo: string | null; mensaje: string | null; estado: Estado; atendido_por: string | null; created_at: string
}

const ESTADOS: [Estado, string, string][] = [
  ['nueva', 'Nueva', 'bg-amber-100 text-amber-900'],
  ['contactado', 'Contactado', 'bg-sky-100 text-sky-900'],
  ['vendio', 'Vendió', 'bg-emerald-100 text-emerald-900'],
  ['no_compro', 'No compró', 'bg-black/5 text-muted'],
]
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Consultas({ clave, data, quien }: { clave: string; data: Central; quien: string }) {
  const toast = useToast()
  const [items, setItems] = useState<Consulta[] | null>(null)
  const nombreSuc = (id: number) => data.sucursales.find((s) => s.id === id)?.nombre ?? `#${id}`

  useEffect(() => {
    const cargar = () => supabase.rpc('consigna_consultas', { p_k: clave }).then(({ data, error }) => {
      if (!error) setItems(data as Consulta[])
    })
    cargar()
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [clave])

  const cambiar = async (id: number, estado: Estado) => {
    if (!quien.trim()) { toast('Poné tu nombre arriba antes de operar', 'error'); return }
    const { data, error } = await supabase.rpc('consigna_consulta_estado', { p_k: clave, p_id: id, p_estado: estado, p_quien: quien.trim() })
    if (error) { toast('No se pudo actualizar', 'error'); return }
    setItems(data as Consulta[])
  }

  const nuevas = items?.filter((c) => c.estado === 'nueva').length ?? 0

  return (
    <section className="bg-white border border-black/10 rounded-lg">
      <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2 mr-auto"><MessageCircle size={16} className="text-gold" /> Consultas de clientes</h2>
        {nuevas > 0 && <span className="text-xs text-amber-700 font-medium">{nuevas} sin atender</span>}
      </div>
      <p className="text-xs text-muted px-4 pt-3">
        Clientes que preguntaron por un modelo y IRIS mandó a la sucursal. Contactalos y marcá cómo terminó.
      </p>
      {items == null ? (
        <p className="text-sm text-muted px-4 py-6">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted px-4 py-6">Todavía no hay consultas derivadas.</p>
      ) : (
        <ul className="divide-y divide-black/5 mt-2">
          {items.map((c) => {
            const tel = (c.cliente_tel ?? '').replace(/\D/g, '')
            return (
              <li key={c.id} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2 text-sm">
                <div className="w-28 shrink-0 text-xs text-muted">
                  {fecha(c.created_at)}
                  <div className="font-medium text-ink">{nombreSuc(c.sucursal_id)}</div>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <div className="text-[11px] font-semibold tracking-wide">{c.modelo ?? 'Modelo sin identificar'}</div>
                  {c.mensaje && <div className="text-xs text-muted mt-0.5">«{c.mensaje}»</div>}
                  <div className="text-xs mt-1 flex flex-wrap items-center gap-2">
                    <span>{c.cliente_nombre ?? 'Cliente'}</span>
                    {tel && (
                      <a href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 underline">
                        <Phone size={11} /> {c.cliente_tel}
                      </a>
                    )}
                    {c.canal && <span className="text-faint">· {c.canal}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ESTADOS.map(([k, label, cls]) => (
                    <button key={k} onClick={() => cambiar(c.id, k)}
                      className={`text-xs rounded-md px-2 py-1 border ${c.estado === k ? `${cls} border-transparent font-medium` : 'border-black/10 text-muted'}`}>
                      {label}
                    </button>
                  ))}
                  {c.atendido_por && c.estado !== 'nueva' && <div className="w-full text-[11px] text-faint">por {c.atendido_por}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
