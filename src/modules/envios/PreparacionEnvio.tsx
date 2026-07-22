import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, PiezaMarketing, Propuesta } from '../../lib/types'
import { siguienteDiaHabil, ymd } from '../../lib/dates'
import { aNacional, abrirWhatsApp } from '../../lib/telefono'

// Modal de preparación de contacto. Vive acá (y no dentro de Envios) para poder
// abrirlo también desde Cartera sin salir de la página: enviar es la acción más
// importante de la cartera y no debería obligar a cambiar de pantalla.

export type Canal = 'wa_me' | 'mailto' | 'llamada' | 'recordatorio' | 'reunion'

const COOLDOWN_DIAS = 15

// Motor de secuencia de multicontactos: qué acción sigue según el canal del contacto actual
const SIGUIENTE_PASO: Record<string, { texto: string; dias: number }> = {
  wa_me: { texto: '📞 Llamar para explicar la propuesta', dias: 2 },
  mailto: { texto: '📞 Llamar para explicar la propuesta', dias: 2 },
  llamada: { texto: '📤 Enviar la propuesta detallada + coordinar visita', dias: 2 },
}
const CANAL_TXT: Record<string, string> = {
  wa_me: 'WhatsApp',
  mailto: 'mail',
  llamada: 'llamada telefónica',
  reunion: 'reunión',
}

/** Tema de piezas de marketing asociado a cada propuesta */
export function temaDePropuesta(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('bienvenida')) return 'bienvenida'
  if (n.includes('canje')) return 'canje'
  if (n.includes('preventa')) return 'preventa'
  if (n.includes('perdido') || n.includes('recuper')) return 'recuperar'
  return 'general'
}

export function telWhatsApp(raw: string | null): string | null {
  if (!raw) return null
  // Toma el primer número del campo (puede haber varios separados por " / ")
  const primero = raw.split(/\s*[/,;|]+\s*/)[0] || raw
  const nac = aNacional(primero)
  return nac.length >= 10 ? '549' + nac : null
}

