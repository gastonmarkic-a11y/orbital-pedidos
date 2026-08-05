import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Actividad, ObjetivoMes, Propuesta } from '../../lib/types'
import { monthKey, habilesTranscurridos, habilesDelMes, ymd, daysSince } from '../../lib/dates'
import { clasificarVoz } from './voz'
import ProgressBar from './ProgressBar'
import SimuladorEscenarios from './SimuladorEscenarios'
import FocoMes from './FocoMes'

const PROSPECCION = ['Marketing', 'ProspeccionVenta', 'Damian']

interface FilaSem {
  cod: string
  nombre: string | null
  zona: string | null
  whatsapp: string | null
  telefono: string | null
  vendedor_asignado: string | null
  derivado_por: string | null
  proxima_agenda_fecha: string | null
  ultima_actividad: string | null
  ultima_compra_fecha: string | null
}
interface TopProd {
  modelo: string
  unidades: number
  pedidos: number
}
interface ZonaRow {
  zona: string
  clientes: number
  con_venta_2025: number
  activos_90: number
  sin_contacto: number
  unidades_2025: number
}
interface MetodoRow {
  ambito: string
  wa: number
  llamada: number
  mail: number
  reunion: number
  recordatorio: number
  otros: number
  contactos: number
  ventas: number
}
interface PropToque {
  propuesta_id: number
  envios_v: number
  conv_v: number
  envios_eq: number
  conv_eq: number
}
interface SeqRow {
  ambito: string
  path: string
  veces: number
}
interface ToqueCliente {
  ambito: string
  convertidos: number
  toques: number
}

