import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Actividad, ObjetivoMes, Propuesta } from '../../lib/types'
import { monthKey, habilesTranscurridos, habilesDelMes, ymd, daysSince } from '../../lib/dates'
import { clasificarVoz } from './voz'
import ProgressBar from './ProgressBar'
import SimuladorEscenarios from './SimuladorEscenarios'

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
    ]).then(([s, t, z]) => {
      setSem((s.data as FilaSem[]) ?? [])
      setTopProd((t.data as TopProd[]) ?? [])
      setZonas((z.data as ZonaRow[]) ?? [])
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

  const voces = acts
    .filter((a) => a.voz_cliente_nota)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 15)

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
  // A quién contactar: los rojos, priorizando los que compraron más recientemente (más para recuperar)
  const aContactar = [...bk.rojo]
    .sort((a, b) => (b.ultima_compra_fecha || '').localeCompare(a.ultima_compra_fecha || ''))
    .slice(0, 8)
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
          {['¿A quién contacto hoy?', '¿Qué me conviene ofrecer?', 'Armame un plan para esta semana', '¿Cómo mejoro mi conversión?'].map((q) => (
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

      {/* Semáforo de la cartera */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-2">Estado de tu cartera</p>
        <div className="grid grid-cols-5 gap-1.5">
          {semTiles.map(([k, lab, dot]) => (
            <div key={k} className="text-center">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot} mb-1`} />
              <p className="text-lg font-bold leading-none">{bk[k].length}</p>
              <p className="text-[10px] text-muted">{lab}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-faint mt-2">
          <b className="text-emerald-600">{bk.verde.length + bk.amarillo.length}</b> contactados (≤30d) ·{' '}
          <b className="text-red-600">{bk.rojo.length}</b> para retomar · <b className="text-blue-600">{bk.azul.length}</b>{' '}
          con agenda vencida
        </p>
      </div>

      {/* A quién contactar */}
      {aContactar.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-1">🎯 A quién contactar primero</p>
          <p className="text-[11px] text-faint mb-2">+30 días sin contacto, priorizados por compra más reciente (más para recuperar).</p>
          <div className="space-y-1">
            {aContactar.map((f) => (
              <div key={f.cod} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {f.nombre} <span className="text-faint text-[11px]">· {f.zona || '—'}</span>
                </span>
                <span className="text-[11px] text-muted whitespace-nowrap">
                  {f.ultima_compra_fecha ? `compró ${f.ultima_compra_fecha}` : 'sin compra'}
                  {f.whatsapp || f.telefono ? ` · 📞 ${f.whatsapp || f.telefono}` : ''}
                </span>
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

      {/* Zonas calientes / frías */}
      {zonas.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">📍 Zonas</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-semibold text-red-600 mb-1">🔥 Calientes (más volumen)</p>
              {zonasCalientes.map((z) => (
                <p key={z.zona} className="text-xs text-ink">
                  {z.zona} — <b>{z.unidades_2025}</b> u · {z.con_venta_2025}/{z.clientes} con compra
                </p>
              ))}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-blue-600 mb-1">❄ Frías (para trabajar)</p>
              {zonasFrias.map((z) => (
                <p key={z.zona} className="text-xs text-ink">
                  {z.zona} — {z.sin_contacto}/{z.clientes} sin contactar
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {Object.keys(porPropuesta).length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">Por tipo de propuesta</p>
          {Object.entries(porPropuesta).map(([id, n]) => (
            <p key={id} className="text-sm text-ink">
              Propuesta #{id}: {n}
            </p>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-1">La voz del cliente este mes</p>
        <p className="text-[11px] text-faint mb-3">
          Lo que dijeron los clientes en cada contacto, para leer entre los números.
        </p>
        {voces.length === 0 ? (
          <p className="text-sm text-faint">Todavía no cargaste notas de clientes este mes.</p>
        ) : (
          <div className="space-y-2">
            {voces.map((a) => {
              const tema = clasificarVoz(a.voz_cliente_nota)
              return (
                <div key={a.id} className="border-l-2 border-brand/30 pl-3">
                  <p className="text-xs text-faint">
                    {new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ·{' '}
                    {a.nombre_comercio}
                  </p>
                  <p className="text-sm text-ink">📝 {a.voz_cliente_nota}</p>
                  {tema && (
                    <span className="inline-block mt-1 text-[10px] text-brandDark bg-brand/10 rounded-full px-2 py-0.5">
                      {tema.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