export default function PreparacionEnvio({
  cliente,
  onClose,
  onListo,
}: {
  cliente: Cliente
  onClose: () => void
  /** Se llama después de registrar la acción, para que el padre refresque su lista */
  onListo?: () => void
}) {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()

  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [miTelefono, setMiTelefono] = useState<string | null>(null)
  const [miNombre, setMiNombre] = useState('')
  const [feriados, setFeriados] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)

  const [prepProp, setPrepProp] = useState<number>(0)
  const [prepMensaje, setPrepMensaje] = useState('')
  const [prepPiezas, setPrepPiezas] = useState<Set<number>>(new Set())
  const [prepCanal, setPrepCanal] = useState<Canal>('wa_me')
  const [prepFecha, setPrepFecha] = useState('')
  const [prepHora, setPrepHora] = useState('')
  const [prepAbierto, setPrepAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Carga inicial + preselección de propuesta, canal y mensaje para este cliente
  useEffect(() => {
    let vivo = true
    async function cargar() {
      const [{ data: me }, { data: props }, { data: pzs }, { data: fers }] = await Promise.all([
        supabase.from('vendedores').select('telefono_remitente, nombre').eq('codigo', codigoEfectivo).maybeSingle(),
        supabase.from('propuestas_julio').select('*').eq('activa', true).order('orden'),
        supabase.from('piezas_marketing').select('*').eq('activa', true).order('orden'),
        supabase.from('feriados').select('fecha'),
      ])
      if (!vivo) return
      const yo = me as { telefono_remitente: string | null; nombre: string | null } | null
      const listaProps = (props as Propuesta[]) ?? []
      const listaPiezas = (pzs as PiezaMarketing[]) ?? []
      const setFer = new Set((fers ?? []).map((f: { fecha: string }) => f.fecha))

      setMiTelefono(yo?.telefono_remitente ?? null)
      setMiNombre(yo?.nombre ?? vendedor?.nombre ?? '')
      setPropuestas(listaProps)
      setPiezas(listaPiezas)
      setFeriados(setFer)

      // Preselección (equivale al viejo abrirPreparacion)
      const sug = propuestaSugeridaDe(cliente, listaProps)
      const delTema = sug ? listaPiezas.filter((p) => p.tema === temaDePropuesta(sug.nombre) && p.url_publica) : []
      const pre = delTema.slice(0, 1)
      const tel = telWhatsApp(cliente.whatsapp || cliente.telefono)
      setPrepProp(sug?.id ?? 0)
      setPrepPiezas(new Set(pre.map((p) => p.id)))
      setPrepCanal(tel ? 'wa_me' : cliente.email ? 'mailto' : 'recordatorio')
      setPrepFecha(ymd(siguienteDiaHabil(new Date(Date.now() + 86400000), setFer)))
      setPrepMensaje(sug ? armarMensajeCon(cliente, sug, pre, listaPiezas, yo?.nombre ?? vendedor?.nombre ?? '') : '')
      setCargando(false)
    }
    cargar()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.cod, codigoEfectivo])

  function propuestaSugeridaDe(c: Cliente, lista: Propuesta[]): Propuesta | null {
    const buscar = (rx: RegExp) => lista.find((p) => rx.test(p.nombre.toLowerCase())) ?? null
    const cl = c.clasificacion_recupero ?? ''
    if (cl === 'sin_historial') return buscar(/bienvenida/)
    if (cl === 'fidelizacion') return buscar(/preventa/) ?? buscar(/especial/)
    if (['2024', '2022_2023', '2021_o_antes'].includes(cl)) return buscar(/perdido|recuper/) ?? buscar(/canje/)
    if (cl === 'activo' || (c.unidades_2025 ?? 0) > 0)
      return (c.unidades_2025 ?? 0) > 0 ? (buscar(/canje/) ?? buscar(/preventa/)) : buscar(/preventa/)
    return buscar(/bienvenida/)
  }

  function armarMensajeCon(
    c: Cliente,
    prop: Propuesta,
    piezasSel: PiezaMarketing[],
    todasPiezas: PiezaMarketing[],
    nombreRemitente: string,
  ) {
    const contacto = c.contacto ? ` ${c.contacto.split(' ')[0]}` : ''
    const remitente = (nombreRemitente || 'el equipo').split(' ')[0]
    const link = piezasSel.find((p) => p.url_publica)?.url_corta || piezasSel.find((p) => p.url_publica)?.url_publica
    // Si hay un COPY cargado para el tema de esta propuesta, ese es el mensaje
    // (se edita desde Admin → Gestionar piezas de marketing)
    const copyPieza = todasPiezas.find(
      (x) => x.tema === temaDePropuesta(prop.nombre) && x.categoria === 'copy' && x.contenido_texto,
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

  const armarMensaje = (c: Cliente, prop: Propuesta, sel: PiezaMarketing[]) =>
    armarMensajeCon(c, prop, sel, piezas, miNombre || vendedor?.nombre || '')

  function proximoHabil(dias: number): string {
    return ymd(siguienteDiaHabil(new Date(Date.now() + dias * 86400000), feriados))
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
    if (!prop) return
    if (canal === 'llamada') setPrepMensaje(guionDelTema(prop.nombre))
    else setPrepMensaje(armarMensaje(cliente, prop, piezas.filter((x) => prepPiezas.has(x.id))))
  }

  function cambiarPropuesta(id: number) {
    const prop = propuestas.find((p) => p.id === id)
    if (!prop) return
    const delTema = piezas.filter((p) => p.tema === temaDePropuesta(prop.nombre) && p.url_publica)
    const pre = delTema.slice(0, 1)
    setPrepProp(id)
    setPrepPiezas(new Set(pre.map((p) => p.id)))
    setPrepMensaje(armarMensaje(cliente, prop, pre))
  }

  function abrirCanal() {
    if (prepCanal === 'llamada') {
      const nac = aNacional(cliente.whatsapp || cliente.telefono || '')
      if (nac.length < 10) {
        toast('Este cliente no tiene teléfono cargado', 'error')
        return
      }
      window.location.href = 'tel:+54' + nac
    } else if (prepCanal === 'wa_me') {
      const tel = telWhatsApp(cliente.whatsapp || cliente.telefono)
      if (!tel) {
        toast('Este cliente no tiene teléfono cargado', 'error')
        return
      }
      abrirWhatsApp(tel, prepMensaje)
    } else {
      if (!cliente.email) {
        toast('Este cliente no tiene mail cargado', 'error')
        return
      }
      const prop = propuestas.find((p) => p.id === prepProp)
      window.location.href = `mailto:${cliente.email}?subject=${encodeURIComponent(
        prop?.nombre ?? 'Propuesta Orbital',
      )}&body=${encodeURIComponent(prepMensaje)}`
    }
    setPrepAbierto(true)
  }

  function terminar() {
    onListo?.()
    onClose()
  }

  async function confirmarEnvio() {
    if (!vendedor) return
    setGuardando(true)
    const prop = propuestas.find((p) => p.id === prepProp)
    const { error } = await supabase.from('envios_propuesta').insert({
      cod_cliente: cliente.cod,
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
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
      actividad_desarrollo: desarrollo,
      actividad_futura: sig.texto,
      proximo_paso_fecha: fechaSig,
      propuesta_enviada_id: prepProp,
    })
    if (errAct) toast('El envío se guardó pero la actividad falló: ' + errAct.message, 'error')
    // Actualizar la ficha del cliente: lo último hablado / enviado queda visible en Cartera y Agenda
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `${prepCanal === 'llamada' ? '📞' : '📤'} ${new Date().toLocaleDateString('es-AR')} — ${
          prepCanal === 'llamada' ? 'llamada' : 'se envió'
        } "${prop?.nombre ?? ''}" por ${canalTxt}. Próximo: ${sig.texto}.`,
        proximo_paso: sig.texto,
        proxima_agenda_fecha: fechaSig,
        agenda_owner: codigoEfectivo,
      })
      .eq('cod', cliente.cod)
    if (errCli) toast('No se pudo actualizar la ficha del cliente: ' + errCli.message, 'error')
    setGuardando(false)
    if (!errAct && !errCli)
      toast(`✓ Envío registrado — ${cliente.nomcomerc || cliente.razon} entra en cooldown ${COOLDOWN_DIAS} días`, 'success')
    terminar()
  }

  async function confirmarRecordatorio() {
    if (!vendedor) return
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
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
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
        agenda_owner: codigoEfectivo,
      })
      .eq('cod', cliente.cod)
    setGuardando(false)
    if (errAct || errCli) {
      toast('No se pudo agendar el recordatorio: ' + (errAct?.message || errCli?.message), 'error')
      return
    }
    toast(`✓ Recordatorio agendado para el ${fechaTxt}`, 'success')
    terminar()
  }

  async function confirmarReunion() {
    if (!vendedor) return
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
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
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
        agenda_owner: codigoEfectivo,
      })
      .eq('cod', cliente.cod)
    setGuardando(false)
    if (errAct || errCli) {
      toast('No se pudo agendar la reunión: ' + (errAct?.message || errCli?.message), 'error')
      return
    }
    toast(`✓ Reunión agendada para el ${fechaTxt}${horaTxt}`, 'success')
    terminar()
  }

  const propSel = propuestas.find((p) => p.id === prepProp)
  const piezasDelTema = propSel
    ? piezas.filter((p) => p.tema === temaDePropuesta(propSel.nombre))
    : []
  const esAgenda = prepCanal === 'recordatorio' || prepCanal === 'reunion'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-black/10 w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{cliente.nomcomerc || cliente.razon}</p>
            <p className="text-xs text-faint">
              {cliente.cod} · {telWhatsApp(cliente.whatsapp || cliente.telefono) ?? 'sin teléfono'} ·{' '}
              {cliente.email ?? 'sin mail'}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-muted">
            ✕
          </button>
        </div>

        {cargando ? (
          <p className="text-sm text-muted py-6 text-center">Cargando propuestas…</p>
        ) : (
          <>
            {!esAgenda && (
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

            {!esAgenda && piezasDelTema.length > 0 && (
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
                          if (props) setPrepMensaje(armarMensaje(cliente, props, piezas.filter((x) => next.has(x.id))))
                        }}
                      />
                      {p.titulo} <span className="text-faint">({p.categoria})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {esAgenda && (
              <div className={prepCanal === 'reunion' ? 'grid grid-cols-2 gap-2' : ''}>
                <label className="block text-xs text-muted">
                  📅 {prepCanal === 'reunion' ? 'Fecha de la reunión' : 'Fecha del recordatorio'} (aparece en la Agenda
                  ese día)
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
                rows={prepCanal === 'llamada' ? 8 : esAgenda ? 3 : 5}
                placeholder={
                  prepCanal === 'recordatorio'
                    ? 'Ej: el dueño no estaba, llamar mañana a la mañana'
                    : prepCanal === 'reunion'
                      ? 'Ej: presentar la colección nueva en el local'
                      : undefined
                }
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
              {prepCanal !== 'llamada' && !esAgenda && (
                <span className={`text-[10px] ${prepMensaje.length > 400 ? 'text-red-600 font-semibold' : 'text-faint'}`}>
                  {prepMensaje.length} caracteres{' '}
                  {prepMensaje.length > 400 ? '— demasiado largo para WhatsApp, acortalo' : ''}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => elegirCanal('llamada')}
                disabled={aNacional(cliente.whatsapp || cliente.telefono || '').length < 10}
                className={`rounded-lg py-2 text-xs font-semibold border ${
                  prepCanal === 'llamada' ? 'bg-amber-500 text-white border-amber-500' : 'border-black/10 text-muted'
                } disabled:opacity-30`}
              >
                📞 Llamar
              </button>
              <button
                onClick={() => elegirCanal('wa_me')}
                disabled={!telWhatsApp(cliente.whatsapp || cliente.telefono)}
                className={`rounded-lg py-2 text-xs font-semibold border ${
                  prepCanal === 'wa_me' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 text-muted'
                } disabled:opacity-30`}
              >
                📱 WhatsApp
              </button>
              <button
                onClick={() => elegirCanal('mailto')}
                disabled={!cliente.email}
                className={`rounded-lg py-2 text-xs font-semibold border ${
                  prepCanal === 'mailto' ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'
                } disabled:opacity-30`}
              >
                ✉️ Mail
              </button>
              <button
                onClick={() => elegirCanal('recordatorio')}
                className={`rounded-lg py-2 text-xs font-semibold border ${
                  prepCanal === 'recordatorio' ? 'bg-violet-600 text-white border-violet-600' : 'border-black/10 text-muted'
                }`}
              >
                ⏰ Recordatorio
              </button>
              <button
                onClick={() => elegirCanal('reunion')}
                className={`col-span-2 rounded-lg py-2 text-xs font-semibold border ${
                  prepCanal === 'reunion' ? 'bg-sky-600 text-white border-sky-600' : 'border-black/10 text-muted'
                }`}
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
                  {prepCanal === 'llamada' ? '¿Hiciste la llamada?' : '¿Se envió?'} Queda registrado como actividad y se
                  agenda el próximo paso automáticamente.
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
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
          </>
        )}
      </div>
    </div>
  )
}
