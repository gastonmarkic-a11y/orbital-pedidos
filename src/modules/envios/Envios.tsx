import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, PiezaMarketing, Propuesta } from '../../lib/types'
import { daysSince } from '../../lib/dates'
import { aNacional, abrirWhatsApp } from '../../lib/telefono'

const COOLDOWN_DIAS = 15
const MISMO_TIPO_DIAS = 30
const TOPE_DIARIO = 25

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

/** Tema de piezas de marketing asociado a cada propuesta */
function temaDePropuesta(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('bienvenida')) return 'bienvenida'
  if (n.includes('canje')) return 'canje'
  if (n.includes('preventa')) return 'preventa'
  if (n.includes('perdido') || n.includes('recuper')) return 'recuperar'
  return 'general'
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

  const [miTelefono, setMiTelefono] = useState<string | null>(null)
  const [miNombre, setMiNombre] = useState('')
  const [telInput, setTelInput] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [acts, setActs] = useState<ActProp[]>([])
  const [envios, setEnvios] = useState<EnvioRow[]>([])
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroProp, setFiltroProp] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [recarga, setRecarga] = useState(0)

  // Modal de preparación
  const [prep, setPrep] = useState<Cliente | null>(null)
  const [prepProp, setPrepProp] = useState<number>(0)
  const [prepMensaje, setPrepMensaje] = useState('')
  const [prepPiezas, setPrepPiezas] = useState<Set<number>>(new Set())
  const [prepCanal, setPrepCanal] = useState<'wa_me' | 'mailto'>('wa_me')
  const [prepAbierto, setPrepAbierto] = useState(false) // ya abrió el canal, falta confirmar
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!vendedor || !codigoEfectivo) return
    setLoading(true)
    async function cargar() {
      const [{ data: me }, { data: props }, { data: pzs }, { data: envs }] = await Promise.all([
        supabase.from('vendedores').select('telefono_remitente, nombre').eq('codigo', codigoEfectivo).maybeSingle(),
        supabase.from('propuestas_julio').select('*').eq('activa', true).order('orden'),
        supabase.from('piezas_marketing').select('*').eq('activa', true).order('orden'),
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
      setPiezas((pzs as PiezaMarketing[]) ?? [])
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

  const listosHoy = useMemo(() => {
    let base = clientes.filter((c) => !c.cod.startsWith('TMP-'))
    base = base.filter((c) => !enCooldown(c))
    base = base.filter((c) => {
      const sug = propuestaSugerida(c)
      return sug && !tipoRepetido(c, sug.id)
    })
    if (filtroProp) base = base.filter((c) => propuestaSugerida(c)?.id === filtroProp)
    const q = busqueda.trim().toLowerCase()
    if (q)
      base = base.filter(
        (c) =>
          (c.nomcomerc || c.razon || '').toLowerCase().includes(q) ||
          (c.zona || '').toLowerCase().includes(q) ||
          (c.localidad || '').toLowerCase().includes(q)
      )
    // Los más olvidados primero
    base.sort((a, b) => (daysSince(ultimaPropuesta[b.cod] ?? null) ?? 99999) - (daysSince(ultimaPropuesta[a.cod] ?? null) ?? 99999))
    return base
  }, [clientes, filtroProp, busqueda, ultimaPropuesta, ultimaPorTipo, propuestas])

  const enCooldownCount = useMemo(() => clientes.filter((c) => enCooldown(c)).length, [clientes, ultimaPropuesta])
  const topeAlcanzado = enviadosHoy >= TOPE_DIARIO

  function armarMensaje(c: Cliente, prop: Propuesta, piezasSel: PiezaMarketing[]) {
    const contacto = c.contacto ? ` ${c.contacto.split(' ')[0]}` : ''
    const remitente = (miNombre || vendedor?.nombre || 'el equipo').split(' ')[0]
    const link = piezasSel.find((p) => p.url_publica)?.url_corta || piezasSel.find((p) => p.url_publica)?.url_publica
    // Si hay un COPY cargado para el tema de esta propuesta, ese es el mensaje
    // (se edita desde Admin → Gestionar piezas de marketing)
    const copyPieza = piezas.find(
      (x) => x.tema === temaDePropuesta(prop.nombre) && x.categoria === 'copy' && x.contenido_texto
    )
    const saludo = `Hola${contacto}! Soy ${remitente} de Orbital Eyewear.`
    if (copyPieza?.contenido_texto) {
      return [saludo, link ? `📎 ${link}` : null, '', copyPieza.contenido_texto.trim()]
        .filter((x) => x !== null)
        .join('\n')
    }
    return [
      saludo,
      link ? `Te comparto ${prop.nombre}: ${link}` : `Te quería contar sobre ${prop.nombre}.`,
      `¿Lo vemos juntos esta semana?`,
    ].join('\n')
  }

  function abrirPreparacion(c: Cliente) {
    const sug = propuestaSugerida(c)
    if (!sug) return
    const tema = temaDePropuesta(sug.nombre)
    const delTema = piezas.filter((p) => p.tema === tema && p.url_publica)
    const pre = new Set(delTema.slice(0, 1).map((p) => p.id))
    setPrep(c)
    setPrepProp(sug.id)
    setPrepPiezas(pre)
    setPrepCanal(telWhatsApp(c.whatsapp || c.telefono) ? 'wa_me' : 'mailto')
    setPrepMensaje(armarMensaje(c, sug, delTema.slice(0, 1)))
    setPrepAbierto(false)
  }

  function cambiarPropuesta(id: number) {
    if (!prep) return
    const prop = propuestas.find((p) => p.id === id)
    if (!prop) return
    const delTema = piezas.filter((p) => p.tema === temaDePropuesta(prop.nombre) && p.url_publica)
    const pre = delTema.slice(0, 1)
    setPrepProp(id)
    setPrepPiezas(new Set(pre.map((p) => p.id)))
    setPrepMensaje(armarMensaje(prep, prop, pre))
  }

  function abrirCanal() {
    if (!prep) return
    if (prepCanal === 'wa_me') {
      const tel = telWhatsApp(prep.whatsapp || prep.telefono)
      if (!tel) {
        toast('Este cliente no tiene teléfono cargado', 'error')
        return
      }
      abrirWhatsApp(tel, prepMensaje)
    } else {
      if (!prep.email) {
        toast('Este cliente no tiene mail cargado', 'error')
        return
      }
      const prop = propuestas.find((p) => p.id === prepProp)
      window.location.href = `mailto:${prep.email}?subject=${encodeURIComponent(prop?.nombre ?? 'Propuesta Orbital')}&body=${encodeURIComponent(prepMensaje)}`
    }
    setPrepAbierto(true)
  }

  async function confirmarEnvio() {
    if (!prep || !vendedor) return
    setGuardando(true)
    const prop = propuestas.find((p) => p.id === prepProp)
    const { error } = await supabase.from('envios_propuesta').insert({
      cod_cliente: prep.cod,
      vendedor: codigoEfectivo,
      propuesta_id: prepProp,
      canal: prepCanal,
      telefono_remitente: miTelefono,
      mensaje: prepMensaje,
      piezas: [...prepPiezas],
      estado: 'enviado',
      fecha_envio: new Date().toISOString(),
    })
    if (error) {
      toast('No se pudo registrar el envío: ' + error.message, 'error')
      setGuardando(false)
      return
    }
    const canalTxt = prepCanal === 'wa_me' ? 'WhatsApp' : 'mail'
    const { error: errAct } = await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: prep.cod,
      nombre_comercio: prep.nomcomerc,
      contacto: prep.contacto,
      telefono: prep.whatsapp || prep.telefono,
      localidad: prep.localidad,
      email: prep.email,
      actividad_desarrollo: `Propuesta enviada: ${prop?.nombre ?? ''} (envío ${canalTxt})`,
      actividad_futura: `Seguimiento del envío de ${prop?.nombre ?? 'la propuesta'}`,
      propuesta_enviada_id: prepProp,
    })
    if (errAct) {
      toast('El envío se guardó pero la actividad falló: ' + errAct.message, 'error')
    }
    // Actualizar la ficha del cliente: lo último hablado / enviado queda visible en Cartera y Agenda
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `📤 ${new Date().toLocaleDateString('es-AR')} — se envió "${prop?.nombre ?? ''}" por ${canalTxt}. Seguimiento pendiente.`,
        proximo_paso: `Seguir el envío de ${prop?.nombre ?? 'la propuesta'} (${canalTxt})`,
      })
      .eq('cod', prep.cod)
    if (errCli) toast('No se pudo actualizar la ficha del cliente: ' + errCli.message, 'error')
    setGuardando(false)
    setPrep(null)
    setRecarga((r) => r + 1)
    if (!errAct && !errCli)
      toast(`✓ Envío registrado — ${prep.nomcomerc || prep.razon} entra en cooldown ${COOLDOWN_DIAS} días`, 'success')
  }

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

  const propDe = (id: number) => propuestas.find((p) => p.id === id)
  const clienteDe = (cod: string) => clientes.find((c) => c.cod === cod)
  const propPrep = propDe(prepProp)
  const piezasDelTema = propPrep ? piezas.filter((p) => p.tema === temaDePropuesta(propPrep.nombre) && p.url_publica) : []

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">📤 Envíos de Propuestas</h2>

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
      <div className="space-y-2">
        {listosHoy.slice(0, 50).map((c) => {
          const sug = propuestaSugerida(c)
          const dias = daysSince(ultimaPropuesta[c.cod] ?? null)
          const tel = telWhatsApp(c.whatsapp || c.telefono)
          return (
            <div key={c.cod} className="bg-white border border-black/10 rounded-xl p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{c.nomcomerc || c.razon}</p>
                <p className="text-[11px] text-faint">
                  {c.cod} · {c.zona || c.localidad || '—'} · {tel ? `📱 ${tel}` : c.email ? `✉️ ${c.email}` : '⚠ sin contacto'}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  Sugerida: <b className="text-brandDark">{sug?.nombre}</b> ·{' '}
                  {dias === null ? 'nunca recibió propuesta' : `última propuesta hace ${dias}d`}
                </p>
              </div>
              <button
                onClick={() => abrirPreparacion(c)}
                disabled={topeAlcanzado || (!tel && !c.email)}
                className="rounded-lg bg-brand text-white px-4 py-2 text-xs font-semibold disabled:opacity-40 shrink-0"
              >
                Preparar envío →
              </button>
            </div>
          )
        })}
        {listosHoy.length === 0 && (
          <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">
            No hay clientes habilitados hoy con estos filtros — los que recibieron propuestas están en cooldown.
          </p>
        )}
        {listosHoy.length > 50 && (
          <p className="text-[11px] text-faint text-center">Mostrando los primeros 50 de {listosHoy.length} habilitados.</p>
        )}
      </div>

      {/* Enviados hoy */}
      {envios.length > 0 && (
        <div className="bg-white rounded-xl border border-black/10 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Enviados hoy</p>
          {envios
            .filter((e) => e.estado !== 'descartado')
            .map((e) => {
              const c = clienteDe(e.cod_cliente)
              return (
                <div key={e.id} className="flex items-center justify-between gap-2 text-sm border-t border-black/5 pt-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c?.nomcomerc || c?.razon || e.cod_cliente}</p>
                    <p className="text-[11px] text-faint">
                      {propDe(e.propuesta_id)?.nombre} · {e.canal === 'wa_me' ? 'WhatsApp' : 'Mail'}
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

      {/* Modal de preparación */}
      {prep && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPrep(null)}>
          <div
            className="bg-white rounded-2xl border border-black/10 w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{prep.nomcomerc || prep.razon}</p>
                <p className="text-xs text-faint">
                  {prep.cod} · {telWhatsApp(prep.whatsapp || prep.telefono) ?? 'sin teléfono'} · {prep.email ?? 'sin mail'}
                </p>
              </div>
              <button onClick={() => setPrep(null)} className="text-sm text-muted">
                ✕
              </button>
            </div>

            <label className="block text-xs text-muted">
              Propuesta
              <select
                value={prepProp}
                onChange={(e) => cambiarPropuesta(Number(e.target.value))}
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
              >
                {propuestas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>

            {piezasDelTema.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1">Material a incluir (viaja como link público, no vence)</p>
                <div className="space-y-1">
                  {piezasDelTema.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={prepPiezas.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(prepPiezas)
                          if (e.target.checked) next.add(p.id)
                          else next.delete(p.id)
                          setPrepPiezas(next)
                          const props = propuestas.find((x) => x.id === prepProp)
                          if (props && prep) setPrepMensaje(armarMensaje(prep, props, piezas.filter((x) => next.has(x.id))))
                        }}
                      />
                      {p.titulo} <span className="text-faint">({p.categoria})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="block text-xs text-muted">
              Mensaje (corto — WhatsApp corta los textos largos; el link va arriba)
              <textarea
                value={prepMensaje}
                onChange={(e) => setPrepMensaje(e.target.value)}
                rows={5}
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
              />
              <span className={`text-[10px] ${prepMensaje.length > 400 ? 'text-red-600 font-semibold' : 'text-faint'}`}>
                {prepMensaje.length} caracteres {prepMensaje.length > 400 ? '— demasiado largo para WhatsApp, acortalo' : ''}
              </span>
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => setPrepCanal('wa_me')}
                disabled={!telWhatsApp(prep.whatsapp || prep.telefono)}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'wa_me' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 text-muted'} disabled:opacity-30`}
              >
                📱 WhatsApp
              </button>
              <button
                onClick={() => setPrepCanal('mailto')}
                disabled={!prep.email}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'mailto' ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'} disabled:opacity-30`}
              >
                ✉️ Mail
              </button>
            </div>

            {!prepAbierto ? (
              <button onClick={abrirCanal} className="w-full rounded-lg bg-brand text-white py-2.5 text-sm font-semibold">
                {prepCanal === 'wa_me' ? 'Abrir WhatsApp con el mensaje' : 'Abrir mail con el mensaje'}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted text-center">
                  ¿Se envió? Queda registrado como actividad y el cliente entra en cooldown {COOLDOWN_DIAS} días.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPrep(null)}
                    className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted"
                  >
                    No se envió
                  </button>
                  <button
                    onClick={confirmarEnvio}
                    disabled={guardando}
                    className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {guardando ? 'Registrando...' : 'Enviado ✓'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
