import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { MessageCircle, Mail, RefreshCw, Undo2, CalendarClock, Copy, BookOpen } from 'lucide-react'

// Mi tanda de hoy — una acción por vez, decidida por el motor.
// El prospectador no elige a quién, ni por qué canal, ni qué mandar: eso ya lo resolvió
// `secuencia_posta` según la posta del contacto. Acá solo manda o saltea.

interface Accion {
  id: number
  cod_cliente: string
  razon: string | null
  provincia: string | null
  telefono: string | null
  email: string | null
  zona: string | null
  posta: string
  paso: number | null
  pasos_totales: number | null
  canal: string
  es_visita: boolean
  estado: string
  pieza_titulo: string | null
  /** El texto que se manda, ya listo para copiar. */
  pieza_mensaje: string | null
  /** El manual de cómo trabajarlo. Solo viene cuando la pieza es un guion; NO se manda. */
  pieza_guia: string | null
  pieza_link: string | null
  nota: string | null
  toques_previos: number
  ultimo_toque: string | null
  ultima_compra: string | null
  /** Lo último que anotó el vendedor sobre este cliente. Se lee ANTES de escribirle. */
  nota_vendedor: string | null
}

const POSTA: Record<string, { label: string; calida: boolean }> = {
  P0_frio: { label: 'Primer contacto', calida: false },
  P1_presentacion: { label: 'Seguimiento', calida: false },
  P2_interaccion: { label: 'Respondió', calida: true },
  P3_propuesta: { label: 'Está decidiendo', calida: true },
  P4_activo: { label: 'Cliente activo', calida: true },
  P5_dormido: { label: 'Reactivación', calida: false },
  P6_perdido: { label: 'Recuperación', calida: false },
}
const postaInfo = (p: string) => POSTA[p] ?? { label: p, calida: false }

const soloDigitos = (t: string | null) => (t ?? '').replace(/\D/g, '')
const primerNombre = (r: string | null) => (r || '').trim().split(/\s+/)[0] || ''

function armarMensaje(a: Accion, deParte: string): string {
  const base = (a.pieza_mensaje || '').trim()
  if (!base) return ''
  const conDatos = base
    .replace(/\{\{\s*(nombre|contacto)\s*\}\}/gi, primerNombre(a.razon))
    .replace(/\{\{\s*(optica|cliente|razon)\s*\}\}/gi, (a.razon || '').trim())
    .replace(/\{\{\s*(vendedor|rep)\s*\}\}/gi, primerNombre(deParte))
  // El mensaje ya trae sus links resueltos (Triple Protección, catálogo, paquete).
  // Solo se le cuelga el link suelto de la pieza cuando el texto no tiene ninguno.
  return a.pieza_link && !/https?:\/\//.test(conDatos) ? `${conDatos}\n\n${a.pieza_link}`.trim() : conDatos
}

const haceCuanto = (iso: string | null): string | null => {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`
  const m = Math.round(d / 30)
  if (m < 24) return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`
  return `hace ${Math.floor(m / 12)} años`
}

// Por qué está en esta posta. Es el estado del cliente, no una sugerencia.
function porQue(a: Accion): string {
  const compra = haceCuanto(a.ultima_compra)
  switch (a.posta) {
    case 'P0_frio': return 'Nunca lo contactamos: no tiene compras, ni catálogo abierto, ni nos escribió.'
    case 'P1_presentacion': return 'Ya le mandamos algo, pero todavía no dio ninguna señal.'
    case 'P2_interaccion': return 'Dio señal: abrió el catálogo o te escribió. Todavía no tiene acceso propio.'
    case 'P3_propuesta': return 'Tiene el catálogo abierto con su acceso y está evaluando. Acá se cierra.'
    case 'P4_activo': return `Cliente activo${compra ? `, compró ${compra}` : ''}. Reposición o preventa.`
    case 'P5_dormido': return `Compró${compra ? ` ${compra}` : ''} y no volvió. Entre 6 y 18 meses: se puede reactivar.`
    case 'P6_perdido': return `Su última compra fue${compra ? ` ${compra}` : ' hace más de 18 meses'}. Hay que reconstruir el vínculo.`
    default: return ''
  }
}

