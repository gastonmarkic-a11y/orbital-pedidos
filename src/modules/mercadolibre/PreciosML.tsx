import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { formatPrecio } from '../../lib/format'
import { fetchPaged } from '../../lib/fetchAll'

// Revisión de precios para publicar en Mercado Libre.
//
// Lee de la vista ml_publicables, que es la misma fuente que usa ml-sync: lo que
// acá figura como bloqueado es exactamente lo que la sincronización no va a
// publicar. Si las dos cosas se calcularan por separado terminarían discrepando.

type Motivo =
  | 'sin_foto'
  | 'sin_precio'
  | 'precio_placeholder'
  | 'precio_bajo_piso'
  | 'sin_stock_publicable'
  | null

interface Fila {
  codigo: string
  modelo: string
  color: string | null
  tipo: string | null
  tratamiento: string | null
  cantidad: number
  precio: number | null
  tiene_foto: boolean
  seccion: string | null
  motivo_bloqueo: Motivo
}

const ETIQUETA: Record<string, { txt: string; clase: string }> = {
  PUBLICABLE:           { txt: 'Publicable',        clase: 'bg-emerald-100 text-emerald-700' },
  sin_precio:           { txt: 'Sin precio',        clase: 'bg-red-100 text-red-700' },
  precio_placeholder:   { txt: 'Placeholder 99999', clase: 'bg-red-100 text-red-700' },
  precio_bajo_piso:     { txt: 'Bajo el piso',      clase: 'bg-amber-100 text-amber-700' },
  sin_foto:             { txt: 'Sin foto',          clase: 'bg-slate-200 text-slate-600' },
  sin_stock_publicable: { txt: 'Sin stock útil',    clase: 'bg-slate-200 text-slate-600' },
}

// Sólo estos se arreglan cargando un precio. Los otros dos necesitan foto o stock.
const ARREGLABLES: Motivo[] = ['sin_precio', 'precio_placeholder', 'precio_bajo_piso']

