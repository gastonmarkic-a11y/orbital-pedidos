import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, PiezaMarketing, Propuesta } from '../../lib/types'
import { siguienteDiaHabil, ymd } from '../../lib/dates'
import { aNacional, abrirWhatsApp } from '../../lib/telefono'
import { nombreDePila } from '../../lib/operadores'

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

// Al abrir WhatsApp/mail el celular sale de la app y al volver el navegador suele recargar
// la página, perdiendo el estado de React: el contacto quedaba sin confirmar y había que
// empezar de nuevo. Guardamos la acción en curso para poder retomarla exactamente donde quedó.
const CLAVE_PENDIENTE = 'orbital_envio_pendiente'

export interface EnvioPendiente {
  cod: string
  canal: Canal
  mensaje: string
  propId: number
  piezas: number[]
  ts: number
}

export function leerEnvioPendiente(): EnvioPendiente | null {
  try {
    const raw = localStorage.getItem(CLAVE_PENDIENTE)
    if (!raw) return null
    const p = JSON.parse(raw) as EnvioPendiente
    // Se descarta solo si es de otro día, para no revivir algo viejo por error
    if (Date.now() - p.ts > 12 * 3600 * 1000) {
      localStorage.removeItem(CLAVE_PENDIENTE)
      return null
    }
    return p
  } catch {
    return null
  }
}

function guardarEnvioPendiente(p: EnvioPendiente) {
  try {
    localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(p))
  } catch {
    /* sin storage disponible: se sigue igual, solo se pierde la restauración */
  }
}

