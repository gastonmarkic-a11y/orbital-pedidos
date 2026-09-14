// ── Propuestas de colección · bandeja de Orbital ────────────────────────────────
// Lo que los promotores de colección (hoy Zaira) proponen sumar. Es la segunda aprobación:
// al aprobar, colab-coleccion-subir mueve ESE SKU a la colección de la tienda.
import { useEffect, useState } from 'react'
import { Check, X, RefreshCw, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, kAr } from './colabUtil'

type Estado = 'pendiente' | 'aprobado' | 'subido' | 'rechazado' | 'error'
type Prop = {
  id: number; influencer_id: number; influencer: string; coleccion: string | null
  product_id: number; handle: string; sku: string | null; modelo: string | null; color: string | null
  imagen: string | null; price: number | null; disponible: boolean
  ok_promotor: boolean; ok_orbital: boolean; estado: Estado; detalle: string | null; updated_at: string
}

const GRUPOS: { k: Estado; t: string; sub: string }[] = [
  { k: 'pendiente', t: 'Para aprobar', sub: 'Con tu aprobación se suben a la colección de la tienda.' },
  { k: 'error', t: 'Aprobados que no se pudieron subir', sub: 'Reintentá, o agregalos a mano en Shopify.' },
  { k: 'aprobado', t: 'Aprobados · subiendo', sub: 'Si quedan acá, reintentá.' },
  { k: 'subido', t: 'Ya en la colección', sub: 'Movidos a la tienda con las dos aprobaciones.' },
  { k: 'rechazado', t: 'No aprobados', sub: '' },
]

const TIENDA = 'https://www.orbitaleyewear.com.ar'

export default function ColabPropuestas({ clave }: { clave: string }) {
  const [filas, setFilas] = useState<Prop[] | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = () => supabase.rpc('colab_orbital_propuestas', { p_clave: clave }).then(({ data }) => setFilas((data as Prop[]) ?? []))
  useEffect(() => { cargar() }, [clave])

  async function subir(id: number) {
    const { data } = await supabase.functions.invoke('colab-coleccion-subir', { body: { clave, id } })
    const r = data as { ok: boolean; detalle?: string; error?: string } | null
    if (!r?.ok) setAviso(r?.detalle ?? r?.error ?? 'No se pudo subir a la tienda.')
  }

  async function aprobar(p: Prop) {
    setOcupado(p.id); setAviso(null)
    const { data, error } = await supabase.rpc('colab_coleccion_marcar', {
      p_clave: clave, p_product_id: p.product_id, p_valor: true, p_influencer: p.influencer_id,
    })
    if (error) setAviso(/sin_stock/.test(error.message) ? 'Ese color se quedó sin stock en la tienda.' : /ya_en_coleccion/.test(error.message) ? 'Ya está en la colección.' : 'No se pudo aprobar.')
    else {
      const r = data as { id: number | null; estado: Estado | null } | null
      if (r?.estado === 'aprobado' && r.id) await subir(r.id)
    }
    await cargar(); setOcupado(null)
  }

  async function rechazar(p: Prop) {
    const nota = window.prompt('¿Por qué no? (opcional, lo ve el promotor)', '')
    if (nota === null) return
    setOcupado(p.id)
    await supabase.rpc('colab_coleccion_rechazar', { p_clave: clave, p_id: p.id, p_nota: nota })
    await cargar(); setOcupado(null)
  }

  async function reintentar(p: Prop) {
    setOcupado(p.id); setAviso(null)
    await subir(p.id)
    await cargar(); setOcupado(null)
  }

  if (!filas) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Propuestas de colección</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Anteojos que un promotor de colección quiere sumar. Se mueve el color (SKU) propuesto, no el modelo entero,
          y solo con las dos aprobaciones.
        </p>
      </div>
      {aviso && <p className="text-[11px] text-red-600 mb-3">{aviso}</p>}
      {filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center text-[12px] text-neutral-600">Todavía no hay propuestas.</div>
      )}

      {GRUPOS.map((g) => {
        const del = filas.filter((f) => f.estado === g.k)
        if (!del.length) return null
        return (
          <section key={g.k} className="mb-6">
            <div className="mb-2 border-b border-black/10 pb-1">
              <h2 className="text-[12px] font-bold uppercase tracking-wide">{g.t} <span className="text-neutral-400">· {del.length}</span></h2>
              {g.sub && <p className="text-[10px] text-neutral-500">{g.sub}</p>}
            </div>
            <div className="space-y-2">
              {del.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-black/10 p-3 flex gap-3 items-center">
                  <div className="w-20 h-14 shrink-0">{p.imagen && <img src={p.imagen} alt={p.modelo ?? ''} className="w-full h-full object-contain" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold uppercase tracking-wide truncate">{p.modelo}</div>
                    <div className="text-[10px] text-neutral-600 truncate">{p.color ?? '—'}</div>
                    <div className="text-[9px] text-neutral-400">
                      REF {p.sku ?? '—'}{p.price ? ` · ${kAr(p.price)}` : ''} · {p.influencer}{!p.disponible ? ' · sin stock' : ''}
                    </div>
                    <div className="text-[9px] mt-0.5 flex gap-2">
                      <span className={p.ok_promotor ? 'text-emerald-600 font-bold' : 'text-neutral-400'}>{p.ok_promotor ? '✓' : '·'} {p.influencer}</span>
                      <span className={p.ok_orbital ? 'text-emerald-600 font-bold' : 'text-neutral-400'}>{p.ok_orbital ? '✓' : '·'} Orbital</span>
                    </div>
                    {p.detalle && p.estado !== 'subido' && <div className="text-[9px] text-neutral-500 mt-0.5">{p.detalle}</div>}
                  </div>
                  <div className="shrink-0 flex flex-col gap-1.5 items-end">
                    <a href={`${TIENDA}/products/${p.handle}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-neutral-500 inline-flex items-center gap-1 underline">
                      Tienda <ExternalLink size={10} />
                    </a>
                    {p.estado === 'pendiente' && p.ok_promotor && !p.ok_orbital && (
                      <div className="flex gap-1.5">
                        <button onClick={() => rechazar(p)} disabled={ocupado === p.id}
                          className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"><X size={12} />No</button>
                        <button onClick={() => aprobar(p)} disabled={ocupado === p.id}
                          className="inline-flex items-center gap-1 rounded-md text-white px-2.5 py-1 text-[11px] font-bold disabled:opacity-50" style={{ background: ACENTO }}>
                          <Check size={12} />{ocupado === p.id ? 'Subiendo…' : 'Aprobar'}
                        </button>
                      </div>
                    )}
                    {p.estado === 'pendiente' && !p.ok_promotor && <span className="text-[10px] text-amber-700 font-semibold">Esperando al promotor</span>}
                    {(p.estado === 'error' || p.estado === 'aprobado') && (
                      <button onClick={() => reintentar(p)} disabled={ocupado === p.id}
                        className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-semibold disabled:opacity-50">
                        <RefreshCw size={12} className={ocupado === p.id ? 'animate-spin' : ''} />Reintentar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}
