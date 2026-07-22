import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, Propuesta } from '../../lib/types'
import { daysSince } from '../../lib/dates'
import { aNacional } from '../../lib/telefono'
import PreparacionEnvio from './PreparacionEnvio'

const COOLDOWN_DIAS = 15
const MISMO_TIPO_DIAS = 30
const TOPE_DIARIO = 25

// Etiqueta corta del canal para la lista de enviados
const CANAL_LABEL: Record<string, string> = { wa_me: 'WhatsApp', mailto: 'Mail', llamada: '📞 Llamada', reunion: '📅 Reunión' }
// Nombre visible del operador de prospección (dos usuarios comparten cartera)
const OPERADOR_NOMBRE: Record<string, string> = { Marketing: 'Luna', Damian: 'Damián', ProspeccionVenta: 'Damián' }

interface ActProp {
  cod_cliente: string | null
  fecha: string
  propuesta_enviada_id: number | null
}

interface EnvioRow {
  id: number
  cod_cliente: string
  vendedor: string
  propuesta_id: number
  canal: string
  estado: string
  fecha_envio: string | null
}

function telWhatsApp(raw: string | null): string | null {
  if (!raw) return null
  // Toma el primer número del campo (puede haber varios separados por " / ")
  const primero = raw.split(/\s*[/,;|]+\s*/)[0] || raw
  const nac = aNacional(primero)
  return nac.length >= 10 ? '549' + nac : null
}

