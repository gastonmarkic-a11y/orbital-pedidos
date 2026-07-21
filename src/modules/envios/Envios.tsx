import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, PiezaMarketing, Propuesta } from '../../lib/types'
import { daysSince, siguienteDiaHabil, ymd } from '../../lib/dates'
import { aNacional, abrirWhatsApp } from '../../lib/telefono'

type Canal = 'wa_me' | 'mailto' | 'llamada' | 'recordatorio' | 'reunion'

const COOLDOWN_DIAS = 15
const MISMO_TIPO_DIAS = 30
const TOPE_DIARIO = 25

// Motor de secuencia de multicontactos: qué acción sigue según el canal del contacto actual
const SIGUIENTE_PASO: Record<string, { texto: string; dias: number }> = {
  wa_me: { texto: '📞 Llamar para explicar la propuesta', dias: 2 },
  mailto: { texto: '📞 Llamar para explicar la propuesta', dias: 2 },
  llamada: { texto: '📤 Enviar la propuesta detallada + coordinar visita', dias: 2 },
}
const CANAL_TXT: Record<string, string> = { wa_me: 'WhatsApp', mailto: 'mail', llamada: 'llamada telefónica', reunion: 'reunión' }
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
  const location = useLocation()
  const clienteDirecto = (location.state as { cliente?: Cliente } | null)?.cliente ?? null

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
  const [feriados, setFeriados] = useState<Set<string>>(new Set())

  // Modal de preparación
  const [prep, setPrep] = useState<Cliente | null>(null)
  const [prepProp, setPrepProp] = useState<number>(0)
  const [prepMensaje, setPrepMensaje] = useState('')
  const [prepPiezas, setPrepPiezas] = useState<Set<number>>(new Set())
  const [prepCanal, setPrepCanal] = useState<Canal>('wa_me')
  const [prepFecha, setPrepFecha] = useState('') // recordatorio/reunión: fecha de la próxima agenda
  const [prepHora, setPrepHora] = useState('') // reunión: hora, opcional
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

  useEffect(() => {
    supabase
      .from('feriados')
      .select('fecha')
      .then(({ data }) => setFeriados(new Set((data ?? []).map((f: { fecha: string }) => f.fecha))))
  }, [])

  // Próximo día hábil a partir de hoy + `dias`, saltando sábados/domingos/feriados
  function proximoHabil(dias: number): string {
    const base = new Date(Date.now() + dias * 86400000)
    return ymd(siguienteDiaHabil(base, feriados))
  }

  // Si llegaste desde Cartera/Agenda con un cliente puntual, abrí su preparación directamente
  useEffect(() => {
    if (clienteDirecto && !loading) {
      abrirPreparacion(clienteDirecto)
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

  // Guión telefónico del tema de la propuesta (para el canal Llamar)
  function guionDelTema(propNombre: string): string {
    const tema = temaDePropuesta(propNombre)
    const g = piezas.find((x) => x.tema === tema && x.categoria === 'guion' && x.contenido_texto)
    return g?.contenido_texto?.trim() || `Presentá ${propNombre} al cliente y coordiná el próximo paso.`
  }

  // Cambia el canal y ajusta el texto: guión para llamada, mensaje/copy para WhatsApp/mail
  function elegirCanal(canal: Canal) {
    setPrepCanal(canal)
    setPrepAbierto(false)
    if (canal === 'recordatorio' || canal === 'reunion') {
      if (!prepFecha) setPrepFecha(proximoHabil(1))
      if (canal === 'reunion' && !prepHora) setPrepHora('10:00')
      setPrepMensaje('')
      return
    }
    const prop = propuestas.find((x) => x.id === prepProp)
    if (!prop || !prep) return
    if (canal === 'llamada') setPrepMensaje(guionDelTema(prop.nombre))
    else setPrepMensaje(armarMensaje(prep, prop, piezas.filter((x) => prepPiezas.has(x.id))))
  }

  function abrirPreparacion(c: Cliente) {
    const sug = propuestaSugerida(c) ?? propuestas[0] ?? null
    const delTema = sug ? piezas.filter((p) => p.tema === temaDePropuesta(sug.nombre) && p.url_publica) : []
    const pre = new Set(delTema.slice(0, 1).map((p) => p.id))
    const tel = telWhatsApp(c.whatsapp || c.telefono)
    setPrep(c)
    setPrepProp(sug?.id ?? 0)
    setPrepPiezas(pre)
    setPrepCanal(tel ? 'wa_me' : c.email ? 'mailto' : 'recordatorio')
    setPrepFecha(proximoHabil(1))
    setPrepMensaje(sug ? armarMensaje(c, sug, delTema.slice(0, 1)) : '')
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
    if (prepCanal === 'llamada') {
      const nac = aNacional(prep.whatsapp || prep.telefono || '')
      if (nac.length < 10) {
        toast('Este cliente no tiene teléfono cargado', 'error')
        return
      }
      window.location.href = 'tel:+54' + nac
    } else if (prepCanal === 'wa_me') {
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
    const canalTxt = CANAL_TXT[prepCanal] ?? prepCanal
    const sig = SIGUIENTE_PASO[prepCanal] ?? { texto: 'Seguimiento', dias: 2 }
    const fechaSig = proximoHabil(sig.dias)
    const desarrollo =
      prepCanal === 'llamada'
        ? `Llamada telefónica: ${prop?.nombre ?? ''}`
        : `Propuesta enviada: ${prop?.nombre ?? ''} (envío ${canalTxt})`
    const { error: errAct } = await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: prep.cod,
      nombre_comercio: prep.nomcomerc,
      contacto: prep.contacto,
      telefono: prep.whatsapp || prep.telefono,
      localidad: prep.localidad,
      email: prep.email,
      actividad_desarrollo: desarrollo,
      actividad_futura: sig.texto,
      proximo_paso_fecha: fechaSig,
      propuesta_enviada_id: prepProp,
    })
    if (errAct) {
      toast('El envío se guardó pero la actividad falló: ' + errAct.message, 'error')
    }
    // Actualizar la ficha del cliente: lo último hablado / enviado queda visible en Cartera y Agenda
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `${prepCanal === 'llamada' ? '📞' : '📤'} ${new Date().toLocaleDateString('es-AR')} — ${prepCanal === 'llamada' ? 'llamada' : 'se envió'} "${prop?.nombre ?? ''}" por ${canalTxt}. Próximo: ${sig.texto}.`,
        proximo_paso: sig.texto,
        proxima_agenda_fecha: fechaSig,
      })
      .eq('cod', prep.cod)
    if (errCli) toast('No se pudo actualizar la ficha del cliente: ' + errCli.message, 'error')
    setGuardando(false)
    setPrep(null)
    setRecarga((r) => r + 1)
    if (!errAct && !errCli)
      toast(`✓ Envío registrado — ${prep.nomcomerc || prep.razon} entra en cooldown ${COOLDOWN_DIAS} días`, 'success')
  }

  async function confirmarRecordatorio() {
    if (!prep || !vendedor) return
    const desc = prepMensaje.trim()
    if (!desc) {
      toast('Escribí una descripción para el recordatorio', 'error')
      return
    }
    if (!prepFecha) {
      toast('Elegí la fecha del recordatorio', 'error')
      return
    }
    setGuardando(true)
    const fechaTxt = new Date(prepFecha + 'T00:00:00').toLocaleDateString('es-AR')
    const { error: errAct } = await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: prep.cod,
      nombre_comercio: prep.nomcomerc,
      contacto: prep.contacto,
      telefono: prep.whatsapp || prep.telefono,
      localidad: prep.localidad,
      email: prep.email,
      actividad_desarrollo: `🔔 Recordatorio agendado: ${desc}`,
      actividad_futura: desc,
      proximo_paso_fecha: prepFecha,
    })
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `🔔 ${new Date().toLocaleDateString('es-AR')} — Recordatorio para el ${fechaTxt}: ${desc}`,
        proximo_paso: desc,
        proxima_agenda_fecha: prepFecha,
      })
      .eq('cod', prep.cod)
    setGuardando(false)
    if (errAct || errCli) {
      toast('No se pudo agendar el recordatorio: ' + (errAct?.message || errCli?.message), 'error')
      return
    }
    setPrep(null)
    setRecarga((r) => r + 1)
    toast(`✓ Recordatorio agendado para el ${fechaTxt}`, 'success')
  }

  async function confirmarReunion() {
    if (!prep || !vendedor) return
    const desc = prepMensaje.trim()
    if (!desc) {
      toast('Escribí el motivo de la reunión', 'error')
      return
    }
    if (!prepFecha) {
      toast('Elegí la fecha de la reunión', 'error')
      return
    }
    setGuardando(true)
    const fechaTxt = new Date(prepFecha + 'T00:00:00').toLocaleDateString('es-AR')
    const horaTxt = prepHora ? ` ${prepHora}hs` : ''
    const { error: errAct } = await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: prep.cod,
      nombre_comercio: prep.nomcomerc,
      contacto: prep.contacto,
      telefono: prep.whatsapp || prep.telefono,
      localidad: prep.localidad,
      email: prep.email,
      actividad_desarrollo: `📅 Reunión agendada: ${desc}`,
      actividad_futura: `Reunión${horaTxt}: ${desc}`,
      proximo_paso_fecha: prepFecha,
    })
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `📅 ${new Date().toLocaleDateString('es-AR')} — Reunión el ${fechaTxt}${horaTxt}: ${desc}`,
        proximo_paso: `Reunión${horaTxt}: ${desc}`,
        proxima_agenda_fecha: prepFecha,
      })
      .eq('cod', prep.cod)
    setGuardando(false)
    if (errAct || errCli) {
      toast('No se pudo agendar la reunión: ' + (errAct?.message || errCli?.message), 'error')
      return
    }
    setPrep(null)
    setRecarga((r) => r + 1)
    toast(`✓ Reunión agendada para el ${fechaTxt}${horaTxt}`, 'success')
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

  const esProsp = codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'
  const nombreOperador = OPERADOR_NOMBRE[codigoEfectivo] ?? miNombre ?? codigoEfectivo
  const propDe = (id: number) => propuestas.find((p) => p.id === id)
  const clienteDe = (cod: string) => clientes.find((c) => c.cod === cod)
  const propPrep = propDe(prepProp)
  const piezasDelTema = propPrep ? piezas.filter((p) => p.tema === temaDePropuesta(propPrep.nombre) && p.url_publica) : []

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
                onClick={() => abrirPreparacion(c)}
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

            {prepCanal !== 'recordatorio' && prepCanal !== 'reunion' && (
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
            )}

            {prepCanal !== 'recordatorio' && prepCanal !== 'reunion' && piezasDelTema.length > 0 && (
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

            {(prepCanal === 'recordatorio' || prepCanal === 'reunion') && (
              <div className={prepCanal === 'reunion' ? 'grid grid-cols-2 gap-2' : ''}>
                <label className="block text-xs text-muted">
                  📅 {prepCanal === 'reunion' ? 'Fecha de la reunión' : 'Fecha del recordatorio'} (aparece en la Agenda ese día)
                  <input
                    type="date"
                    value={prepFecha}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPrepFecha(e.target.value)}
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
                {prepCanal === 'reunion' && (
                  <label className="block text-xs text-muted">
                    🕒 Hora (opcional)
                    <input
                      type="time"
                      value={prepHora}
                      onChange={(e) => setPrepHora(e.target.value)}
                      className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </label>
                )}
              </div>
            )}

            <label className="block text-xs text-muted">
              {prepCanal === 'llamada'
                ? '🎙️ Guión de la llamada (lo leés mientras hablás)'
                : prepCanal === 'recordatorio'
                  ? '📝 Qué hay que hacer (ej: el dueño no estaba, volver a llamar)'
                  : prepCanal === 'reunion'
                    ? '📝 Motivo de la reunión (ej: presentar la colección nueva, cierre de acuerdo)'
                    : 'Mensaje (corto — WhatsApp corta los textos largos; el link va arriba)'}
              <textarea
                value={prepMensaje}
                onChange={(e) => setPrepMensaje(e.target.value)}
                rows={prepCanal === 'llamada' ? 8 : prepCanal === 'recordatorio' || prepCanal === 'reunion' ? 3 : 5}
                placeholder={
                  prepCanal === 'recordatorio'
                    ? 'Ej: el dueño no estaba, llamar mañana a la mañana'
                    : prepCanal === 'reunion'
                      ? 'Ej: presentar la colección nueva en el local'
                      : undefined
                }
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
              {prepCanal !== 'llamada' && prepCanal !== 'recordatorio' && prepCanal !== 'reunion' && (
                <span className={`text-[10px] ${prepMensaje.length > 400 ? 'text-red-600 font-semibold' : 'text-faint'}`}>
                  {prepMensaje.length} caracteres {prepMensaje.length > 400 ? '— demasiado largo para WhatsApp, acortalo' : ''}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => elegirCanal('llamada')}
                disabled={aNacional(prep.whatsapp || prep.telefono || '').length < 10}
                className={`rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'llamada' ? 'bg-amber-500 text-white border-amber-500' : 'border-black/10 text-muted'} disabled:opacity-30`}
              >
                📞 Llamar
              </button>
              <button
                onClick={() => elegirCanal('wa_me')}
                disabled={!telWhatsApp(prep.whatsapp || prep.telefono)}
                className={`rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'wa_me' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 text-muted'} disabled:opacity-30`}
              >
                📱 WhatsApp
              </button>
              <button
                onClick={() => elegirCanal('mailto')}
                disabled={!prep.email}
                className={`rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'mailto' ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'} disabled:opacity-30`}
              >
                ✉️ Mail
              </button>
              <button
                onClick={() => elegirCanal('recordatorio')}
                className={`rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'recordatorio' ? 'bg-violet-600 text-white border-violet-600' : 'border-black/10 text-muted'}`}
              >
                ⏰ Recordatorio
              </button>
              <button
                onClick={() => elegirCanal('reunion')}
                className={`col-span-2 rounded-lg py-2 text-xs font-semibold border ${prepCanal === 'reunion' ? 'bg-sky-600 text-white border-sky-600' : 'border-black/10 text-muted'}`}
              >
                📅 Reunión
              </button>
            </div>

            {prepCanal === 'recordatorio' ? (
              <button
                onClick={confirmarRecordatorio}
                disabled={guardando}
                className="w-full rounded-lg bg-violet-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {guardando ? 'Agendando...' : '⏰ Agendar recordatorio en la agenda'}
              </button>
            ) : prepCanal === 'reunion' ? (
              <button
                onClick={confirmarReunion}
                disabled={guardando}
                className="w-full rounded-lg bg-sky-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {guardando ? 'Agendando...' : '📅 Agendar reunión en la agenda'}
              </button>
            ) : !prepAbierto ? (
              <button onClick={abrirCanal} className="w-full rounded-lg bg-brand text-white py-2.5 text-sm font-semibold">
                {prepCanal === 'llamada'
                  ? '📞 Llamar al cliente'
                  : prepCanal === 'wa_me'
                    ? 'Abrir WhatsApp con el mensaje'
                    : 'Abrir mail con el mensaje'}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted text-center">
                  {prepCanal === 'llamada' ? '¿Hiciste la llamada?' : '¿Se envió?'} Queda registrado como actividad y se agenda el próximo paso automáticamente.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPrep(null)}
                    className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted"
                  >
                    {prepCanal === 'llamada' ? 'No se hizo' : 'No se envió'}
                  </button>
                  <button
                    onClick={confirmarEnvio}
                    disabled={guardando}
                    className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {guardando ? 'Registrando...' : prepCanal === 'llamada' ? 'Llamada hecha ✓' : 'Enviado ✓'}
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
