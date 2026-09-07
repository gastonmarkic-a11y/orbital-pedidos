import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Eye, EyeOff, MessageCircle, RefreshCw, Search, CheckCircle2 } from 'lucide-react'

// Seguimiento — qué le mandé y qué pasó después.
//
// Mi tanda contesta "qué hago ahora". Esta pantalla contesta "qué pasó con lo que
// mandé": quién abrió el catálogo, quién abrió la propuesta y quién no reaccionó.
// Primero aparecen los que reaccionaron, que son los que hay que trabajar hoy.

interface Fila {
  cod_cliente: string
  razon: string | null
  telefono: string | null
  email: string | null
  posta: string | null
  zona: string | null
  envios: number
  ultimo_envio: string | null
  ultima_pieza: string | null
  ultimo_canal: string | null
  abrio_catalogo: string | null
  abrio_propuesta: string | null
  propuesta_abierta: string | null
  respondio: string | null
  nota: string | null
}

const POSTA: Record<string, string> = {
  P0_frio: 'Primer contacto', P1_presentacion: 'Seguimiento', P2_interaccion: 'Respondió',
  P3_propuesta: 'Está decidiendo', P4_activo: 'Cliente activo',
  P5_dormido: 'Reactivación', P6_perdido: 'Recuperación',
}

const haceCuanto = (iso: string | null): string => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`
  const m = Math.round(d / 30)
  return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`
}

type Filtro = 'reaccionaron' | 'sin_reaccion' | 'todos'

