// ── Agregar anteojos a la colección · promotor de colección (cobranding ZN) ────
// Todo lo publicado con stock en la tienda, SKU por SKU (en Shopify cada color es un
// producto): se propone de a un color, nunca el modelo entero. Pasa a la colección de la
// tienda con DOS aprobaciones: la del promotor (acá) y la de Orbital (Propuestas en su panel).
import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowLeft, Check, Clock, AlertTriangle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, kAr } from './colabUtil'

type Estado = 'pendiente' | 'aprobado' | 'subido' | 'rechazado' | 'error'
type Opcion = {
  product_id: number; handle: string; sku: string | null; color: string | null; imagen: string | null
  price: number | null; compare_at: number | null; en_coleccion: boolean
  id: number | null; estado: Estado | null; detalle: string | null
  ok_promotor: boolean; ok_orbital: boolean
}
type ModeloOp = { modelo: string; tipos: string[]; en_coleccion: number; colores: Opcion[] }

const FILTROS = ['Para sumar', 'Propuestos', 'En la colección', 'Todos'] as const

export default function ColabAgregar({ clave, volver }: { clave: string; volver: () => void }) {
  const [modelos, setModelos] = useState<ModeloOp[] | null>(null)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<typeof FILTROS[number]>('Para sumar')
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = () => supabase.rpc('colab_coleccion_opciones', { p_clave: clave }).then(({ data }) => setModelos((data as ModeloOp[]) ?? []))
  useEffect(() => { cargar() }, [clave])

  async function proponer(c: Opcion) {
    setOcupado(c.product_id); setAviso(null)
    const { data, error } = await supabase.rpc('colab_coleccion_marcar', { p_clave: clave, p_product_id: c.product_id, p_valor: !c.ok_promotor })
    if (error) {
      setAviso(/ya_en_coleccion/.test(error.message) ? 'Ese color ya está en la colección.'
        : /sin_stock/.test(error.message) ? 'Ese color se quedó sin stock.' : 'No se pudo guardar. Probá de nuevo.')
      setOcupado(null)
      return
    }
    // Si Orbital ya lo había aprobado, esta es la segunda aprobación: se sube a la tienda.
    const r = data as { id: number | null; estado: Estado | null } | null
    if (r?.estado === 'aprobado' && r.id) await supabase.functions.invoke('colab-coleccion-subir', { body: { clave, id: r.id } })
    await cargar()
    setOcupado(null)
  }

  const lista = useMemo(() => (modelos ?? [])
    .map((m) => ({
      ...m,
      colores: m.colores.filter((c) =>
        filtro === 'Todos' ? true
          : filtro === 'En la colección' ? c.en_coleccion
          : filtro === 'Propuestos' ? !c.en_coleccion && !!c.estado
          : !c.en_coleccion),
    }))
    .filter((m) => m.colores.length && (!q || m.modelo.toLowerCase().includes(q.toLowerCase().trim()))), [modelos, q, filtro])

  const esperando = (modelos ?? []).reduce((a, m) => a + m.colores.filter((c) => !c.en_coleccion && c.ok_promotor && !c.ok_orbital).length, 0)

  if (!modelos) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando la tienda…</p>

  return (
    <>
      <button onClick={volver} className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-neutral-500">
        <ArrowLeft size={14} /> Volver a mis anteojos
      </button>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Agregar anteojos a la colección</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Todo lo que hay publicado con stock en la tienda. Elegí el <b>color</b> que querés sumar: pasa a tu colección
          cuando lo aprobás vos y lo aprueba Orbital. Solo se mueve ese color, no el modelo entero.
        </p>
        {esperando > 0 && <p className="text-[11px] mt-1 font-semibold text-amber-700">{esperando} {esperando === 1 ? 'propuesto espera' : 'propuestos esperan'} la aprobación de Orbital.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo"
            className="w-full rounded-lg border border-black/10 bg-white pl-8 pr-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </div>
        {FILTROS.map((f) => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold border ${filtro === f ? 'text-white border-transparent' : 'bg-white border-black/10'}`}
            style={filtro === f ? { background: ACENTO } : undefined}>{f}</button>
        ))}
      </div>
      {aviso && <p className="text-[11px] text-red-600 mb-3">{aviso}</p>}

      <div className="space-y-3">
        {lista.map((m) => (
          <section key={m.modelo} className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-[12px] font-bold uppercase tracking-wide">{m.modelo}</span>
              <span className="text-[10px] text-neutral-500">
                {m.tipos.map((t) => (t === 'SOL' ? 'Sol' : 'Receta')).join(' · ')}
                {m.en_coleccion > 0 ? ` · ${m.en_coleccion} en tu colección` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {m.colores.map((c) => <ColorOp key={c.product_id} c={c} ocupado={ocupado === c.product_id} onProponer={() => proponer(c)} />)}
            </div>
          </section>
        ))}
      </div>
      {lista.length === 0 && <p className="text-sm text-neutral-500 py-10 text-center">Nada con ese filtro.</p>}
    </>
  )
}

function ColorOp({ c, ocupado, onProponer }: { c: Opcion; ocupado: boolean; onProponer: () => void }) {
  const etiqueta: { t: string; color: string; Ic: typeof Check } | null =
    c.en_coleccion ? { t: 'En tu colección', color: ACENTO, Ic: Check }
      : c.estado === 'aprobado' ? { t: 'Aprobado · subiendo a la tienda', color: '#059669', Ic: Clock }
      : c.estado === 'error' ? { t: 'Aprobado · Orbital lo tiene que subir', color: '#b45309', Ic: AlertTriangle }
      : c.estado === 'rechazado' ? { t: 'Orbital no lo aprobó', color: '#6b7280', Ic: X }
      : c.ok_promotor && !c.ok_orbital ? { t: 'Esperando a Orbital', color: '#b45309', Ic: Clock }
      : !c.ok_promotor && c.ok_orbital ? { t: 'Orbital lo sugiere', color: '#059669', Ic: Check }
      : null
  const puedeTocar = !c.en_coleccion && c.estado !== 'aprobado' && c.estado !== 'error'
  return (
    <div className="rounded-lg border-2 overflow-hidden bg-white flex flex-col"
      style={{ borderColor: c.en_coleccion ? ACENTO : c.ok_promotor ? '#d97706' : 'rgba(0,0,0,0.08)' }}>
      <div className="aspect-[4/3] p-1">
        {c.imagen ? <img src={c.imagen} alt={c.color ?? ''} className="w-full h-full object-contain" loading="lazy" /> : <div className="w-full h-full bg-neutral-100" />}
      </div>
      <div className="px-2 py-1.5 border-t border-black/5 flex-1 flex flex-col gap-1">
        <div className="text-[10px] leading-tight">{c.color ?? '—'}</div>
        <div className="text-[9px] text-neutral-400">REF {c.sku ?? '—'}{c.price ? ` · ${kAr(c.price)}` : ''}</div>
        {etiqueta && (
          <div className="text-[9px] font-bold inline-flex items-center gap-1" style={{ color: etiqueta.color }}>
            <etiqueta.Ic size={10} />{etiqueta.t}
          </div>
        )}
        {c.estado === 'rechazado' && c.detalle && <div className="text-[9px] text-neutral-500 italic">“{c.detalle}”</div>}
        {puedeTocar && (
          <button onClick={onProponer} disabled={ocupado}
            className="mt-auto rounded-md py-1 text-[10px] font-bold border disabled:opacity-50"
            style={c.ok_promotor ? { borderColor: 'rgba(0,0,0,0.15)', color: '#404040' } : { background: ACENTO, borderColor: ACENTO, color: '#fff' }}>
            {ocupado ? '…' : c.ok_promotor ? 'Quitar propuesta' : c.ok_orbital ? '✓ Aprobar' : '+ Proponer'}
          </button>
        )}
      </div>
    </div>
  )
}