export default function Envios() {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const clienteDirecto = (location.state as { cliente?: Cliente } | null)?.cliente ?? null

  const [miTelefono, setMiTelefono] = useState<string | null>(null)
  const [miNombre, setMiNombre] = useState('')
  const [telInput, setTelInput] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [acts, setActs] = useState<ActProp[]>([])
  const [envios, setEnvios] = useState<EnvioRow[]>([])
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroProp, setFiltroProp] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [recarga, setRecarga] = useState(0)

  // Cliente cuyo contacto se está preparando (el modal vive en PreparacionEnvio)
  const [prep, setPrep] = useState<Cliente | null>(null)

  useEffect(() => {
    if (!vendedor || !codigoEfectivo) return
    setLoading(true)
    async function cargar() {
      const [{ data: me }, { data: props }, { data: envs }] = await Promise.all([
        supabase.from('vendedores').select('telefono_remitente, nombre').eq('codigo', codigoEfectivo).maybeSingle(),
        supabase.from('propuestas_julio').select('*').eq('activa', true).order('orden'),
        supabase
          .from('envios_propuesta')
          .select('*')
          .eq('vendedor', codigoEfectivo)
          .gte('created_at', new Date().toISOString().slice(0, 10)),
      ])
      const yo = me as { telefono_remitente: string | null; nombre: string | null } | null
      setMiTelefono(yo?.telefono_remitente ?? null)
      setMiNombre(yo?.nombre ?? vendedor?.nombre ?? '')
      setPropuestas((props as Propuesta[]) ?? [])
      setEnvios((envs as EnvioRow[]) ?? [])

      const rows = await fetchPaged<Cliente>(() => {
        let q = supabase.from('clientes').select('*').not('origen', 'is', null).order('cod')
        // Prospección (Luna=Marketing, Damián=Damian) envía a los prospectos compartidos
        q =
          codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'
            ? q.or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
            : q.eq('vendedor_asignado', codigoEfectivo)
        return q
      })
      setClientes(rows)

      const todasActs = await fetchPaged<ActProp>(() =>
        supabase
          .from('actividad_diaria')
          .select('cod_cliente, fecha, propuesta_enviada_id')
          .not('propuesta_enviada_id', 'is', null)
          .order('fecha', { ascending: false })
      )
      setActs(todasActs)
      setLoading(false)
    }
    cargar()
  }, [vendedor, codigoEfectivo, recarga])

  // Si llegaste desde Cartera/Agenda con un cliente puntual, abrí su preparación directamente
  useEffect(() => {
    if (clienteDirecto && !loading) {
      setPrep(clienteDirecto)
      window.history.replaceState({}, '') // evita reabrir al volver
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDirecto?.cod, loading])

  // Última propuesta por cliente (global, cruza remitentes) y por tipo
  const ultimaPropuesta = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of acts) if (a.cod_cliente && !m[a.cod_cliente]) m[a.cod_cliente] = a.fecha
    return m
  }, [acts])
  const ultimaPorTipo = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of acts) {
      if (!a.cod_cliente || !a.propuesta_enviada_id) continue
      const k = `${a.cod_cliente}|${a.propuesta_enviada_id}`
      if (!m[k]) m[k] = a.fecha
    }
    return m
  }, [acts])

  const enviadosHoy = envios.filter((e) => e.estado !== 'descartado' && e.estado !== 'en_cola').length

  function propuestaSugerida(c: Cliente): Propuesta | null {
    const buscar = (rx: RegExp) => propuestas.find((p) => rx.test(p.nombre.toLowerCase())) ?? null
    const cl = c.clasificacion_recupero ?? ''
    if (cl === 'sin_historial') return buscar(/bienvenida/)
    if (cl === 'fidelizacion') return buscar(/preventa/) ?? buscar(/especial/)
    if (['2024', '2022_2023', '2021_o_antes'].includes(cl)) return buscar(/perdido|recuper/) ?? buscar(/canje/)
    if (cl === 'activo' || (c.unidades_2025 ?? 0) > 0) return (c.unidades_2025 ?? 0) > 0 ? (buscar(/canje/) ?? buscar(/preventa/)) : buscar(/preventa/)
    return buscar(/bienvenida/)
  }

  function enCooldown(c: Cliente): boolean {
    const d = daysSince(ultimaPropuesta[c.cod] ?? null)
    return d !== null && d < COOLDOWN_DIAS
  }

  function tipoRepetido(c: Cliente, propId: number): boolean {
    const d = daysSince(ultimaPorTipo[`${c.cod}|${propId}`] ?? null)
    return d !== null && d < MISMO_TIPO_DIAS
  }

  const buscandoEnvio = busqueda.trim().length > 0
  const listosHoy = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    let base = clientes.filter((c) => !c.cod.startsWith('TMP-'))
    if (q) {
      // Con búsqueda activa mostramos TODA la cartera que coincida, aunque estén en cooldown,
      // para poder alcanzar a cualquier cliente puntual (ej: uno contactado hace pocos días).
      base = base.filter(
        (c) =>
          (c.nomcomerc || c.razon || '').toLowerCase().includes(q) ||
          (c.cod || '').toLowerCase().includes(q) ||
          (c.zona || '').toLowerCase().includes(q) ||
          (c.localidad || '').toLowerCase().includes(q)
      )
    } else {
      // Cola normal del día: sin cooldown, con propuesta sugerida y sin repetir tipo reciente
      base = base.filter((c) => !enCooldown(c))
      base = base.filter((c) => {
        const sug = propuestaSugerida(c)
        return sug && !tipoRepetido(c, sug.id)
      })
      if (filtroProp) base = base.filter((c) => propuestaSugerida(c)?.id === filtroProp)
    }
    // Los más olvidados primero
    base.sort((a, b) => (daysSince(ultimaPropuesta[b.cod] ?? null) ?? 99999) - (daysSince(ultimaPropuesta[a.cod] ?? null) ?? 99999))
    return base
  }, [clientes, filtroProp, busqueda, ultimaPropuesta, ultimaPorTipo, propuestas])

  const enCooldownCount = useMemo(() => clientes.filter((c) => enCooldown(c)).length, [clientes, ultimaPropuesta])
  const topeAlcanzado = enviadosHoy >= TOPE_DIARIO

  async function guardarTelefono() {
    const t = telWhatsApp(telInput)
    if (!t || t.length < 12) {
      toast('Ingresá el número completo con característica (ej: 5491131147946)', 'error')
      return
    }
    const { error } = await supabase.from('vendedores').update({ telefono_remitente: t }).eq('codigo', codigoEfectivo)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    setMiTelefono(t)
    toast('✓ Teléfono remitente guardado', 'success')
  }

  async function marcarEnvio(e: EnvioRow, estado: string) {
    await supabase.from('envios_propuesta').update({ estado }).eq('id', e.id)
    setEnvios((prev) => prev.map((x) => (x.id === e.id ? { ...x, estado } : x)))
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando envíos...</p>

  const esProsp = codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'
  const nombreOperador = OPERADOR_NOMBRE[codigoEfectivo] ?? miNombre ?? codigoEfectivo
  const propDe = (id: number) => propuestas.find((p) => p.id === id)
  const clienteDe = (cod: string) => clientes.find((c) => c.cod === cod)

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold">📤 Envíos de Propuestas</h2>
        {esProsp && (
          <span className="text-xs font-medium text-brandDark bg-brand/10 rounded-full px-3 py-1">
            👤 {nombreOperador} · tope 25 diario individual
          </span>
        )}
      </div>

      {esProsp && (
        <p className="text-[11px] text-faint">
          Luna y Damián comparten la misma cartera, pero cada uno tiene su propio tope de 25 envíos por día. Este panel
          cuenta solo los tuyos ({nombreOperador}).
        </p>
      )}

      {!miTelefono && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-700 mb-2">
            Cargá tu teléfono remitente (el WhatsApp desde el que enviás) — solo la primera vez.
          </p>
          <div className="flex gap-2">
            <input
              value={telInput}
              onChange={(e) => setTelInput(e.target.value)}
              placeholder="549 + característica sin 0 + número (ej: 5491131147946)"
              className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
            />
            <button onClick={guardarTelefono} className="rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-semibold">
              Guardar
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: 'Listos hoy', val: String(listosHoy.length), color: 'bg-emerald-500' },
          { label: 'Enviados hoy', val: String(enviadosHoy), color: 'bg-brand' },
          { label: 'En cooldown', val: String(enCooldownCount), color: 'bg-amber-500' },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-black/10 rounded-xl p-3 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.color}`} />
            <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold">{k.val}</p>
          </div>
        ))}
        <div className="bg-white border border-black/10 rounded-xl p-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500" />
          <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">Tope diario</p>
          <p className="text-sm font-bold mb-1">
            {enviadosHoy} / {TOPE_DIARIO}
          </p>
          <div className="h-2 bg-black/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${topeAlcanzado ? 'bg-red-500' : 'bg-brand'}`}
              style={{ width: `${Math.min(100, (enviadosHoy / TOPE_DIARIO) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {topeAlcanzado && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
          Llegaste al tope diario de {TOPE_DIARIO} envíos — mañana la cola se rearma sola. Esto protege que no te marquen
          como spam.
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setFiltroProp(null)}
          className={`text-xs font-medium px-3 py-1.5 rounded-full border ${!filtroProp ? 'bg-brand border-brand text-white' : 'border-black/10 text-muted'}`}
        >
          Todas
        </button>
        {propuestas.map((p) => (
          <button
            key={p.id}
            onClick={() => setFiltroProp(filtroProp === p.id ? null : p.id)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${filtroProp === p.id ? 'bg-brand border-brand text-white' : 'border-black/10 text-muted'}`}
          >
            {p.nombre}
          </button>
        ))}
      </div>
      <input
        placeholder="Buscar por nombre, zona, localidad..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand"
      />

      {/* Cola de listos hoy */}
      {buscandoEnvio && (
        <p className="text-[11px] text-faint">
          🔎 Buscando en toda la cartera ({listosHoy.length} resultado{listosHoy.length !== 1 ? 's' : ''}) — incluye clientes en
          cooldown, para que puedas alcanzar a cualquiera.
        </p>
      )}

      <div className="space-y-2">
        {listosHoy.slice(0, 50).map((c) => {
          const sug = propuestaSugerida(c)
          const dias = daysSince(ultimaPropuesta[c.cod] ?? null)
          const tel = telWhatsApp(c.whatsapp || c.telefono)
          const coold = enCooldown(c)
          return (
            <div key={c.cod} className="bg-white border border-black/10 rounded-xl p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {c.nomcomerc || c.razon}
                  {buscandoEnvio && coold && (
                    <span className="ml-2 text-[10px] font-semibold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                      ⏳ en cooldown
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-faint">
                  {c.cod} · {c.zona || c.localidad || '—'} · {tel ? `📱 ${tel}` : c.email ? `✉️ ${c.email}` : '⚠ sin contacto'}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {sug ? (
                    <>
                      Sugerida: <b className="text-brandDark">{sug.nombre}</b> ·{' '}
                    </>
                  ) : null}
                  {dias === null ? 'nunca recibió propuesta' : `última propuesta hace ${dias}d`}
                </p>
              </div>
              <button
                onClick={() => setPrep(c)}
                disabled={topeAlcanzado}
                className="rounded-lg bg-brand text-white px-4 py-2 text-xs font-semibold disabled:opacity-40 shrink-0"
              >
                Preparar envío →
              </button>
            </div>
          )
        })}
        {listosHoy.length === 0 && (
          <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">
            {buscandoEnvio
              ? 'Sin resultados en la cartera con ese texto.'
              : 'No hay clientes habilitados hoy con estos filtros — los que recibieron propuestas están en cooldown. Buscá por nombre para alcanzar a cualquiera.'}
          </p>
        )}
        {listosHoy.length > 50 && (
          <p className="text-[11px] text-faint text-center">Mostrando los primeros 50 de {listosHoy.length}.</p>
        )}
      </div>

      {/* Enviados hoy */}
      {envios.length > 0 && (
        <div className="bg-white rounded-xl border border-black/10 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Enviados hoy{esProsp ? ` · ${nombreOperador}` : ''}
          </p>
          {envios
            .filter((e) => e.estado !== 'descartado')
            .map((e) => {
              const c = clienteDe(e.cod_cliente)
              return (
                <div key={e.id} className="flex items-center justify-between gap-2 text-sm border-t border-black/5 pt-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c?.nomcomerc || c?.razon || e.cod_cliente}</p>
                    <p className="text-[11px] text-faint">
                      {propDe(e.propuesta_id)?.nombre} · {CANAL_LABEL[e.canal] ?? e.canal}
                    </p>
                  </div>
                  <select
                    value={e.estado}
                    onChange={(ev) => marcarEnvio(e, ev.target.value)}
                    className="text-xs bg-white border border-black/10 rounded-lg px-2 py-1.5 text-muted"
                  >
                    <option value="enviado">📤 Enviado</option>
                    <option value="respondido">✅ Respondió</option>
                    <option value="sin_respuesta">📵 Sin respuesta</option>
                  </select>
                </div>
              )
            })}
        </div>
      )}

      {/* Preparación del contacto: mismo componente que usa Cartera */}
      {prep && (
        <PreparacionEnvio
          cliente={prep}
          onClose={() => setPrep(null)}
          onListo={() => setRecarga((r) => r + 1)}
        />
      )}
    </div>
  )
}