export default function Seguimiento() {
  const { vendedor, codigoEfectivo, rolEfectivo } = useAuth()
  const toast = useToast()
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [dias, setDias] = useState(30)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [quien, setQuien] = useState<string>(codigoEfectivo ?? '')
  const [equipo, setEquipo] = useState<{ codigo: string; nombre: string }[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)

  const esAdmin = rolEfectivo === 'admin'

  const cargar = useCallback(async (cod: string, d: number) => {
    if (!cod) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('mi_seguimiento', { p_vendedor: cod, p_dias: d })
    setFilas(error ? [] : ((data as Fila[]) ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { void cargar(quien, dias) }, [quien, dias, cargar])

  useEffect(() => {
    if (!esAdmin) return
    supabase.from('prospeccion_config').select('codigo, vendedores(nombre)').eq('prospecta', true)
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as { codigo: string; vendedores: { nombre: string } | { nombre: string }[] | null }[]
        setEquipo(rows.map((r) => {
          const v = Array.isArray(r.vendedores) ? r.vendedores[0] : r.vendedores
          return { codigo: r.codigo, nombre: v?.nombre ?? r.codigo }
        }))
      })
  }, [esAdmin])

  // Qué contestó el cliente, en un toque. El mensaje sale del WhatsApp del vendedor,
  // así que la respuesta le llega a él: si no lo registra acá, el sistema no se entera.
  const RESPUESTAS: [string, string][] = [
    ['interesado', 'Le interesa'],
    ['pidio_catalogo', 'Pidió catálogo'],
    ['pidio_precio', 'Pidió precios'],
    ['pidio_visita', 'Quiere visita'],
    ['no_ahora', 'Ahora no'],
    ['no_le_interesa', 'No le interesa'],
    ['tel_malo', 'Teléfono mal'],
    ['no_contactar', 'No contactar más'],
  ]

  const registrar = useCallback(async (cod: string, resultado: string) => {
    setGuardando(cod)
    const { data, error } = await supabase.rpc('registrar_respuesta', {
      p_cod: cod, p_vendedor: quien, p_resultado: resultado, p_nota: null,
    })
    setGuardando(null)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    const r = data as { etiqueta?: string; agendado_para?: string } | null
    toast(`${r?.etiqueta ?? 'Guardado'}${r?.agendado_para ? ' · queda en tu agenda' : ''}`, 'success')
    setAbierto(null)
    void cargar(quien, dias)
  }, [quien, dias, cargar, toast])

  const reacciono = (f: Fila) => !!(f.abrio_catalogo || f.abrio_propuesta || f.respondio)

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return filas.filter((f) => {
      if (filtro === 'reaccionaron' && !reacciono(f)) return false
      if (filtro === 'sin_reaccion' && reacciono(f)) return false
      if (!q) return true
      return (f.razon ?? '').toLowerCase().includes(q) || f.cod_cliente.includes(q)
    })
  }, [filas, filtro, busca])

  const totales = useMemo(() => ({
    contactos: filas.length,
    reaccionaron: filas.filter(reacciono).length,
    catalogo: filas.filter((f) => f.abrio_catalogo).length,
    propuesta: filas.filter((f) => f.abrio_propuesta).length,
  }), [filas])

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Seguimiento</h1>
          <p className="text-sm text-muted mt-1">
            Qué mandaste y qué hizo cada óptica con eso. Se registra solo: el link que reciben es propio de cada una.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {esAdmin && equipo.length > 0 && (
            <select value={quien} onChange={(e) => setQuien(e.target.value)}
              className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs text-muted">
              {equipo.map((v) => <option key={v.codigo} value={v.codigo}>{v.nombre}</option>)}
            </select>
          )}
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs text-muted">
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          <button onClick={() => void cargar(quien, dias)}
            className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors" title="Actualizar">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Resumen. Lo que importa es cuántos reaccionaron, no cuántos mandaste. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { n: totales.contactos, l: 'contactados' },
          { n: totales.reaccionaron, l: 'reaccionaron', destacar: true },
          { n: totales.catalogo, l: 'abrieron el catálogo' },
          { n: totales.propuesta, l: 'abrieron la propuesta' },
        ].map((t) => (
          <div key={t.l} className={`rounded-lg border p-3 ${t.destacar ? 'border-brandDark/30 bg-goldSoft/40' : 'border-black/10 bg-white'}`}>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{t.n}</p>
            <p className="text-[11px] text-muted mt-0.5">{t.l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([['todos', 'Todos'], ['reaccionaron', 'Reaccionaron'], ['sin_reaccion', 'Sin reacción']] as [Filtro, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              filtro === k ? 'bg-brand text-white' : 'border border-black/10 text-muted hover:bg-black/[0.03]'}`}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar óptica"
            className="rounded-md border border-black/10 bg-white pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-brand/20" />
        </div>
      </div>

      {loading && <p className="text-sm text-faint text-center py-16">Cargando…</p>}

      {!loading && visibles.length === 0 && (
        <div className="text-center py-16">
          <p className="text-lg font-medium tracking-tight">Todavía no hay envíos registrados</p>
          <p className="text-sm text-muted mt-2">
            Acá van a aparecer las ópticas a las que les escribas desde Mi tanda, con lo que hicieron después.
          </p>
        </div>
      )}

      <div className="flex flex-col">
        {visibles.map((f) => (
          <div key={f.cod_cliente} className="border-t border-black/[0.07] py-3.5 first:border-t-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-[15px] tracking-tight truncate">{f.razon || f.cod_cliente}</p>
                <p className="text-[11px] text-faint tabular-nums mt-0.5">
                  {f.cod_cliente}
                  {f.zona ? ` · ${f.zona}` : ''}
                  {f.posta ? ` · ${POSTA[f.posta] ?? f.posta}` : ''}
                  {f.ultimo_envio ? ` · le escribiste ${haceCuanto(f.ultimo_envio)}` : ''}
                  {f.envios > 1 ? ` · ${f.envios} envíos` : ''}
                </p>
                {f.ultima_pieza && <p className="text-[12px] text-muted mt-1">Último: {f.ultima_pieza}</p>}
                {f.nota && <p className="text-[12px] text-ink mt-1 border-l-2 border-brandDark/40 pl-2">{f.nota}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {f.respondio && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-goldSoft px-2 py-0.5 text-[11px] font-medium text-brandDark">
                    <MessageCircle size={11} /> Te escribió {haceCuanto(f.respondio)}
                  </span>
                )}
                {f.abrio_catalogo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-goldSoft px-2 py-0.5 text-[11px] font-medium text-brandDark">
                    <Eye size={11} /> Catálogo {haceCuanto(f.abrio_catalogo)}
                  </span>
                )}
                {f.abrio_propuesta && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-goldSoft px-2 py-0.5 text-[11px] font-medium text-brandDark">
                    <Eye size={11} /> {f.propuesta_abierta ?? 'Propuesta'} {haceCuanto(f.abrio_propuesta)}
                  </span>
                )}
                {!reacciono(f) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] text-faint">
                    <EyeOff size={11} /> Sin reacción
                  </span>
                )}
              </div>
            </div>

            {/* Un toque para dejar registrado qué contestó. Sin esto la respuesta se
                queda en el celular del vendedor y el sistema nunca se entera. */}
            {abierto === f.cod_cliente ? (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {RESPUESTAS.map(([k, l]) => (
                  <button key={k} disabled={guardando === f.cod_cliente}
                    onClick={() => void registrar(f.cod_cliente, k)}
                    className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 ${
                      k === 'no_contactar' || k === 'no_le_interesa'
                        ? 'border-black/10 text-muted hover:bg-black/[0.04]'
                        : 'border-brandDark/30 text-brandDark hover:bg-goldSoft'}`}>
                    {l}
                  </button>
                ))}
                <button onClick={() => setAbierto(null)}
                  className="rounded-full px-3 py-1.5 text-[12px] text-faint hover:text-ink transition-colors">
                  Cancelar
                </button>
              </div>
            ) : (
              <button onClick={() => setAbierto(f.cod_cliente)}
                className="inline-flex items-center gap-1.5 mt-2 text-[12px] text-muted hover:text-ink transition-colors">
                <CheckCircle2 size={13} /> ¿Qué te contestó?
              </button>
            )}
          </div>
        ))}
      </div>

      {!loading && vendedor?.nombre && (
        <p className="text-[11px] text-faint text-center mt-10">{vendedor.nombre}</p>
      )}
    </div>
  )
}