export default function MiTanda() {
  const { vendedor, codigoEfectivo, rolEfectivo } = useAuth()
  const toast = useToast()
  const [acciones, setAcciones] = useState<Accion[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [hechas, setHechas] = useState(0)
  const [ultima, setUltima] = useState<Accion | null>(null)
  const [quien, setQuien] = useState<string>(codigoEfectivo ?? '')
  const [equipo, setEquipo] = useState<{ codigo: string; nombre: string }[]>([])

  const esAdmin = rolEfectivo === 'admin'
  const actual = acciones[0] ?? null

  const cargar = useCallback(async (cod: string) => {
    if (!cod) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('mi_tanda', { p_vendedor: cod })
    setAcciones(error ? [] : ((data as Accion[]) ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { void cargar(quien) }, [quien, cargar])

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

  const avanzar = useCallback(async (a: Accion, resultado: 'enviado' | 'omitido') => {
    setGuardando(true)
    const { error } = await supabase.rpc('tanda_marcar', { p_id: a.id, p_resultado: resultado })
    setGuardando(false)
    if (error) { toast('No se pudo registrar: ' + error.message, 'error'); return }
    setAcciones((xs) => xs.slice(1))
    if (resultado === 'enviado') { setHechas((n) => n + 1); setUltima(a) } else setUltima(null)
  }, [toast])

  // Quién firma el mensaje: el que está trabajando la tanda, no siempre el que mira.
  const deParte = useMemo(
    () => equipo.find((v) => v.codigo === quien)?.nombre ?? vendedor?.nombre ?? quien,
    [equipo, quien, vendedor],
  )

  // Un solo gesto: abre WhatsApp con el mensaje y lo da por enviado. Si se equivocó, deshace.
  const enviar = useCallback((a: Accion) => {
    if (a.es_visita) { void avanzar(a, 'enviado'); return }
    const texto = armarMensaje(a, deParte)
    if (!texto) { toast('Esta pieza todavía no tiene mensaje cargado', 'error'); return }
    if (a.canal === 'mail') {
      window.open(`mailto:${a.email ?? ''}?subject=${encodeURIComponent(a.pieza_titulo ?? 'Orbital Eyewear')}&body=${encodeURIComponent(texto)}`)
    } else {
      const tel = soloDigitos(a.telefono)
      if (!tel) { toast('Este contacto no tiene WhatsApp cargado', 'error'); return }
      window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank')
    }
    void avanzar(a, 'enviado')
  }, [avanzar, toast, deParte])

  async function deshacer() {
    if (!ultima) return
    const { error } = await supabase.rpc('tanda_marcar', { p_id: ultima.id, p_resultado: 'pendiente' })
    if (error) { toast('No se pudo deshacer', 'error'); return }
    setAcciones((xs) => [ultima, ...xs])
    setHechas((n) => Math.max(0, n - 1))
    setUltima(null)
  }

  // Teclado: se puede trabajar la tanda entera sin tocar el mouse.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!actual || guardando) return
      const t = e.target as HTMLElement
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'Enter') { e.preventDefault(); enviar(actual) }
      if (e.key === 'ArrowRight' || e.key === 'Escape') { e.preventDefault(); void avanzar(actual, 'omitido') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actual, guardando, enviar, avanzar])

  const total = acciones.length + hechas
  const pct = total ? (hechas / total) * 100 : 0
  const mensaje = useMemo(() => (actual ? armarMensaje(actual, deParte) : ''), [actual, deParte])

  const copiar = useCallback(async () => {
    if (!mensaje) return
    try { await navigator.clipboard.writeText(mensaje); toast('Mensaje copiado', 'success') }
    catch { toast('No se pudo copiar', 'error') }
  }, [mensaje, toast])

  return (
    <div className="max-w-[600px] mx-auto px-4 py-8">
      {/* Progreso — lo único que hay arriba */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <p className="text-sm text-muted tabular-nums">
          {total === 0 ? 'Sin acciones' : <><span className="text-ink font-medium">{hechas}</span> de {total} hechas</>}
        </p>
        <div className="flex items-center gap-2">
          {esAdmin && equipo.length > 0 && (
            <select value={quien} onChange={(e) => { setHechas(0); setUltima(null); setQuien(e.target.value) }}
              className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs text-muted">
              {equipo.map((v) => <option key={v.codigo} value={v.codigo}>{v.nombre}</option>)}
            </select>
          )}
          <button onClick={() => { setHechas(0); setUltima(null); void cargar(quien) }}
            className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors" title="Actualizar">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="h-1 rounded-full bg-black/[0.06] overflow-hidden mb-8">
        <div className="h-full bg-brand transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>

      {loading && <p className="text-sm text-faint text-center py-16">Cargando…</p>}

      {!loading && !actual && (
        <div className="text-center py-16">
          <p className="text-[32px] mb-4">{hechas > 0 ? '✦' : '—'}</p>
          <p className="text-xl font-medium tracking-tight">{hechas > 0 ? 'Terminaste por hoy' : 'No hay acciones para hoy'}</p>
          <p className="text-sm text-muted mt-2">
            {hechas > 0 ? `${hechas} contacto${hechas !== 1 ? 's' : ''} trabajado${hechas !== 1 ? 's' : ''}. Mañana a las 7 está la próxima tanda.`
                        : 'La tanda se arma de lunes a viernes a las 7 de la mañana.'}
          </p>
          {ultima && (
            <button onClick={() => void deshacer()} className="mt-6 inline-flex items-center gap-2 text-xs text-muted hover:text-ink transition-colors">
              <Undo2 size={13} /> Deshacer el último
            </button>
          )}
        </div>
      )}

      {actual && (
        <>
          <div className="rounded-xl border border-black/10 bg-white overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight leading-snug">{actual.razon || actual.cod_cliente}</h2>
                  <p className="text-xs text-faint mt-1.5 tabular-nums">
                    {actual.cod_cliente}
                    {actual.zona ? ` · ${actual.zona}` : actual.provincia ? ` · ${actual.provincia}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  postaInfo(actual.posta).calida ? 'bg-goldSoft text-brandDark' : 'bg-black/[0.05] text-muted'}`}>
                  {postaInfo(actual.posta).label}
                </span>
              </div>

              {/* En qué estado está el cliente. Antes esto no se veía y no se entendía por qué aparecía. */}
              <div className="mt-4 rounded-lg bg-black/[0.02] px-4 py-3">
                <p className="text-[13px] text-ink leading-relaxed">{porQue(actual)}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-faint tabular-nums">
                  {actual.paso && actual.pasos_totales
                    ? <span>Paso {actual.paso} de {actual.pasos_totales} de esta etapa</span> : null}
                  <span>
                    {actual.toques_previos > 0
                      ? `${actual.toques_previos} contacto${actual.toques_previos !== 1 ? 's' : ''} nuestro${actual.toques_previos !== 1 ? 's' : ''}${haceCuanto(actual.ultimo_toque) ? `, el último ${haceCuanto(actual.ultimo_toque)}` : ''}`
                      : 'Todavía no le escribimos nunca'}
                  </span>
                  {actual.ultima_compra
                    ? <span>Última compra {haceCuanto(actual.ultima_compra)}</span>
                    : <span>Nunca compró</span>}
                </div>
              </div>

              {/* Lo último que anotó el vendedor. Va antes del mensaje: cambia lo que le escribís. */}
              {actual.nota_vendedor && (
                <div className="mt-4 border-l-2 border-brandDark/40 pl-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Última nota del vendedor</p>
                  <p className="text-[13px] text-ink mt-1 leading-relaxed">{actual.nota_vendedor}</p>
                </div>
              )}

              {actual.es_visita ? (
                <div className="mt-5 rounded-lg border border-black/10 bg-black/[0.02] p-4 flex gap-3">
                  <CalendarClock size={17} className="text-brandDark shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Corresponde visita o videollamada</p>
                    <p className="text-[13px] text-muted mt-0.5">Agendala en Agenda de campo. Marcá abajo cuando la hayas agendado.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                      Mensaje para mandar{actual.canal === 'mail' ? ' por mail' : ''}
                    </p>
                    {mensaje && (
                      <button onClick={() => void copiar()}
                        className="inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-ink transition-colors">
                        <Copy size={12} /> Copiar
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg border border-black/10 bg-white p-4">
                    <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed text-ink">
                      {mensaje || <span className="text-faint italic">Esta pieza todavía no tiene mensaje cargado</span>}
                    </p>
                  </div>

                  {/* El guion NO se manda: es para leer antes de escribir. Por eso va plegado. */}
                  {actual.pieza_guia && (
                    <details className="mt-3 group">
                      <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-ink transition-colors">
                        <BookOpen size={12} />
                        Cómo trabajarlo: {actual.pieza_titulo}
                      </summary>
                      <div className="mt-2 rounded-lg border border-dashed border-black/15 bg-black/[0.015] p-4">
                        <p className="text-[11px] text-faint mb-2">Esto es para vos, no se manda.</p>
                        <p className="text-[12.5px] whitespace-pre-wrap leading-relaxed text-muted">{actual.pieza_guia}</p>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Dos acciones. Nada más. */}
            <div className="border-t border-black/[0.07] p-4 flex items-center gap-2">
              <button onClick={() => enviar(actual)} disabled={guardando}
                className="flex-1 flex items-center justify-center gap-2 rounded-md bg-brand text-white px-4 py-2.5 text-sm font-medium hover:bg-ink transition-colors disabled:opacity-40">
                {actual.es_visita ? <CalendarClock size={16} /> : actual.canal === 'mail' ? <Mail size={16} /> : <MessageCircle size={16} />}
                {guardando ? 'Guardando…' : actual.es_visita ? 'Ya la agendé' : actual.canal === 'mail' ? 'Escribir mail' : 'Enviar por WhatsApp'}
              </button>
              <button onClick={() => void avanzar(actual, 'omitido')} disabled={guardando}
                className="rounded-md border border-black/10 px-4 py-2.5 text-sm text-muted hover:bg-black/[0.03] transition-colors disabled:opacity-40">
                No corresponde
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 px-1">
            <p className="text-xs text-faint">
              <kbd className="font-sans border border-black/10 rounded px-1.5 py-0.5">Enter</kbd> enviar
              <span className="mx-2">·</span>
              <kbd className="font-sans border border-black/10 rounded px-1.5 py-0.5">→</kbd> saltear
            </p>
            {ultima && (
              <button onClick={() => void deshacer()} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors">
                <Undo2 size={13} /> Deshacer
              </button>
            )}
          </div>

          {acciones.length > 1 && (
            <p className="text-xs text-faint text-center mt-8">
              Después de esta te quedan {acciones.length - 1}
            </p>
          )}
        </>
      )}

      {!loading && vendedor?.nombre && (
        <p className="text-[11px] text-faint text-center mt-10">{vendedor.nombre}</p>
      )}
    </div>
  )
}