export function limpiarEnvioPendiente() {
  try {
    localStorage.removeItem(CLAVE_PENDIENTE)
  } catch {
    /* ignora */
  }
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
  // Catálogo B2B para PEDIR (con token): distinto de los catálogos visuales PDF.
  // El link lleva token del cliente → precios propios y sin clave. Registra actividad propia.
  const [tokenCat, setTokenCat] = useState(false)
  const [tokenLink, setTokenLink] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  // Nota de contexto (NO es un recordatorio): lo que se habló / lo que quiero recordar
  // para llegar en tema cuando reaparezca la próxima agenda de este cliente.
  const [prepNota, setPrepNota] = useState('')
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

      setPrepFecha(ymd(siguienteDiaHabil(new Date(Date.now() + 86400000), setFer)))

      // Si volvimos de WhatsApp/mail y el navegador recargó, retomamos donde quedó
      // en vez de arrancar de cero (el contacto ya se hizo, falta confirmarlo).
      const pend = leerEnvioPendiente()
      if (pend && pend.cod === cliente.cod) {
        setPrepProp(pend.propId)
        setPrepPiezas(new Set(pend.piezas))
        setPrepCanal(pend.canal)
        setPrepMensaje(pend.mensaje)
        setPrepAbierto(true)
        setCargando(false)
        return
      }

      // Preselección (equivale al viejo abrirPreparacion)
      const sug = propuestaSugeridaDe(cliente, listaProps)
      const delTema = sug ? listaPiezas.filter((p) => p.tema === temaDePropuesta(sug.nombre) && p.url_publica) : []
      const pre = delTema.slice(0, 1)
      const tel = telWhatsApp(cliente.whatsapp || cliente.telefono)
      setPrepProp(sug?.id ?? 0)
      setPrepPiezas(new Set(pre.map((p) => p.id)))
      setPrepCanal(tel ? 'wa_me' : cliente.email ? 'mailto' : 'recordatorio')
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
    // Firma con el nombre de pila real del operador: la cuenta compartida figura como
    // "Prospección" en la base, pero quien escribe es Luna (o Damián).
    const remitente = nombreDePila(codigoEfectivo, nombreRemitente)
    // Todos los materiales elegidos, no solo el primero: se puede mandar catálogo +
    // lista de precios + propuesta en un mismo mensaje.
    const links = piezasSel
      .map((p) => ({ titulo: p.titulo, url: p.url_corta || p.url_publica }))
      .filter((x): x is { titulo: string; url: string } => !!x.url)
    const bloqueLinks =
      links.length === 1 ? `📎 ${links[0].url}` : links.map((l) => `📎 ${l.titulo}: ${l.url}`).join('\n')
    // Si hay un COPY cargado para el tema de esta propuesta, ese es el mensaje
    // (se edita desde Admin → Gestionar piezas de marketing)
    const copyPieza = todasPiezas.find(
      (x) => x.tema === temaDePropuesta(prop.nombre) && x.categoria === 'copy' && x.contenido_texto,
    )
    const saludo = `Hola${contacto}! Soy ${remitente} de Orbital Eyewear.`
    if (copyPieza?.contenido_texto) {
      return [saludo, links.length ? bloqueLinks : null, '', copyPieza.contenido_texto.trim()]
        .filter((x) => x !== null)
        .join('\n')
    }
    return [
      saludo,
      links.length ? `Te comparto ${prop.nombre}:\n${bloqueLinks}` : `Te quería contar sobre ${prop.nombre}.`,
      `¿Lo vemos juntos esta semana?`,
    ].join('\n')
  }

  // Agrega (o no) el bloque del catálogo B2B con token al final del mensaje.
  function conToken(msg: string, linkT: string | null) {
    if (!linkT) return msg
    return `${msg}\n\n🛒 Y para pedir directo, con tus precios y sin clave:\n${linkT}`
  }

  const armarMensaje = (c: Cliente, prop: Propuesta, sel: PiezaMarketing[]) =>
    conToken(armarMensajeCon(c, prop, sel, piezas, miNombre || vendedor?.nombre || ''), tokenCat ? tokenLink : null)

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
    // Se persiste antes de salir de la app: si el navegador recarga al volver, se retoma acá
    guardarEnvioPendiente({
      cod: cliente.cod,
      canal: prepCanal,
      mensaje: prepMensaje,
      propId: prepProp,
      piezas: [...prepPiezas],
      ts: Date.now(),
    })
    setPrepAbierto(true)
  }

  function terminar() {
    limpiarEnvioPendiente()
    onListo?.()
    onClose()
  }

  function cerrar() {
    limpiarEnvioPendiente()
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
    // Tipo de actividad propio para el catálogo B2B con token, separado del envío de propuesta.
    const desarrollo =
      prepCanal === 'llamada'
        ? `Llamada telefónica: ${prop?.nombre ?? ''}`
        : tokenCat
          ? `🛒 Envío catálogo B2B (con token)${prop?.nombre ? ` + ${prop.nombre}` : ''} (envío ${canalTxt})`
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
      nota_contexto: prepNota.trim() || null,
    })
    if (errAct) toast('El envío se guardó pero la actividad falló: ' + errAct.message, 'error')
    // Actualizar la ficha del cliente: lo último hablado / enviado queda visible en Cartera y Agenda
    const { error: errCli } = await supabase
      .from('clientes')
      .update({
        nota: `${prepCanal === 'llamada' ? '📞' : tokenCat ? '🛒' : '📤'} ${new Date().toLocaleDateString('es-AR')} — ${
          prepCanal === 'llamada' ? 'llamada' : tokenCat ? 'se envió catálogo para pedir' : 'se envió'
        } "${tokenCat ? 'Catálogo con token' : prop?.nombre ?? ''}" por ${canalTxt}. Próximo: ${sig.texto}.${
          prepNota.trim() ? ` 🧠 ${prepNota.trim()}` : ''
        }`,
        proximo_paso: sig.texto,
        proxima_agenda_fecha: fechaSig,
        agenda_owner: codigoEfectivo,
        // Al contactarlo, deja de ser un "nuevo contacto de prospección" destacado en la agenda
        derivado_por: null,
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

  // Todo el material disponible, agrupado por carpeta (categoría), para poder mandar
  // catálogo + lista de precios + info general y no solo lo del tema de la propuesta.
  const CARPETAS: { key: string; label: string }[] = [
    { key: 'propuesta', label: '📄 Propuestas' },
    { key: 'catalogo', label: '📚 Catálogos' },
    { key: 'precios', label: '💲 Listas de precios' },
    { key: 'copy', label: '✍️ Textos' },
    { key: 'imagen', label: '🖼 Imágenes' },
    { key: 'video', label: '🎬 Videos' },
    { key: 'guion', label: '🎙 Guiones' },
  ]
  const piezasEnviables = piezas.filter((p) => p.url_publica || p.url_corta)
  const carpetasConMaterial = CARPETAS.map((c) => ({
    ...c,
    items: piezasEnviables.filter((p) => p.categoria === c.key),
  })).filter((c) => c.items.length > 0)

  function togglePieza(id: number) {
    const next = new Set(prepPiezas)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPrepPiezas(next)
    if (propSel) setPrepMensaje(armarMensaje(cliente, propSel, piezas.filter((x) => next.has(x.id))))
  }

  function toggleCarpeta(ids: number[]) {
    const next = new Set(prepPiezas)
    const todosPuestos = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (todosPuestos) next.delete(id)
      else next.add(id)
    }
    setPrepPiezas(next)
    if (propSel) setPrepMensaje(armarMensaje(cliente, propSel, piezas.filter((x) => next.has(x.id))))
  }

  // Catálogo B2B para pedir (con token del cliente): genera el link y lo suma al mensaje.
  async function toggleTokenCat() {
    const seleccionadas = piezas.filter((x) => prepPiezas.has(x.id))
    if (tokenCat) {
      setTokenCat(false)
      if (propSel) setPrepMensaje(conToken(armarMensajeCon(cliente, propSel, seleccionadas, piezas, miNombre || vendedor?.nombre || ''), null))
      return
    }
    setTokenBusy(true)
    let linkT = tokenLink
    if (!linkT) {
      const { data, error } = await supabase.rpc('catalogo_link_cliente', { p_cod_cliente: cliente.cod })
      const r = data as any
      setTokenBusy(false)
      if (error || !r?.ok) { toast(r?.error || 'No se pudo generar el link con token', 'error'); return }
      linkT = window.location.origin + '/catalogo?k=' + r.codigo
      setTokenLink(linkT)
    } else setTokenBusy(false)
    setTokenCat(true)
    if (propSel) setPrepMensaje(conToken(armarMensajeCon(cliente, propSel, seleccionadas, piezas, miNombre || vendedor?.nombre || ''), linkT))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrar}>
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
          <button onClick={cerrar} className="text-sm text-muted">
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

            {!esAgenda && carpetasConMaterial.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1">
                  Material a incluir (viaja como link público, no vence) —{' '}
                  <b className="text-ink">{prepPiezas.size} seleccionado{prepPiezas.size === 1 ? '' : 's'}</b>
                </p>
                <div className="border border-black/10 rounded-lg divide-y divide-black/5 max-h-52 overflow-y-auto">
                  {carpetasConMaterial.map((carpeta) => {
                    const ids = carpeta.items.map((p) => p.id)
                    const todos = ids.every((id) => prepPiezas.has(id))
                    const delTema = carpeta.items.some((p) => piezasDelTema.some((t) => t.id === p.id))
                    return (
                      <div key={carpeta.key} className="p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-ink">
                            {carpeta.label}
                            {delTema && <span className="ml-1 text-[9px] text-brandDark">· del tema</span>}
                          </span>
                          <button
                            onClick={() => toggleCarpeta(ids)}
                            className="text-[10px] font-medium text-brandDark whitespace-nowrap"
                          >
                            {todos ? 'quitar todo' : 'agregar toda la carpeta'}
                          </button>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {carpeta.items.map((p) => (
                            <label key={p.id} className="flex items-center gap-2 text-xs text-ink">
                              <input type="checkbox" checked={prepPiezas.has(p.id)} onChange={() => togglePieza(p.id)} />
                              <span className="truncate">{p.titulo}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!esAgenda && (
              <button
                type="button"
                onClick={toggleTokenCat}
                disabled={tokenBusy}
                className={`w-full text-left rounded-lg border p-2.5 flex items-start gap-2.5 transition-colors ${
                  tokenCat ? 'border-brandDark bg-brandDark/5' : 'border-black/10 hover:border-black/25'
                }`}
              >
                <input type="checkbox" checked={tokenCat} readOnly className="mt-0.5 pointer-events-none" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-ink">
                    🛒 Catálogo para pedir <span className="font-normal text-brandDark">· con token del cliente</span>
                  </p>
                  <p className="text-[10px] text-faint leading-snug mt-0.5">
                    {tokenBusy
                      ? 'Generando link…'
                      : 'Distinto de los catálogos visuales (PDF): el cliente entra sin clave, con sus precios, y arma el pedido. Se registra como actividad “Envío catálogo”.'}
                  </p>
                </div>
              </button>
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
                    : 'Mensaje'}
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
                  {prepCanal === 'llamada' ? '¿Hiciste la llamada?' : '¿Se envió el mensaje?'} Al confirmar queda
                  registrado como actividad y se agenda el próximo paso automáticamente.
                </p>
                <label className="block text-xs text-muted">
                  🧠 Nota de contexto (opcional) — qué te dijo / qué querés recordar
                  <textarea
                    value={prepNota}
                    onChange={(e) => setPrepNota(e.target.value)}
                    rows={2}
                    placeholder="Ej: le interesó la línea nueva, pidió precios; retoma después del 10"
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
                  />
                  <span className="text-[10px] text-faint">
                    Es solo para llegar en tema a la próxima agenda. No es un recordatorio ni cambia la fecha del próximo paso.
                  </span>
                </label>
                <div className="flex gap-2">
                  <button onClick={cerrar} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                    {prepCanal === 'llamada' ? 'No se hizo' : 'No se envió'}
                  </button>
                  <button
                    onClick={confirmarEnvio}
                    disabled={guardando}
                    className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {guardando ? 'Registrando...' : '✓ Confirmar la acción'}
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