export default function PreciosML() {
  const toast = useToast()
  const [filas, setFilas] = useState<Fila[]>([])
  const [piso, setPiso] = useState<number>(79000)
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'arreglables' | 'todos' | Motivo>('arreglables')
  const [busqueda, setBusqueda] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setLoading(true)
    const [datos, cfg] = await Promise.all([
      fetchPaged<Fila>(() => supabase.from('ml_publicables').select('*').order('modelo')),
      supabase.from('ml_config').select('precio_piso').eq('id', 1).single(),
    ])
    setFilas(datos)
    if (cfg.data?.precio_piso) setPiso(Number(cfg.data.precio_piso))
    setLoading(false)
  }

  useEffect(() => { cargar() }, [])

  const conteo = useMemo(() => {
    const c: Record<string, number> = { PUBLICABLE: 0 }
    for (const f of filas) {
      const k = f.motivo_bloqueo ?? 'PUBLICABLE'
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [filas])

  const arreglables = useMemo(
    () => filas.filter((f) => ARREGLABLES.includes(f.motivo_bloqueo)),
    [filas],
  )

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    let base: Fila[]
    if (filtro === 'arreglables') base = arreglables
    else if (filtro === 'todos') base = filas
    else base = filas.filter((f) => f.motivo_bloqueo === filtro)

    return base
      .filter((f) => !q || f.modelo.toLowerCase().includes(q) || f.codigo.includes(q))
      // primero lo que más unidades mueve: ahí está la plata
      .sort((a, b) => b.cantidad - a.cantidad)
  }, [filas, arreglables, filtro, busqueda])

  // Unidades trabadas sólo por precio — el número que justifica esta pantalla.
  const unidadesTrabadas = useMemo(
    () => arreglables.reduce((a, f) => a + f.cantidad, 0),
    [arreglables],
  )

  function valido(v: string): number | null {
    const n = Number(v.replace(/[^\d]/g, ''))
    if (!n || n < piso || n === 99999) return null
    return n
  }

  async function guardarUno(f: Fila) {
    const n = valido(edits[f.codigo] ?? '')
    if (n === null) {
      toast(`El precio tiene que ser un número de ${formatPrecio(piso)} para arriba`, 'error')
      return
    }
    const { error } = await supabase.from('precios_publicos').upsert(
      { codigo: f.codigo, precio: n, actualizado: new Date().toISOString() },
      { onConflict: 'codigo' },
    )
    if (error) { toast('No se pudo guardar el precio', 'error'); return }

    setFilas((prev) => prev.map((x) =>
      x.codigo === f.codigo ? { ...x, precio: n, motivo_bloqueo: x.tiene_foto ? null : 'sin_foto' } : x))
    setEdits((prev) => { const c = { ...prev }; delete c[f.codigo]; return c })
    toast(`${f.modelo} — ${formatPrecio(n)}`, 'success')
  }

  /** Aplica un precio a todas las variantes pendientes de un modelo de una vez. */
  async function guardarModelo(modelo: string, precioTxt: string) {
    const n = valido(precioTxt)
    if (n === null) {
      toast(`El precio tiene que ser un número de ${formatPrecio(piso)} para arriba`, 'error')
      return
    }
    const destino = arreglables.filter((f) => f.modelo === modelo)
    if (!destino.length) return

    setGuardando(true)
    const { error } = await supabase.from('precios_publicos').upsert(
      destino.map((f) => ({ codigo: f.codigo, precio: n, actualizado: new Date().toISOString() })),
      { onConflict: 'codigo' },
    )
    setGuardando(false)
    if (error) { toast('No se pudieron guardar los precios', 'error'); return }

    const codigos = new Set(destino.map((f) => f.codigo))
    setFilas((prev) => prev.map((x) =>
      codigos.has(x.codigo) ? { ...x, precio: n, motivo_bloqueo: x.tiene_foto ? null : 'sin_foto' } : x))
    toast(`${modelo}: ${destino.length} variantes en ${formatPrecio(n)}`, 'success')
  }

  const [precioMasivo, setPrecioMasivo] = useState<Record<string, string>>({})
  const modelosPendientes = useMemo(() => {
    const m = new Map<string, { variantes: number; unidades: number }>()
    for (const f of arreglables) {
      const cur = m.get(f.modelo) ?? { variantes: 0, unidades: 0 }
      m.set(f.modelo, { variantes: cur.variantes + 1, unidades: cur.unidades + f.cantidad })
    }
    return [...m.entries()].sort((a, b) => b[1].unidades - a[1].unidades)
  }, [arreglables])

  if (loading) return <p className="text-sm text-muted p-4">Cargando precios…</p>

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold">Precios para Mercado Libre</h2>
        <span className="text-xs text-muted">
          Piso configurado: <b className="text-ink">{formatPrecio(piso)}</b>
        </span>
      </div>

      {unidadesTrabadas > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
          <b>{arreglables.length} SKUs</b> — <b>{unidadesTrabadas.toLocaleString('es-AR')} unidades</b> no
          se publican sólo por el precio. Cargando el precio del modelo se destraban todas sus variantes juntas.
          <span className="block text-[10px] text-amber-600 mt-1">
            Los SKUs sin foto o sin stock útil no se arreglan desde acá.
          </span>
        </div>
      )}

      {/* contadores */}
      <div className="flex gap-1.5 flex-wrap">
        {(['arreglables', 'todos'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border ${
              filtro === k ? 'bg-ink text-white border-ink' : 'border-black/10 text-muted'
            }`}
          >
            {k === 'arreglables' ? `A corregir (${arreglables.length})` : `Todos (${filas.length})`}
          </button>
        ))}
        {Object.entries(conteo).map(([k, n]) => (
          <button
            key={k}
            onClick={() => setFiltro(k === 'PUBLICABLE' ? 'todos' : (k as Motivo))}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 border ${
              filtro === k ? 'bg-ink text-white border-ink' : 'border-black/10 text-muted'
            }`}
          >
            {ETIQUETA[k]?.txt ?? k} ({n})
          </button>
        ))}
      </div>

      {/* carga por modelo: lo más rápido para destrabar volumen */}
      {filtro === 'arreglables' && modelosPendientes.length > 0 && (
        <div className="rounded-xl border border-black/10 bg-white overflow-hidden">
          <div className="px-3 py-2 bg-[#F1EDE4] text-[10px] uppercase text-muted font-semibold">
            Cargar precio por modelo — ordenado por unidades
          </div>
          <div className="divide-y divide-black/5 max-h-72 overflow-y-auto">
            {modelosPendientes.map(([modelo, d]) => (
              <div key={modelo} className="flex items-center gap-2 px-3 py-2">
                <span className="font-semibold text-sm flex-1 truncate">{modelo}</span>
                <span className="text-[11px] text-faint whitespace-nowrap">
                  {d.variantes} var · {d.unidades.toLocaleString('es-AR')} u
                </span>
                <input
                  inputMode="numeric"
                  placeholder={String(piso)}
                  value={precioMasivo[modelo] ?? ''}
                  onChange={(e) => setPrecioMasivo((p) => ({ ...p, [modelo]: e.target.value }))}
                  className="w-28 border border-black/10 rounded-md px-2 py-1 text-xs"
                />
                <button
                  disabled={guardando || !precioMasivo[modelo]}
                  onClick={() => guardarModelo(modelo, precioMasivo[modelo] ?? '')}
                  className="text-xs font-medium bg-emerald-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  Aplicar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por modelo o código…"
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
      />

      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
        <table className="w-full min-w-[760px] text-sm border-collapse">
          <thead className="bg-[#F1EDE4]">
            <tr>
              {['Código', 'Modelo', 'Color', 'Sección', 'Stock', 'Precio', 'Estado', ''].map((h) => (
                <th key={h} className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.slice(0, 300).map((f) => {
              const est = ETIQUETA[f.motivo_bloqueo ?? 'PUBLICABLE']
              const editable = ARREGLABLES.includes(f.motivo_bloqueo)
              return (
                <tr key={f.codigo} className="border-t border-black/5">
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-faint">{f.codigo}</td>
                  <td className="px-2.5 py-1.5 font-semibold">{f.modelo}</td>
                  <td className="px-2.5 py-1.5 text-muted text-xs">{f.color || '—'}</td>
                  <td className="px-2.5 py-1.5 text-muted text-xs">{f.seccion || '—'}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{f.cantidad}</td>
                  <td className="px-2.5 py-1.5 text-gold font-semibold">
                    {f.precio ? formatPrecio(f.precio) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${est?.clase ?? ''}`}>
                      {est?.txt ?? '—'}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    {editable && (
                      <div className="flex gap-1">
                        <input
                          inputMode="numeric"
                          placeholder={String(piso)}
                          value={edits[f.codigo] ?? ''}
                          onChange={(e) => setEdits((p) => ({ ...p, [f.codigo]: e.target.value }))}
                          className="w-24 border border-black/10 rounded-md px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => guardarUno(f)}
                          className="text-[11px] font-medium border border-black/10 rounded-md px-2 py-1 text-muted"
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {visibles.length > 300 && (
        <p className="text-[11px] text-faint">
          Mostrando los primeros 300 de {visibles.length}. Usá el buscador o cargá por modelo para avanzar más rápido.
        </p>
      )}
    </div>
  )
}