export default function MisResultados() {
  const { vendedor, codigoEfectivo } = useAuth()
  // Luna (Marketing) y Damián comparten pool y objetivo de equipo; sin incluir a Damián acá
  // su "Mis Resultados" mostraba objetivo/actividad/vencidos en cero (bug 2026-07-20).
  const esProspeccion = codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'
  const [objetivo, setObjetivo] = useState<ObjetivoMes | null>(null)
  const [propuestasDef, setPropuestasDef] = useState<Propuesta[]>([])
  const [acts, setActs] = useState<Actividad[]>([])
  const [vencidos, setVencidos] = useState(0)
  const [loading, setLoading] = useState(true)
  // Datos del Asistente (semáforo de cartera, productos y zonas)
  const [sem, setSem] = useState<FilaSem[]>([])
  const [topProd, setTopProd] = useState<TopProd[]>([])
  const [zonas, setZonas] = useState<ZonaRow[]>([])
  const [metodo, setMetodo] = useState<MetodoRow[]>([])
  const [propToques, setPropToques] = useState<PropToque[]>([])
  const [secuencia, setSecuencia] = useState<SeqRow[]>([])
  const [toquesCli, setToquesCli] = useState<ToqueCliente[]>([])

  // Coach con IA (Gemini)
  const [pregunta, setPregunta] = useState('')
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [pensando, setPensando] = useState(false)

  async function preguntarCoach(q?: string) {
    const texto = (q ?? pregunta).trim()
    if (!texto) return
    setPregunta(texto)
    setPensando(true)
    setRespuesta(null)
    const { data, error } = await supabase.functions.invoke('asistente-coach', {
      body: { codigo: codigoEfectivo, pregunta: texto },
    })
    setPensando(false)
    // En errores non-2xx el detalle viene en el body de la respuesta (error.context)
    let cuerpo = (data ?? {}) as { ok?: boolean; error?: string; detalle?: string; respuesta?: string }
    const ctx = (error as unknown as { context?: Response })?.context
    if (error && ctx && typeof ctx.json === 'function') {
      try {
        cuerpo = await ctx.json()
      } catch {
        /* deja lo que haya */
      }
    }
    if (error || cuerpo.error) {
      setRespuesta(
        cuerpo.error === 'falta_clave'
          ? '⚙️ El coach todavía no está activado: falta cargar la API key de Gemini (GEMINI_API_KEY) en Supabase.'
          : '❌ ' + (cuerpo.detalle || cuerpo.error || error?.message || 'No se pudo consultar al coach.')
      )
      return
    }
    setRespuesta(cuerpo.respuesta ?? 'Sin respuesta.')
  }

  useEffect(() => {
    if (!vendedor || !codigoEfectivo) return
    Promise.all([
      supabase.rpc('cartera_semaforo', { p_codigo: codigoEfectivo }),
      supabase.rpc('top_productos_vendedor', { p_codigo: codigoEfectivo, p_limit: 8 }),
      supabase.rpc('zonas_vendedor', { p_codigo: codigoEfectivo }),
      supabase.rpc('metodo_contacto', { p_codigo: codigoEfectivo }),
      supabase.rpc('contactos_por_propuesta', { p_codigo: codigoEfectivo }),
      supabase.rpc('secuencia_conversion', { p_codigo: codigoEfectivo }),
      supabase.rpc('toques_por_cliente', { p_codigo: codigoEfectivo }),
    ]).then(([s, t, z, m, pp, sq, tc]) => {
      setSem((s.data as FilaSem[]) ?? [])
      setTopProd((t.data as TopProd[]) ?? [])
      setZonas((z.data as ZonaRow[]) ?? [])
      setMetodo((m.data as MetodoRow[]) ?? [])
      setPropToques((pp.data as PropToque[]) ?? [])
      setSecuencia((sq.data as SeqRow[]) ?? [])
      setToquesCli((tc.data as ToqueCliente[]) ?? [])
    })
  }, [vendedor, codigoEfectivo])

  useEffect(() => {
    if (!vendedor) return
    const mes = monthKey()
    const objVendedor = esProspeccion ? 'Marketing' : codigoEfectivo
    let actQuery = supabase.from('actividad_diaria').select('*').gte('fecha', `${mes}-01`)
    actQuery = esProspeccion ? actQuery.in('vendedor', PROSPECCION) : actQuery.eq('vendedor', codigoEfectivo)
    Promise.all([
      supabase.from('objetivos_mes').select('*').eq('vendedor', objVendedor).eq('mes_anio', mes).maybeSingle(),
      actQuery,
      (esProspeccion
        ? supabase.from('clientes').select('cod', { count: 'exact', head: true }).or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
        : supabase.from('clientes').select('cod', { count: 'exact', head: true }).eq('vendedor_asignado', codigoEfectivo)
      ).lt('proxima_agenda_fecha', new Date().toISOString().slice(0, 10)),
      supabase.from('propuestas_julio').select('*'),
    ]).then(([obj, act, venc, props]) => {
      setObjetivo(obj.data as ObjetivoMes | null)
      setActs((act.data as Actividad[]) ?? [])
      setVencidos(venc.count ?? 0)
      setPropuestasDef((props.data as Propuesta[]) ?? [])
      setLoading(false)
    })
  }, [vendedor, codigoEfectivo])

  if (loading) return <p className="text-sm text-muted p-4">Cargando resultados...</p>

  const propValidas = new Set(propuestasDef.filter((p) => /bienvenida|canje|preventa/i.test(p.nombre)).map((p) => p.id))
  const contactos = esProspeccion
    ? acts.filter((a) => a.propuesta_enviada_id && propValidas.has(a.propuesta_enviada_id)).length
    : new Set(acts.map((a) => a.cod_cliente).filter(Boolean)).size
  const propuestas = esProspeccion
    ? acts.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Derivado a ')).length
    : acts.filter((a) => a.propuesta_enviada_id).length
  const ventas = esProspeccion
    ? acts.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Venta directa cerrada')).length
    : acts.filter((a) => (a.unidades_vendidas ?? 0) > 0).length
  const etiquetas = esProspeccion
    ? {
        contactos: 'Propuestas válidas (Bienvenida / Canje / Preventa)',
        propuestas: 'Reuniones coordinadas',
        ventas: 'Cierres telefónicos (venta directa)',
      }
    : { contactos: 'Contactos trabajados', propuestas: 'Propuestas enviadas', ventas: 'Ventas cerradas' }
  const habilesT = habilesTranscurridos()
  const habilesM = habilesDelMes()
  const proyPropuestas = habilesM > 0 ? Math.round((propuestas / Math.max(habilesT, 1)) * habilesM) : 0
  const proyVentas = habilesM > 0 ? Math.round((ventas / Math.max(habilesT, 1)) * habilesM) : 0

  const porPropuesta: Record<string, number> = {}
  for (const a of acts) {
    if (!a.propuesta_enviada_id) continue
    const k = String(a.propuesta_enviada_id)
    porPropuesta[k] = (porPropuesta[k] ?? 0) + 1
  }

  // Distribución de la voz del cliente por categoría (estadística, no el detalle)
  const vozCats: Record<string, number> = {}
  for (const a of acts) {
    const t = clasificarVoz(a.voz_cliente_nota)
    if (t) vozCats[t.label] = (vozCats[t.label] ?? 0) + 1
  }
  const vozOrden = Object.entries(vozCats).sort((a, b) => b[1] - a[1])
  const vozTotal = vozOrden.reduce((s, [, n]) => s + n, 0)
  const vozMax = Math.max(1, ...vozOrden.map(([, n]) => n))

  // Semáforo de la cartera: cada contacto en un color por prioridad
  const hoyStr = ymd(new Date())
  const bk: Record<string, FilaSem[]> = { verde: [], amarillo: [], rojo: [], azul: [], rosa: [] }
  for (const f of sem) {
    const der = esProspeccion ? f.derivado_por === codigoEfectivo : !!f.derivado_por
    if (der) bk.rosa.push(f)
    else if (f.proxima_agenda_fecha && f.proxima_agenda_fecha < hoyStr) bk.azul.push(f)
    else {
      const d = daysSince(f.ultima_actividad)
      if (d === null || d > 30) bk.rojo.push(f)
      else if (d > 7) bk.amarillo.push(f)
      else bk.verde.push(f)
    }
  }
  const semTiles: [string, string, string][] = [
    ['verde', '≤7d', 'bg-emerald-500'],
    ['amarillo', '≤30d', 'bg-amber-500'],
    ['rojo', '+30d', 'bg-red-500'],
    ['azul', 'Agenda', 'bg-blue-500'],
    ['rosa', esProspeccion ? 'Derivé' : 'Derivados', 'bg-pink-500'],
  ]
  // A quién contactar: el ideal es que un cliente recompre ~cada 90 días. Priorizamos a los que
  // están "para reponer" (compraron hace ~75-240 días) y a los contactos sin explorar (nunca
  // contactados). Los que compraron hace poco NO son prioridad. Los muy contactados hace nada, tampoco.
  const aContactar = sem
    .map((f) => {
      const dCompra = daysSince(f.ultima_compra_fecha)
      const dContacto = daysSince(f.ultima_actividad)
      let score = 0
      let motivo = ''
      if (dCompra !== null) {
        if (dCompra < 45) {
          score = -100 // recién compró, dejalo tranquilo
        } else if (dCompra <= 240) {
          score = 100 - Math.abs(dCompra - 100) / 3
          motivo = `compró hace ${dCompra}d — toca reponer`
        } else {
          score = 45
          motivo = `sin comprar hace ${Math.round(dCompra / 30)} meses`
        }
      } else {
        // Nunca compró: sin explorar
        score = dContacto === null ? 75 : 35
        motivo = dContacto === null ? 'sin contactar / sin explorar' : 'sin comprar todavía'
      }
      if (dContacto !== null && dContacto < 7) score -= 50 // lo tocaste hace nada
      return { f, score, motivo }
    })
    .filter((x) => x.score > 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  const zonasCalientes = zonas.slice(0, 5)
  const zonasFrias = [...zonas]
    .filter((z) => z.clientes >= 3)
    .sort((a, b) => b.sin_contacto / b.clientes - a.sin_contacto / a.clientes)
    .slice(0, 5)
  const contactosPorVenta = ventas > 0 ? (contactos / ventas).toFixed(1) : '—'

  // Baseline real para el simulador
  const unidadesMes = acts.reduce((s, a) => s + (a.unidades_vendidas ?? 0), 0)
  const contactosDiaBase = contactos / Math.max(habilesT, 1)
  const convBase = contactos > 0 ? ventas / contactos : 0.1
  const uxvBase = ventas > 0 ? unidadesMes / ventas : 4

  // Coach: contactos que pidieron que los llamen más adelante (para retomar antes de que se enfríen)
  const DEFERRAL = /(m[aá]s adelante|semana que viene|pr[oó]xim|volver a llamar|m[aá]s tarde|despu[eé]s|fin de mes|el lunes|reci[eé]n|cuando pueda)/i
  const deferidos: Actividad[] = []
  const vistosDef = new Set<string>()
  for (const a of [...acts].sort((x, y) => y.fecha.localeCompare(x.fecha))) {
    if (!a.voz_cliente_nota || !DEFERRAL.test(a.voz_cliente_nota)) continue
    if (!a.cod_cliente || vistosDef.has(a.cod_cliente)) continue
    vistosDef.add(a.cod_cliente)
    deferidos.push(a)
  }

  // Método de contacto: toques por venta y mezcla de canales, vendedor vs equipo
  const mVend = metodo.find((m) => m.ambito === 'vendedor')
  const mEq = metodo.find((m) => m.ambito === 'equipo')
  const toquesDe = (m?: MetodoRow) => (m && m.ventas > 0 ? m.contactos / m.ventas : null)
  const toquesVend = toquesDe(mVend) // (2) contactos para 1 venta en general
  const toquesEq = toquesDe(mEq)
  // (1) contactos por CLIENTE para cerrar con el mismo cliente
  const tcV = toquesCli.find((t) => t.ambito === 'vendedor')
  const tcE = toquesCli.find((t) => t.ambito === 'equipo')
  const porClienteV = tcV && tcV.convertidos > 0 ? tcV.toques / tcV.convertidos : null
  const porClienteE = tcE && tcE.convertidos > 0 ? tcE.toques / tcE.convertidos : null
  const CANALES: { k: keyof MetodoRow; icon: string; label: string }[] = [
    { k: 'wa', icon: '📱', label: 'WhatsApp' },
    { k: 'llamada', icon: '📞', label: 'Llamada' },
    { k: 'mail', icon: '✉️', label: 'Mail' },
    { k: 'reunion', icon: '🤝', label: 'Reunión / visita' },
    { k: 'recordatorio', icon: '⏰', label: 'Recordatorio' },
  ]

  // Contactos para convertir POR PROPUESTA (vendedor vs equipo) — el destacado
  const propTouques = propToques
    .filter((p) => p.envios_v > 0)
    .map((p) => ({
      nombre: propuestasDef.find((x) => x.id === p.propuesta_id)?.nombre ?? `Propuesta ${p.propuesta_id}`,
      toquesV: p.conv_v > 0 ? p.envios_v / p.conv_v : null,
      toquesEq: p.conv_eq > 0 ? p.envios_eq / p.conv_eq : null,
    }))
    .sort((a, b) => (b.toquesV ?? 0) - (a.toquesV ?? 0))

  // Secuencia de canales más frecuente (vendedor vs equipo)
  const canalIcon = (c: string) => (c === 'WS' ? '📱' : c === 'Llamada' ? '📞' : c === 'Visita' ? '🤝' : c === 'Mail' ? '✉️' : c)
  const iconizar = (path: string) =>
    path
      .split(' → ')
      .slice(0, 5)
      .map(canalIcon)
      .join(' → ')
  const seqVend = secuencia.find((s) => s.ambito === 'vendedor')
  const seqEq = secuencia.find((s) => s.ambito === 'equipo')

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">🤖 Asistente · {monthKey()}</h2>
      <p className="text-xs text-muted -mt-2">
        {esProspeccion ? 'Prospección' : (vendedor?.rol === 'admin' ? codigoEfectivo : vendedor?.nombre)} — tu resumen,
        cartera y a quién contactar.
      </p>

      {vencidos > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
          ⚠ Tenés {vencidos} contactos con fecha de agenda vencida sin actividad nueva.
        </div>
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
        <ProgressBar
          label={etiquetas.contactos}
          real={contactos}
          objetivo={esProspeccion ? (objetivo?.objetivo_propuestas ?? 0) : (objetivo?.objetivo_contactos ?? 0)}
        />
        <ProgressBar
          label={etiquetas.propuestas}
          real={propuestas}
          objetivo={esProspeccion ? (objetivo?.objetivo_contactos ?? 0) : (objetivo?.objetivo_propuestas ?? 0)}
        />
        <ProgressBar label={etiquetas.ventas} real={ventas} objetivo={objetivo?.objetivo_ventas ?? 0} />
      </div>

      {esProspeccion && (
        <FocoMes
          codigoEfectivo={codigoEfectivo ?? ''}
          propValidas={propValidas}
          actsMesActual={acts}
          prog={{ propuestas: contactos, reuniones: propuestas, cierres: ventas }}
          objProp={objetivo?.objetivo_propuestas ?? 0}
          objReuniones={objetivo?.objetivo_contactos ?? 0}
          objCierres={objetivo?.objetivo_ventas ?? 0}
        />
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-2">Proyección al ritmo actual</p>
        <p className="text-xs text-faint">
          Día hábil {habilesT} de {habilesM} del mes.
        </p>
        <p className="text-sm text-ink mt-1">
          Propuestas proyectadas: <b>{proyPropuestas}</b>{' '}
          {objetivo && (proyPropuestas >= (objetivo.objetivo_propuestas ?? 0) ? '✅ en línea' : '⚠ por debajo del objetivo')}
        </p>
        <p className="text-sm text-ink">
          Ventas proyectadas: <b>{proyVentas}</b>{' '}
          {objetivo && (proyVentas >= (objetivo.objetivo_ventas ?? 0) ? '✅ en línea' : '⚠ por debajo del objetivo')}
        </p>
        <p className="text-sm text-ink">
          Contactos por venta: <b>{contactosPorVenta}</b>{' '}
          <span className="text-[11px] text-faint">(cuántos contactos te lleva cerrar una)</span>
        </p>
      </div>

      {/* Método de contacto: toques por venta + mezcla de canales vs equipo */}
      {mVend && mVend.contactos > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
          <p className="text-sm font-semibold">
            🧭 Tu método de contacto <span className="text-[11px] text-faint font-normal">(últimos 90 días)</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                t: 'CONTACTOS PARA 1 VENTA',
                sub: 'en general (hoy → venta)',
                v: toquesVend,
                e: toquesEq,
                hint: (v: number, e: number) => (v <= e ? '💪 mejor que el equipo' : 'a mejorar'),
              },
              {
                t: 'CONTACTOS POR CLIENTE',
                sub: 'para cerrar con el mismo',
                v: porClienteV,
                e: porClienteE,
                hint: (v: number, e: number) => (v <= e ? '💪 más eficiente' : 'a mejorar'),
              },
            ].map((k) => {
              const esc = Math.max(k.v ?? 0, k.e ?? 0, 1) * 1.25
              const mejor = k.v != null && k.e != null && k.v <= k.e
              const barra = mejor ? '#7CF5A0' : '#f5a97c'
              return (
                  <div key={k.t} className="rounded-lg p-3" style={{ background: 'linear-gradient(160deg,#17171c,#0f0f13)' }}>
                    <p className="text-[9px] tracking-wider" style={{ color: '#ffffff55' }}>
                      {k.t}
                    </p>
                    <div className="flex items-end gap-1">
                      <p className="text-3xl font-bold tabular-nums leading-none" style={{ color: barra, fontFamily: 'ui-monospace,monospace' }}>
                        {k.v != null ? k.v.toFixed(1) : '—'}
                      </p>
                      {k.v != null && k.e != null && (
                        <span className="text-[9px] mb-0.5" style={{ color: barra }}>
                          {k.v <= k.e ? '▼ mejor' : '▲ a mejorar'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] mb-1.5" style={{ color: '#ffffff70' }}>
                      {k.sub}
                    </p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[8px] w-8 shrink-0" style={{ color: '#ffffff80' }}>vos</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#ffffff14' }}>
                          <div className="h-full rounded-full" style={{ width: `${((k.v ?? 0) / esc) * 100}%`, background: barra }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[8px] w-8 shrink-0" style={{ color: '#ffffff60' }}>equipo</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#ffffff14' }}>
                          <div className="h-full rounded-full" style={{ width: `${((k.e ?? 0) / esc) * 100}%`, background: '#8891a0' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
            })}
          </div>
          <div className="space-y-1.5">
            {CANALES.map((c) => {
              const v = Number(mVend[c.k]) || 0
              const e = Number(mEq?.[c.k]) || 0
              const vp = mVend.contactos > 0 ? Math.round((v / mVend.contactos) * 100) : 0
              const ep = mEq && mEq.contactos > 0 ? Math.round((e / mEq.contactos) * 100) : 0
              return (
                <div key={c.k} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span>
                      {c.icon} {c.label}
                    </span>
                    <span className="text-muted">
                      {vp}% <span className="text-faint">· equipo {ep}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-black/5 rounded-full mt-0.5 overflow-hidden">
                    <div className="h-full bg-brand rounded-full" style={{ width: `${vp}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          {/* DESTACADO: contactos para convertir POR PROPUESTA */}
          {propTouques.length > 0 && (
            <div className="border-t border-black/10 pt-2">
              <p className="text-xs font-semibold text-ink mb-1">📊 Contactos para convertir, por propuesta</p>
              <div className="space-y-1">
                {propTouques.map((p) => (
                  <div key={p.nombre} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{p.nombre}</span>
                    <span className="whitespace-nowrap">
                      <b className="text-brandDark text-base">{p.toquesV != null ? p.toquesV.toFixed(1) : '—'}</b>
                      <span className="text-[11px] text-muted"> contactos/venta · equipo {p.toquesEq != null ? p.toquesEq.toFixed(1) : '—'}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-faint mt-1">Cuántos contactos te lleva cerrar con cada propuesta. Ajustá el método donde estés lejos del equipo.</p>
            </div>
          )}

          {/* Secuencia más frecuente */}
          {(seqVend || seqEq) && (
            <div className="border-t border-black/10 pt-2">
              <p className="text-xs font-semibold text-ink mb-1">🔀 Tu secuencia más frecuente para cerrar</p>
              {seqVend && (
                <p className="text-sm">
                  <span className="text-[11px] text-muted">Vos:</span> {iconizar(seqVend.path)}{' '}
                  <span className="text-[11px] text-faint">({seqVend.veces}×)</span>
                </p>
              )}
              {seqEq && (
                <p className="text-sm">
                  <span className="text-[11px] text-muted">Equipo:</span> {iconizar(seqEq.path)}{' '}
                  <span className="text-[11px] text-faint">({seqEq.veces}×)</span>
                </p>
              )}
              <p className="text-sm">
                <span className="text-[11px] text-muted">Sugerida:</span> 📱 → 📞 → 🤝 → ✅
              </p>
            </div>
          )}

          <p className="text-[11px] text-faint">
            Compará tu mezcla de canales con la del equipo para encontrar el método que más convierte.
          </p>
        </div>
      )}

      <SimuladorEscenarios
        contactosDia={contactosDiaBase}
        convRate={convBase}
        unidadesPorVenta={uxvBase}
        habilesMes={habilesM}
        objetivoVentas={objetivo?.objetivo_ventas ?? 0}
      />

      {/* Coach con IA */}
      <div className="bg-white rounded-xl p-4 border border-black/10 space-y-2">
        <p className="text-sm font-semibold">🤖 Preguntale al Asistente</p>
        <p className="text-[11px] text-faint">
          Consultale sobre tu cartera: a quién contactar, qué ofrecer, cómo mejorar. Responde con tus datos reales.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            '¿A quién contacto hoy?',
            '¿Qué me conviene ofrecer?',
            'Armame un plan para esta semana',
            '¿Cómo mejoro mi conversión?',
            '¿Qué envíos hay en tránsito?',
          ].map((q) => (
            <button
              key={q}
              onClick={() => preguntarCoach(q)}
              disabled={pensando}
              className="text-[11px] border border-black/10 rounded-full px-2.5 py-1 text-muted hover:bg-[#F1EDE4] disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && preguntarCoach()}
            placeholder="Escribí tu pregunta..."
            className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
          />
          <button
            onClick={() => preguntarCoach()}
            disabled={pensando || !pregunta.trim()}
            className="rounded-lg bg-brand text-white px-4 text-sm font-semibold disabled:opacity-50 shrink-0"
          >
            {pensando ? '...' : 'Preguntar'}
          </button>
        </div>
        {pensando && <p className="text-xs text-muted">Pensando…</p>}
        {respuesta && (
          <div className="bg-[#F1EDE4] rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{respuesta}</div>
        )}
      </div>

      {deferidos.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-amber-200">
          <p className="text-xs font-semibold text-amber-700 mb-1">🧭 Coach: retomá antes de que se enfríen</p>
          <p className="text-[11px] text-faint mb-2">
            Te dijeron "llamá más adelante". Volvé ahora con una propuesta concreta (canje / preventa / bienvenida) antes
            de perder el interés.
          </p>
          <div className="space-y-1.5">
            {deferidos.slice(0, 8).map((a) => (
              <div key={a.id} className="border-l-2 border-amber-300 pl-2.5">
                <p className="text-sm text-ink">
                  {a.nombre_comercio || a.cod_cliente}{' '}
                  <span className="text-[11px] text-faint">
                    · {new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </span>
                </p>
                <p className="text-[11px] text-muted">💬 {a.voz_cliente_nota}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Semáforo de la cartera — tarjetas de color */}
      <div>
        <p className="text-xs font-semibold text-muted mb-2">Estado de tu cartera</p>
        <div className="grid grid-cols-5 gap-2">
          {semTiles.map(([k, lab, dot]) => {
            const tint: Record<string, string> = {
              verde: 'bg-emerald-50 border-emerald-200 text-emerald-700',
              amarillo: 'bg-amber-50 border-amber-200 text-amber-700',
              rojo: 'bg-red-50 border-red-200 text-red-700',
              azul: 'bg-blue-50 border-blue-200 text-blue-700',
              rosa: 'bg-pink-50 border-pink-200 text-pink-700',
            }
            return (
              <div key={k} className={`rounded-xl border p-2.5 text-center ${tint[k]}`}>
                <span className={`inline-block w-3 h-3 rounded-full ${dot} mb-1`} />
                <p className="text-2xl font-bold leading-none">{bk[k].length}</p>
                <p className="text-[10px] mt-1 leading-tight">{lab}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* A quién contactar */}
      {aContactar.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-sm font-semibold mb-1">🎯 A quién contactar primero</p>
          <p className="text-[11px] text-faint mb-2">
            Priorizados por ciclo de recompra (~90 días), contactos sin explorar y notas pendientes. Los que compraron
            hace poco quedan afuera.
          </p>
          <div className="space-y-1.5">
            {aContactar.map(({ f, motivo }) => (
              <div key={f.cod} className="flex items-center justify-between gap-2 text-sm border-l-2 border-red-300 pl-2.5">
                <span className="truncate">
                  {f.nombre} <span className="text-faint text-[11px]">· {f.zona || '—'}</span>
                  {motivo && <span className="block text-[11px] text-red-600">{motivo}</span>}
                </span>
                {(f.whatsapp || f.telefono) && (
                  <span className="text-[11px] text-brandDark whitespace-nowrap">📞 {f.whatsapp || f.telefono}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top productos */}
      {topProd.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">🕶 Tus productos más vendidos</p>
          <div className="space-y-1">
            {topProd.map((p) => (
              <div key={p.modelo} className="flex items-center justify-between text-sm">
                <span className="truncate">{p.modelo}</span>
                <span className="text-[11px] text-muted whitespace-nowrap">
                  <b className="text-ink">{p.unidades}</b> u · {p.pedidos} ped.
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zonas calientes / frías — barras */}
      {zonas.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">📍 Zonas</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-red-600 mb-1.5">🔥 Calientes (más volumen)</p>
              <div className="space-y-1.5">
                {(() => {
                  const mx = Math.max(1, ...zonasCalientes.map((z) => z.unidades_2025))
                  return zonasCalientes.map((z) => (
                    <div key={z.zona}>
                      <div className="flex justify-between text-[11px]">
                        <span className="truncate">{z.zona}</span>
                        <span className="text-muted">{z.unidades_2025}u</span>
                      </div>
                      <div className="h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full" style={{ width: `${(z.unidades_2025 / mx) * 100}%` }} />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-1.5">❄ Frías (para trabajar)</p>
              <div className="space-y-1.5">
                {zonasFrias.map((z) => {
                  const pct = z.clientes > 0 ? Math.round((z.sin_contacto / z.clientes) * 100) : 0
                  return (
                    <div key={z.zona}>
                      <div className="flex justify-between text-[11px]">
                        <span className="truncate">{z.zona}</span>
                        <span className="text-muted">{z.sin_contacto}/{z.clientes} sin contactar</span>
                      </div>
                      <div className="h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {Object.keys(porPropuesta).length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">Envíos por propuesta este mes</p>
          <div className="space-y-2">
            {(() => {
              const ent = Object.entries(porPropuesta).sort((a, b) => b[1] - a[1])
              const mx = Math.max(1, ...ent.map(([, n]) => n))
              return ent.map(([id, n]) => {
                const nombre = propuestasDef.find((p) => String(p.id) === id)?.nombre ?? `Propuesta ${id}`
                return (
                  <div key={id}>
                    <div className="flex justify-between text-xs">
                      <span className="truncate">{nombre}</span>
                      <span className="text-muted">
                        <b className="text-ink">{n}</b>
                      </span>
                    </div>
                    <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${(n / mx) * 100}%` }} />
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      {/* La voz del cliente — estadística por tema */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-1">🗣 La voz del cliente este mes</p>
        <p className="text-[11px] text-faint mb-3">Qué dijeron, agrupado por tema — para ver los patrones, no caso por caso.</p>
        {vozTotal === 0 ? (
          <p className="text-sm text-faint">Todavía no cargaste notas de clientes este mes.</p>
        ) : (
          <div className="space-y-2">
            {vozOrden.map(([label, n]) => (
              <div key={label}>
                <div className="flex justify-between text-xs">
                  <span className="truncate">{label}</span>
                  <span className="text-muted">
                    {n} · {Math.round((n / vozTotal) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full bg-brandDark rounded-full" style={{ width: `${(n / vozMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
