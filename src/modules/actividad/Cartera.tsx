import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, Propuesta } from '../../lib/types'
import { daysSince, firstOfMonth } from '../../lib/dates'
import HistorialModal from './HistorialModal'
import PreparacionEnvio, { leerEnvioPendiente } from '../envios/PreparacionEnvio'
import TelefonoAcciones from '../../lib/TelefonoAcciones'
import { telefonosCliente } from '../../lib/telefono'
import { NOMBRE_OPERADOR } from '../../lib/operadores'

const ORIGEN_LABELS: Record<string, string> = {
  propio: '👤 Propio',
  asignado: '📌 Asignado',
  ex_vendedor: '⚡ Ex-vendedor',
  marketing_frio: '🌐 Marketing frío',
  con_nota: '📋 Con nota',
}

const PRIO_COLORS: Record<string, string> = {
  cierre: 'bg-red-500',
  alta: 'bg-red-500',
  media_alta: 'bg-amber-500',
  media: 'bg-amber-500',
  tibio: 'bg-emerald-500',
}

// Un contacto queda "reservado" para quien lo trabajó: durante estos días el otro
// operador ve el aviso antes de volver a contactarlo, para no duplicar el contacto.
const RESERVA_DIAS = 15

// Color por operador: de un vistazo se ve quién está trabajando cada contacto.
const COLOR_OPERADOR: Record<string, { barra: string; pill: string }> = {
  Marketing: { barra: '#8b5cf6', pill: 'bg-violet-100 text-violet-700' }, // Luna
  Damian: { barra: '#2563eb', pill: 'bg-blue-100 text-blue-700' }, // Damián
  ProspeccionVenta: { barra: '#2563eb', pill: 'bg-blue-100 text-blue-700' }, // Damián histórico
  Adrian: { barra: '#0d9488', pill: 'bg-teal-100 text-teal-700' },
  Martin: { barra: '#c2410c', pill: 'bg-orange-100 text-orange-700' },
  Corporativo: { barra: '#6b7280', pill: 'bg-gray-100 text-gray-700' },
}
const COLOR_LIBRE = '#d4d4d8' // sin contactar / reserva vencida

const TABS_VENDEDOR = [
  { codigo: 'Adrian', label: 'Adrián' },
  { codigo: 'Martin', label: 'Martín' },
  { codigo: 'Marketing', label: 'Prospección' },
  { codigo: 'ProspeccionVenta', label: 'Venta directa' },
  { codigo: 'Corporativo', label: 'Corporativo' },
]

// Destinos de derivación. Disponibles para todos los roles; se descarta el propio.
const DERIVAR_OPTS = [
  { codigo: 'Adrian', label: 'Adrián' },
  { codigo: 'Martin', label: 'Martín' },
  { codigo: 'Corporativo', label: 'Corporativo' },
  { codigo: 'Marketing', label: '🔍 Prospección' },
  { codigo: 'ProspeccionVenta', label: '💰 Venta directa' },
]

type Segmento = 'canje' | 'recuperar' | 'bienvenida' | 'fidelizacion'
type ColOrden = 'comercio' | 'contacto' | 'mail' | 'zona' | 'whatsapp' | 'u2025' | 'canje' | 'ultima_compra' | 'clasificacion' | 'actividad'

export default function Cartera() {
  const { vendedor, rolEfectivo, codigoEfectivo } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const esAdmin = rolEfectivo === 'admin'
  const [tabVendedor, setTabVendedor] = useState('Adrian')
  const codigoActivo = esAdmin ? tabVendedor : codigoEfectivo
  // Operador de prospección (Luna=Marketing, Damián=ProspeccionVenta) logueado directamente
  const esProspOperador = !esAdmin && (codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian')
  const [modoCartera, setModoCartera] = useState<'prospectos' | 'venta_directa'>('prospectos')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cohorte, setCohorte] = useState<Record<string, { v2026: boolean; v2025: boolean; ultimoAnio: number | null; u2025: number }>>({})
  const [ultimaAct, setUltimaAct] = useState<Record<string, string>>({})
  const [ultimaActPor, setUltimaActPor] = useState<Record<string, string>>({})
  const [propuestaMes, setPropuestaMes] = useState<Record<string, string>>({})
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [loading, setLoading] = useState(true)
  const [segmento, setSegmento] = useState<Segmento>('canje')
  const [busqueda, setBusqueda] = useState('')
  const [zonaFiltro, setZonaFiltro] = useState('')
  const [corpFiltro, setCorpFiltro] = useState('')
  const [orden, setOrden] = useState<{ col: ColOrden; dir: 1 | -1 } | null>(null)
  const [historial, setHistorial] = useState<Cliente | null>(null)
  const [editDatos, setEditDatos] = useState<Cliente | null>(null)
  const [dm, setDm] = useState({ nombre: '', contacto: '', whatsapp: '', telefono: '', email: '', direccion: '', horario: '' })
  const [dmSaving, setDmSaving] = useState(false)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [np, setNp] = useState({ nomcomerc: '', razon: '', contacto: '', telefono: '', email: '', localidad: '', zona: '', nota: '' })
  const [npSaving, setNpSaving] = useState(false)
  const [borrar, setBorrar] = useState<Cliente | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [derivar, setDerivar] = useState<Cliente | null>(null)
  const [derivando, setDerivando] = useState(false)
  // Nota / recordatorio manual desde la cartera
  const [notaCli, setNotaCli] = useState<Cliente | null>(null)
  const [notaTxt, setNotaTxt] = useState('')
  const [notaFecha, setNotaFecha] = useState('')
  const [notaSaving, setNotaSaving] = useState(false)
  const [avisoReserva, setAvisoReserva] = useState<Cliente | null>(null)
  const [enviarA, setEnviarA] = useState<Cliente | null>(null)
  // Filtro por quién viene trabajando cada contacto (multi-selección). Vacío = sin filtrar.
  const [filtroTrabaja, setFiltroTrabaja] = useState<Set<string>>(new Set())
  const [recarga, setRecarga] = useState(0)

  // Prospección: en "Prospectos" solo se deriva; el pedido queda para "Venta directa"
  const mostrarPedido = !esProspOperador || modoCartera === 'venta_directa'
  // Derivar disponible para todos los roles (vendedores, prospección y corporativo)
  const mostrarDerivar = true

  // La reserva y los colores solo tienen sentido en el pool compartido de prospección
  // (Luna y Damián sobre la misma cartera). En la cartera propia de un vendedor no
  // aporta nada ver de qué color es cada fila.
  const carteraCompartida = esProspOperador && modoCartera === 'prospectos'

  // Reserva: quién viene trabajando el contacto y si sigue vigente (15 días).
  // Se calcula de la última actividad real, no de una marca aparte, así nunca queda desfasado.
  function reservaDe(cod: string) {
    const por = ultimaActPor[cod] ?? null
    const dias = daysSince(ultimaAct[cod] ?? null)
    const vigente = carteraCompartida && por !== null && dias !== null && dias < RESERVA_DIAS
    const mia = por === codigoEfectivo || (por === 'ProspeccionVenta' && codigoEfectivo === 'Damian')
    return {
      por,
      dias,
      vigente,
      ajena: vigente && !mia,
      quedan: dias === null ? 0 : Math.max(0, RESERVA_DIAS - dias),
      nombre: por ? (NOMBRE_OPERADOR[por] ?? por) : null,
      color: vigente && por ? (COLOR_OPERADOR[por]?.barra ?? COLOR_LIBRE) : COLOR_LIBRE,
      pill: vigente && por ? (COLOR_OPERADOR[por]?.pill ?? 'bg-black/5 text-muted') : 'bg-black/5 text-muted',
    }
  }

  useEffect(() => {
    supabase.from('propuestas_julio').select('*').then(({ data }) => setPropuestas((data as Propuesta[]) ?? []))
  }, [])

  useEffect(() => {
    if (!vendedor || !codigoActivo) return
    setLoading(true)
    async function cargar() {
      const rows = await fetchPaged<Cliente>(() => {
        let q = supabase.from('clientes').select('*').not('origen', 'is', null).order('cod')
        if (esProspOperador) {
          // Luna y Damián comparten la misma cartera: Prospectos (leads) o Venta directa (vendidos)
          q =
            modoCartera === 'venta_directa'
              ? q.eq('vendedor_asignado', 'ProspeccionVenta')
              : q.or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
        } else {
          q =
            codigoActivo === 'Marketing'
              ? q.or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
              : q.eq('vendedor_asignado', codigoActivo)
        }
        return q
      })
      setClientes(rows)
      const codsSet = new Set(rows.map((c) => c.cod))
      // Cohorte por ventas reales (histórico): 2026=fidelizado, 2025=con ventas/canje, previas=recuperar, sin ventas=bienvenida.
      const codsArr = rows.map((c) => c.cod)
      const coMap: Record<string, { v2026: boolean; v2025: boolean; ultimoAnio: number | null; u2025: number }> = {}
      for (let i = 0; i < codsArr.length; i += 300) {
        const { data } = await supabase.from('v_cliente_cohorte').select('cod_cliente, v2026, v2025, ultimo_anio, u2025').in('cod_cliente', codsArr.slice(i, i + 300))
        for (const r of (data as { cod_cliente: string; v2026: boolean; v2025: boolean; ultimo_anio: number | null; u2025: number }[]) ?? [])
          coMap[r.cod_cliente] = { v2026: r.v2026, v2025: r.v2025, ultimoAnio: r.ultimo_anio, u2025: r.u2025 }
      }
      setCohorte(coMap)
      const acts = await fetchPaged<{ cod_cliente: string | null; fecha: string; vendedor: string | null; propuesta_enviada_id: number | null }>(
        () =>
          supabase
            .from('actividad_diaria')
            .select('cod_cliente, fecha, vendedor, propuesta_enviada_id')
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
      )
      const ult: Record<string, string> = {}
      const ultPor: Record<string, string> = {}
      const prop: Record<string, string> = {}
      const inicioMes = firstOfMonth()
      for (const a of acts) {
        if (!a.cod_cliente || !codsSet.has(a.cod_cliente)) continue
        if (!ult[a.cod_cliente]) {
          ult[a.cod_cliente] = a.fecha
          if (a.vendedor) ultPor[a.cod_cliente] = a.vendedor
        }
        if (a.propuesta_enviada_id && a.fecha >= inicioMes && !prop[a.cod_cliente])
          prop[a.cod_cliente] = String(a.propuesta_enviada_id)
      }
      setUltimaAct(ult)
      setUltimaActPor(ultPor)
      setPropuestaMes(prop)
      setLoading(false)
    }
    cargar()
  }, [vendedor, codigoActivo, recarga, esProspOperador, modoCartera])

  // Si el celular recargó la página al volver de WhatsApp/mail, reabrimos el popup
  // en el mismo contacto para poder confirmar la acción sin rehacer todo.
  useEffect(() => {
    if (loading || enviarA || clientes.length === 0) return
    const pend = leerEnvioPendiente()
    if (!pend) return
    const c = clientes.find((x) => x.cod === pend.cod)
    if (c) setEnviarA(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, clientes])

  // Cohorte EXCLUYENTE por ventas reales (sin duplicados ni limbo):
  //  2026 → Fidelizado (activo este año) · 2025 → Con ventas/Canje · previas a 2025 → A recuperar · sin ventas → Bienvenida (frío)
  const cohorteDe = (c: Cliente): Segmento => {
    const co = cohorte[c.cod]
    if (co?.v2026) return 'fidelizacion'
    if (co?.v2025 || (c.unidades_2025 ?? 0) > 0) return 'canje'
    if (co?.ultimoAnio) return 'recuperar'
    return 'bienvenida'
  }
  const esFidelizado = (c: Cliente) => cohorteDe(c) === 'fidelizacion'
  const conVentas = useMemo(() => clientes.filter((c) => cohorteDe(c) === 'canje'), [clientes, cohorte]) // eslint-disable-line react-hooks/exhaustive-deps
  const aRecuperar = useMemo(() => clientes.filter((c) => cohorteDe(c) === 'recuperar'), [clientes, cohorte]) // eslint-disable-line react-hooks/exhaustive-deps
  const bienvenida = useMemo(() => clientes.filter((c) => cohorteDe(c) === 'bienvenida'), [clientes, cohorte]) // eslint-disable-line react-hooks/exhaustive-deps
  const fidelizados = useMemo(() => clientes.filter((c) => cohorteDe(c) === 'fidelizacion'), [clientes, cohorte]) // eslint-disable-line react-hooks/exhaustive-deps

  const zonas = useMemo(() => {
    const set = new Set<string>()
    for (const c of clientes) if (c.zona) set.add(c.zona)
    return [...set].sort()
  }, [clientes])

  const segmentoRows =
    segmento === 'canje' ? conVentas : segmento === 'recuperar' ? aRecuperar : segmento === 'fidelizacion' ? fidelizados : bienvenida

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    // Con búsqueda activa se busca en TODA la cartera, no solo en el segmento
    let base = q ? clientes : segmentoRows
    if (q)
      base = base.filter(
        (c) =>
          (c.nomcomerc || c.razon || '').toLowerCase().includes(q) ||
          (c.cod || '').toLowerCase().includes(q) ||
          (c.zona || '').toLowerCase().includes(q) ||
          (c.localidad || '').toLowerCase().includes(q) ||
          (c.nota || '').toLowerCase().includes(q)
      )
    if (zonaFiltro) base = base.filter((c) => (c.zona || '') === zonaFiltro)
    if (corpFiltro && codigoActivo === 'Corporativo') base = base.filter((c) => (c.segmento_corporativo || '') === corpFiltro)
    // Filtro por quién lo viene trabajando: 'libre' = sin contactar o con la reserva vencida
    if (filtroTrabaja.size > 0)
      base = base.filter((c) => {
        const r = reservaDe(c.cod)
        return filtroTrabaja.has(r.vigente && r.por ? r.por : 'libre')
      })

    const maxCanje = Math.max(...base.map((c) => Math.floor((c.unidades_2025 ?? 0) * 0.2)), 1)
    const ordenadas = [...base]

    if (orden) {
      const { col, dir } = orden
      ordenadas.sort((a, b) => {
        let r = 0
        if (col === 'comercio') r = (a.nomcomerc || a.razon || '').localeCompare(b.nomcomerc || b.razon || '')
        else if (col === 'contacto') r = (a.contacto || 'zzz').localeCompare(b.contacto || 'zzz')
        else if (col === 'mail') r = (a.email || 'zzz').localeCompare(b.email || 'zzz')
        else if (col === 'zona') r = (a.zona || a.localidad || '').localeCompare(b.zona || b.localidad || '')
        else if (col === 'whatsapp') {
          const na = telefonosCliente(a.whatsapp, a.telefono)[0]?.nacional || ''
          const nb = telefonosCliente(b.whatsapp, b.telefono)[0]?.nacional || ''
          r = (na || 'zzz').localeCompare(nb || 'zzz')
        }
        else if (col === 'u2025') r = (a.unidades_2025 ?? 0) - (b.unidades_2025 ?? 0)
        else if (col === 'canje') r = Math.floor((a.unidades_2025 ?? 0) * 0.2) - Math.floor((b.unidades_2025 ?? 0) * 0.2)
        else if (col === 'ultima_compra') r = (a.ultima_compra_fecha || '').localeCompare(b.ultima_compra_fecha || '')
        else if (col === 'clasificacion') r = (a.clasificacion_recupero || '').localeCompare(b.clasificacion_recupero || '')
        else if (col === 'actividad') r = (daysSince(ultimaAct[a.cod] ?? null) ?? 99999) - (daysSince(ultimaAct[b.cod] ?? null) ?? 99999)
        return r * dir
      })
    } else {
      // Orden por defecto: los más olvidados primero (sin contactar / hace más tiempo)
      ordenadas.sort((a, b) => (daysSince(ultimaAct[b.cod] ?? null) ?? 9999) - (daysSince(ultimaAct[a.cod] ?? null) ?? 9999))
    }
    return ordenadas.map((c) => ({ c, maxCanje }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentoRows, clientes, busqueda, zonaFiltro, corpFiltro, codigoActivo, orden, ultimaAct, ultimaActPor, filtroTrabaja])

  function toggleOrden(col: ColOrden) {
    setOrden((prev) => (prev?.col === col ? (prev.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))
  }

  function flecha(col: ColOrden) {
    if (orden?.col !== col) return <span className="opacity-30">↕</span>
    return orden.dir === 1 ? '▲' : '▼'
  }

  function Th({ col, children, right }: { col?: ColOrden; children: React.ReactNode; right?: boolean }) {
    return (
      <th className={`${right ? 'text-right' : 'text-left'} text-[10px] uppercase text-muted font-semibold px-2.5 py-2 whitespace-nowrap`}>
        {col ? (
          <button onClick={() => toggleOrden(col)} className="uppercase font-semibold hover:text-ink">
            {children} {flecha(col)}
          </button>
        ) : (
          children
        )}
      </th>
    )
  }

  async function guardarProspecto() {
    if (!np.nomcomerc.trim() && !np.razon.trim()) return
    setNpSaving(true)
    const codTemporal = 'TMP-' + Date.now().toString().slice(-8)
    const { error } = await supabase.from('clientes').insert({
      cod: codTemporal,
      razon: np.razon.trim() || np.nomcomerc.trim(),
      nomcomerc: np.nomcomerc.trim() || null,
      contacto: np.contacto.trim() || null,
      telefono: np.telefono.trim() || null,
      whatsapp: np.telefono.trim() || null,
      email: np.email.trim() || null,
      localidad: np.localidad.trim() || null,
      zona: np.zona.trim() || null,
      origen: 'propio',
      vendedor_asignado: codigoActivo || codigoEfectivo,
      clasificacion_recupero: 'sin_historial',
      nota: ('⏳ Código de cliente pendiente de validación por Administración. ' + np.nota.trim()).trim(),
    })
    setNpSaving(false)
    if (error) {
      toast('No se pudo crear el prospecto: ' + error.message, 'error')
      return
    }
    if (!error) {
      setNuevoOpen(false)
      setNp({ nomcomerc: '', razon: '', contacto: '', telefono: '', email: '', localidad: '', zona: '', nota: '' })
      setSegmento('bienvenida')
      setRecarga((r) => r + 1)
    }
  }

  function abrirDatos(c: Cliente) {
    setEditDatos(c)
    setDm({
      nombre: c.nomcomerc ?? c.razon ?? '',
      contacto: c.contacto ?? '',
      whatsapp: c.whatsapp ?? '',
      telefono: c.telefono ?? '',
      email: c.email ?? '',
      direccion: c.direccion ?? '',
      horario: c.horario_entrega ?? '',
    })
  }

  async function guardarDatos() {
    if (!editDatos) return
    setDmSaving(true)
    const cambios = {
      nomcomerc: dm.nombre.trim() || editDatos.nomcomerc,
      contacto: dm.contacto.trim() || null,
      whatsapp: dm.whatsapp.trim() || null,
      telefono: dm.telefono.trim() || null,
      email: dm.email.trim() || null,
      direccion: dm.direccion.trim() || null,
      horario_entrega: dm.horario.trim() || null,
    }
    const { error } = await supabase.from('clientes').update(cambios).eq('cod', editDatos.cod)
    setDmSaving(false)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    setClientes((prev) => prev.map((x) => (x.cod === editDatos.cod ? { ...x, ...cambios } : x)))
    setEditDatos(null)
    toast('✓ Datos guardados', 'success')
  }

  // Si otro operador lo viene trabajando y la reserva sigue vigente, avisa antes de pisar.
  // Enviar es la acción más importante de la cartera: se abre como popup, sin salir de acá.
  function enviar(c: Cliente) {
    if (reservaDe(c.cod).ajena) {
      setAvisoReserva(c)
      return
    }
    setEnviarA(c)
  }

  async function eliminarContacto() {
    if (!borrar) return
    setBorrando(true)
    const { error } = await supabase.from('clientes').delete().eq('cod', borrar.cod)
    setBorrando(false)
    if (error) {
      toast('No se pudo eliminar: ' + error.message, 'error')
      return
    }
    setClientes((prev) => prev.filter((x) => x.cod !== borrar.cod))
    setBorrar(null)
    toast('🗑 Contacto eliminado de la cartera', 'success')
  }

  async function derivarA(codigoDest: string) {
    if (!derivar) return
    setDerivando(true)
    // Va por RPC (no update directo): al derivar el cliente deja de ser tuyo y las
    // políticas de seguridad rechazaban el update. La función valida el permiso server-side.
    const { error } = await supabase.rpc('derivar_cliente', { p_cod: derivar.cod, p_destino: codigoDest })
    setDerivando(false)
    if (error) {
      toast('No se pudo derivar: ' + error.message, 'error')
      return
    }
    // Ya no pertenece a esta vista de prospección: lo sacamos de la lista
    setClientes((prev) => prev.filter((x) => x.cod !== derivar.cod))
    const destLabel = DERIVAR_OPTS.find((d) => d.codigo === codigoDest)?.label ?? codigoDest
    setDerivar(null)
    toast(`✓ ${derivar.nomcomerc || derivar.razon} derivado a ${destLabel}`, 'success')
  }

  function abrirNota(c: Cliente) {
    setNotaCli(c)
    setNotaTxt('')
    setNotaFecha('')
  }

  async function guardarNota() {
    if (!notaCli) return
    const txt = notaTxt.trim()
    if (!txt) {
      toast('Escribí la nota', 'error')
      return
    }
    setNotaSaving(true)
    const hoy = new Date().toLocaleDateString('es-AR')
    const cuando = notaFecha ? ` (recordar el ${new Date(notaFecha + 'T00:00:00').toLocaleDateString('es-AR')})` : ''
    const linea = `🔔 ${hoy}${cuando} — ${txt}`
    // Se antepone la nota nueva y se conserva lo anterior como historial (tope 500 chars)
    const previa = (notaCli.nota || '').trim()
    const nuevaNota = (previa ? `${linea} · ${previa}` : linea).slice(0, 500)
    const upd: Record<string, unknown> = { nota: nuevaNota }
    // Con fecha, además queda agendado como recordatorio en la Agenda de ese día
    if (notaFecha) {
      upd.proximo_paso = txt
      upd.proxima_agenda_fecha = notaFecha
      upd.agenda_owner = codigoActivo || codigoEfectivo
    }
    const { error } = await supabase.from('clientes').update(upd).eq('cod', notaCli.cod)
    if (!error && notaFecha) {
      await supabase.from('actividad_diaria').insert({
        vendedor: codigoActivo || codigoEfectivo,
        cod_cliente: notaCli.cod,
        nombre_comercio: notaCli.nomcomerc,
        contacto: notaCli.contacto,
        telefono: notaCli.whatsapp || notaCli.telefono,
        localidad: notaCli.localidad,
        email: notaCli.email,
        actividad_desarrollo: `🔔 Recordatorio: ${txt}`,
        actividad_futura: txt,
        proximo_paso_fecha: notaFecha,
        nota_contexto: txt,
      })
    }
    setNotaSaving(false)
    if (error) {
      toast('No se pudo guardar la nota: ' + error.message, 'error')
      return
    }
    setClientes((prev) => prev.map((x) => (x.cod === notaCli.cod ? { ...x, nota: nuevaNota } : x)))
    toast(notaFecha ? '✓ Recordatorio agendado' : '✓ Nota guardada', 'success')
    setNotaCli(null)
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando cartera...</p>

  const buscando = !!busqueda.trim()
  const mostrarCanjeCols = !buscando && segmento === 'canje'
  const mostrarRecuperarCols = !buscando && (segmento === 'recuperar' || segmento === 'fidelizacion')

  return (
    <div className="space-y-3 text-ink">
      {esAdmin && (
        <div className="flex gap-1 overflow-x-auto border-b border-black/10 pb-px">
          {TABS_VENDEDOR.map((t) => (
            <button
              key={t.codigo}
              onClick={() => setTabVendedor(t.codigo)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${
                tabVendedor === t.codigo ? 'text-brandDark border-brand' : 'text-muted border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {esProspOperador && (
        <div className="flex gap-1 bg-black/5 rounded-lg p-1 w-fit">
          {(
            [
              ['prospectos', '🔍 Prospectos'],
              ['venta_directa', '💰 Venta directa'],
            ] as ['prospectos' | 'venta_directa', string][]
          ).map(([modo, label]) => (
            <button
              key={modo}
              onClick={() => setModoCartera(modo)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md ${
                modoCartera === modo ? 'bg-white shadow-sm text-brandDark' : 'text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Las tarjetas SON los filtros: tocás una y se filtra la lista. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(
          [
            { label: 'Con ventas 2025', val: conVentas.length, color: 'bg-emerald-500', seg: 'canje', sub: 'ventas en 2025 · canje' },
            { label: 'A recuperar', val: aRecuperar.length, color: 'bg-orange-500', seg: 'recuperar', sub: 'con ventas previas a 2025' },
            { label: 'Bienvenida', val: bienvenida.length, color: 'bg-red-500', seg: 'bienvenida', sub: 'sin ventas (fríos)' },
            { label: '⭐ Fidelizados', val: fidelizados.length, color: 'bg-violet-500', seg: 'fidelizacion', sub: 'con ventas 2026 (activos)' },
          ] as { label: string; val: number; color: string; seg: Segmento; sub: string }[]
        ).map((k) => {
          const activo = !buscando && segmento === k.seg
          return (
            <button
              key={k.label}
              onClick={() => setSegmento(k.seg)}
              className={`text-left bg-white border rounded-xl p-3 relative overflow-hidden transition ${activo ? 'border-brand ring-2 ring-brand/30' : 'border-black/10 hover:border-brand/40'}`}
            >
              <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.color}`} />
              <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.label}</p>
              <p className="text-2xl font-bold">{k.val}</p>
              <p className="text-[10px] text-faint mt-0.5 leading-tight">{k.sub}</p>
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => setRecarga((r) => r + 1)} className="text-xs font-medium px-3 py-1.5 rounded-full border border-black/10 text-muted">⟳ Actualizar</button>
        <button onClick={() => setNuevoOpen(true)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-white">+ Nuevo prospecto</button>
        <span className="text-[11px] text-faint">Tocá una tarjeta de arriba para filtrar la lista.</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          placeholder="Buscar en toda la cartera: nombre, código, zona, localidad, nota..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 min-w-[200px] bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-brand"
        />
        {codigoActivo === 'Corporativo' && (
          <select
            value={corpFiltro}
            onChange={(e) => setCorpFiltro(e.target.value)}
            className="bg-white border border-black/10 rounded-lg px-2 py-2 text-sm text-muted"
          >
            <option value="">Corporativo: todos</option>
            <option value="corporativo">🏢 Corporativo</option>
            <option value="prensa">📰 Prensa</option>
            <option value="exterior">🌎 Exterior</option>
          </select>
        )}
        <select
          value={zonaFiltro}
          onChange={(e) => setZonaFiltro(e.target.value)}
          className="bg-white border border-black/10 rounded-lg px-2 py-2 text-sm text-muted max-w-[180px]"
        >
          <option value="">Todas las zonas</option>
          {zonas.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>

      {buscando && (
        <p className="text-[11px] text-faint">
          🔎 Buscando en toda la cartera ({filas.length} resultado{filas.length !== 1 ? 's' : ''}) — el segmento se ignora
          mientras haya texto en el buscador.
        </p>
      )}

      {/* Solo en el pool compartido: filtro por quién viene trabajando cada contacto.
          La leyenda de colores es el filtro: se puede marcar más de uno. */}
      {carteraCompartida && (
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Trabajando ahora</span>
          {(
            [
              ['Marketing', 'Luna', COLOR_OPERADOR.Marketing.barra],
              ['Damian', 'Damián', COLOR_OPERADOR.Damian.barra],
              ['libre', `Libre (sin contactar o +${RESERVA_DIAS}d)`, COLOR_LIBRE],
            ] as [string, string, string][]
          ).map(([key, nombre, color]) => {
            const activo = filtroTrabaja.has(key)
            return (
              <button
                key={key}
                onClick={() =>
                  setFiltroTrabaja((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${
                  activo ? 'border-brand bg-brand text-white' : 'border-black/10 hover:bg-[#F1EDE4]'
                }`}
              >
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
                {nombre}
              </button>
            )
          })}
          {filtroTrabaja.size > 0 && (
            <button onClick={() => setFiltroTrabaja(new Set())} className="text-brandDark font-medium underline">
              limpiar filtro
            </button>
          )}
        </div>
      )}

      {/* Vista celular: tarjetas con todos los datos, sin scroll lateral */}
      <div className="md:hidden space-y-2">
        {filas.map(({ c }) => {
          const dias = daysSince(ultimaAct[c.cod] ?? null)
          const canje = Math.floor((c.unidades_2025 ?? 0) * 0.2)
          const res = reservaDe(c.cod)
          return (
            <div
              key={c.cod}
              className="bg-white border border-black/10 rounded-xl p-3 space-y-1.5"
              style={{ boxShadow: `inset 4px 0 0 ${res.color}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {esFidelizado(c) && '⭐ '}
                    {c.nomcomerc || c.razon}
                  </p>
                  <p className="text-[11px] text-faint">
                    {c.cod} {c.origen && `· ${ORIGEN_LABELS[c.origen] ?? c.origen}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-block w-2.5 h-2.5 rounded-full mt-1 ${c.prioridad ? PRIO_COLORS[c.prioridad] ?? 'bg-[#c8c8d4]' : 'bg-[#c8c8d4]'}`}
                />
              </div>
              <p className="text-xs text-muted">
                📍 {c.zona || '—'}
                {c.localidad ? ` · ${c.localidad}` : ''}
              </p>
              <p className="text-xs text-muted">
                👤 {c.contacto || '—'} · ✉️ {c.email || '—'}{' '}
                <button onClick={() => abrirDatos(c)} className="text-brandDark font-medium">
                  ✏️
                </button>
              </p>
              <div className="text-xs">
                <TelefonoAcciones whatsapp={c.whatsapp} telefono={c.telefono} compact />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                {(c.unidades_2025 ?? 0) > 0 && (
                  <span>
                    U.2025: <b className="text-ink">{c.unidades_2025}</b>
                  </span>
                )}
                {canje > 0 && (
                  <span>
                    ↩ Canje: <b className="text-amber-600">{canje}</b>
                  </span>
                )}
                {c.ultima_compra_fecha && <span>🛍 Últ. compra: {c.ultima_compra_fecha}</span>}
                <span>
                  {dias === null ? (
                    <b className="text-red-600">Sin contactar</b>
                  ) : dias === 0 ? (
                    <b className="text-emerald-600">Contacto hoy</b>
                  ) : (
                    <b className={dias <= 7 ? 'text-emerald-600' : dias <= 21 ? 'text-amber-600' : 'text-red-600'}>
                      Hace {dias}d
                    </b>
                  )}
                </span>
                {res.nombre && dias !== null && (
                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${res.pill}`}>
                    {res.vigente ? `🔒 ${res.nombre} · ${res.quedan}d` : `por ${res.nombre}`}
                  </span>
                )}
              </div>
              {c.nota && <p className="text-[11px] text-muted">📝 {c.nota}</p>}
              <div className="flex items-stretch gap-1 pt-1">
                <button onClick={() => enviar(c)} className="flex-1 rounded-lg bg-brand text-white py-1.5 text-[11px] font-medium">
                  Enviar
                </button>
                {mostrarDerivar && (
                  <button onClick={() => setDerivar(c)} className="flex-1 rounded-lg bg-[#8F6A34] text-white py-1.5 text-[11px] font-medium">
                    Derivar
                  </button>
                )}
                {mostrarPedido && (
                  <button
                    onClick={() => navigate('/pedidos/nuevo', { state: { cliente: c } })}
                    className="flex-1 rounded-lg bg-emerald-600 text-white py-1.5 text-[11px] font-medium"
                  >
                    Pedido
                  </button>
                )}
                <button onClick={() => abrirNota(c)} className="flex-1 rounded-lg border border-black/10 py-1.5 text-[11px] text-muted" title="Agregar nota o recordatorio">
                  Nota
                </button>
                <button onClick={() => setHistorial(c)} className="flex-1 rounded-lg border border-black/10 py-1.5 text-[11px] text-muted">
                  Historial
                </button>
                <button
                  onClick={() => setBorrar(c)}
                  className="rounded-lg border border-red-200 text-red-600 px-2 py-1.5 text-[11px]"
                  title="Eliminar contacto"
                >
                  🗑
                </button>
              </div>
            </div>
          )
        })}
        {filas.length === 0 && (
          <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">
            {buscando ? 'Sin resultados en toda la cartera.' : 'No hay contactos en este segmento.'}
          </p>
        )}
      </div>

      {/* Vista computadora: tabla completa ordenable */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-[#F1EDE4]">
            <tr>
              <Th>Prio</Th>
              <Th col="comercio">Comercio</Th>
              <Th col="contacto">Contacto</Th>
              <Th col="mail">Mail</Th>
              <Th col="zona">Zona / Localidad</Th>
              <Th col="whatsapp">WhatsApp</Th>
              {mostrarCanjeCols && (
                <>
                  <Th col="u2025" right>
                    U. 2025
                  </Th>
                  <Th col="canje" right>
                    ↩ Canje
                  </Th>
                </>
              )}
              {mostrarRecuperarCols && (
                <>
                  <Th col="ultima_compra">Última compra</Th>
                  <Th col="clasificacion">Clasificación</Th>
                </>
              )}
              <Th col="actividad">Última actividad</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ c, maxCanje }) => {
              const dias = daysSince(ultimaAct[c.cod] ?? null)
              const canje = Math.floor((c.unidades_2025 ?? 0) * 0.2)
              const canjePct = Math.round((canje / maxCanje) * 100)
              const res = reservaDe(c.cod)
              return (
                <tr
                  key={c.cod}
                  className="border-t border-black/10 hover:bg-[#F1EDE4]"
                  style={{ boxShadow: `inset 4px 0 0 ${res.color}` }}
                >
                  <td className="px-2.5 py-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${c.prioridad ? PRIO_COLORS[c.prioridad] ?? 'bg-[#c8c8d4]' : 'bg-[#c8c8d4]'}`}
                    />
                  </td>
                  <td className="px-2.5 py-2 max-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-ink truncate">{c.nomcomerc || c.razon}</p>
                      {esFidelizado(c) && <span className="shrink-0 text-[10px]">⭐</span>}
                      {propuestaMes[c.cod] && (
                        <span
                          className="shrink-0 text-[9px] font-semibold bg-emerald-50 text-emerald-700 rounded-full px-1.5 py-0.5"
                          title={`Propuesta enviada este mes: ${propuestas.find((p) => String(p.id) === propuestaMes[c.cod])?.nombre ?? ''}`}
                        >
                          ✓ propuesta
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-faint">
                      {c.cod}{' '}
                      {c.origen && (
                        <span className="text-muted">
                          · {ORIGEN_LABELS[c.origen] ?? c.origen}
                          {c.origen === 'ex_vendedor' && c.ex_vendedor_origen ? ` (${c.ex_vendedor_origen})` : ''}
                        </span>
                      )}
                    </p>
                    {c.nota && (
                      <p className="text-[10px] text-muted truncate max-w-[180px]" title={c.nota}>
                        📝 {c.nota}
                      </p>
                    )}
                  </td>
                  <td className="px-2.5 py-2 text-xs max-w-[130px]">
                    <button onClick={() => abrirDatos(c)} className="text-left w-full" title="Editar datos de contacto">
                      <span className={`block truncate ${c.contacto ? 'text-ink' : 'text-faint'}`}>{c.contacto || '— agregar'}</span>
                      <span className="text-[10px] text-brandDark">✏️ editar</span>
                    </button>
                  </td>
                  <td className="px-2.5 py-2 text-xs max-w-[150px]">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-[#2f6fdb] truncate block" title={c.email}>
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2 text-muted text-xs">
                    {c.zona}
                    <br />
                    <span className="text-[10px] text-faint">{c.localidad}</span>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex items-start gap-1">
                      <TelefonoAcciones whatsapp={c.whatsapp} telefono={c.telefono} compact />
                      <button onClick={() => abrirDatos(c)} className="text-[10px] text-brandDark shrink-0" title="Editar teléfono">
                        ✏️
                      </button>
                    </div>
                  </td>
                  {mostrarCanjeCols && (
                    <>
                      <td className="px-2.5 py-2 text-right">{c.unidades_2025}</td>
                      <td className="px-2.5 py-2 text-right">
                        <span className="inline-block w-14 h-1.5 bg-black/5 rounded-full align-middle mr-1.5">
                          <span className="block h-full bg-amber-500 rounded-full" style={{ width: `${canjePct}%` }} />
                        </span>
                        <span className="font-semibold text-amber-600">{canje}</span>
                      </td>
                    </>
                  )}
                  {mostrarRecuperarCols && (
                    <>
                      <td className="px-2.5 py-2 text-xs text-muted">
                        {c.ultima_compra_fecha ?? '—'}
                        {c.ultima_compra_monto ? (
                          <div className="text-[10px] text-faint">${Math.round(c.ultima_compra_monto).toLocaleString()}</div>
                        ) : null}
                      </td>
                      <td className="px-2.5 py-2 text-xs text-orange-600">
                        {c.clasificacion_recupero === 'fidelizacion'
                          ? '⭐ Fidelizado'
                          : c.clasificacion_recupero === '2024'
                            ? '2024'
                            : c.clasificacion_recupero === '2022_2023'
                              ? '2022-23'
                              : c.clasificacion_recupero === '2021_o_antes'
                                ? '2021 o antes'
                                : (c.clasificacion_recupero ?? '—')}
                      </td>
                    </>
                  )}
                  <td className="px-2.5 py-2 text-xs">
                    {dias === null ? (
                      <span className="text-red-600 font-medium">Sin contactar</span>
                    ) : dias === 0 ? (
                      <span className="text-emerald-600">Hoy</span>
                    ) : dias <= 7 ? (
                      <span className="text-emerald-600">Hace {dias}d</span>
                    ) : dias <= 21 ? (
                      <span className="text-amber-600">Hace {dias}d</span>
                    ) : (
                      <span className="text-red-600 font-medium">Hace {dias}d</span>
                    )}
                    {res.nombre && dias !== null && (
                      <div className={`inline-block mt-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${res.pill}`}>
                        {res.vigente ? `🔒 ${res.nombre} · ${res.quedan}d` : `por ${res.nombre}`}
                      </div>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <button onClick={() => enviar(c)} className="text-[11px] text-brandDark font-medium whitespace-nowrap">
                        Enviar
                      </button>
                      {mostrarDerivar && (
                        <button onClick={() => setDerivar(c)} className="text-[11px] text-[#8F6A34] font-medium whitespace-nowrap">
                          Derivar
                        </button>
                      )}
                      {mostrarPedido && (
                        <button
                          onClick={() => navigate('/pedidos/nuevo', { state: { cliente: c } })}
                          className="text-[11px] text-emerald-600 font-medium whitespace-nowrap"
                        >
                          Pedido
                        </button>
                      )}
                      <button onClick={() => abrirNota(c)} className="text-[11px] text-brandDark font-medium whitespace-nowrap">
                        📝 Nota
                      </button>
                      <button onClick={() => setHistorial(c)} className="text-[11px] text-muted font-medium whitespace-nowrap">
                        Historial
                      </button>
                      <button onClick={() => setBorrar(c)} className="text-[11px] text-red-600 font-medium whitespace-nowrap">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-sm text-faint py-8">
                  {buscando ? 'Sin resultados en toda la cartera.' : 'No hay contactos en este segmento.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {historial && <HistorialModal cliente={historial} propuestas={propuestas} onClose={() => setHistorial(null)} />}

      {enviarA && (
        <PreparacionEnvio
          cliente={enviarA}
          onClose={() => setEnviarA(null)}
          onListo={() => setRecarga((r) => r + 1)}
        />
      )}

      {editDatos && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditDatos(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-ink mb-0.5">✏️ Datos de contacto y entrega</p>
            <p className="text-xs text-faint mb-3">{editDatos.nomcomerc || editDatos.razon}</p>
            <div className="space-y-2">
              {(
                [
                  ['nombre', 'Nombre del comercio'],
                  ['contacto', 'Nombre de contacto'],
                  ['whatsapp', '📱 WhatsApp (celular)'],
                  ['telefono', '☎️ Teléfono de línea'],
                  ['email', 'Mail'],
                  ['direccion', 'Dirección de entrega'],
                  ['horario', 'Horario de entrega (ej: Lun a Vie 9-13)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-xs text-muted">
                  {label}
                  <input
                    value={dm[key]}
                    onChange={(e) => setDm({ ...dm, [key]: e.target.value })}
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-3">
              <button onClick={() => setEditDatos(null)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button
                onClick={guardarDatos}
                disabled={dmSaving}
                className="flex-1 rounded-lg bg-brand text-white py-2 text-sm font-semibold disabled:opacity-50"
              >
                {dmSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {nuevoOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNuevoOpen(false)}>
          <div
            className="bg-white rounded-2xl border border-black/10 w-full max-w-md p-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-ink mb-1">+ Nuevo prospecto</p>
            <p className="text-xs text-faint mb-3">
              Se crea con un código provisorio. Administración le asigna el código de cliente definitivo cuando lo valida.
            </p>
            <div className="space-y-2">
              {(
                [
                  ['nomcomerc', 'Nombre del comercio *'],
                  ['razon', 'Razón social'],
                  ['contacto', 'Nombre de contacto'],
                  ['telefono', 'Teléfono / WhatsApp'],
                  ['email', 'Mail'],
                  ['localidad', 'Localidad'],
                  ['zona', 'Zona'],
                  ['nota', 'Nota'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-xs text-muted">
                  {label}
                  <input
                    value={np[key]}
                    onChange={(e) => setNp({ ...np, [key]: e.target.value })}
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-3">
              <button onClick={() => setNuevoOpen(false)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button
                onClick={guardarProspecto}
                disabled={npSaving || (!np.nomcomerc.trim() && !np.razon.trim())}
                className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-40"
              >
                {npSaving ? 'Guardando...' : '+ Crear prospecto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {borrar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setBorrar(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-ink mb-1">🗑 Eliminar contacto</p>
            <p className="text-xs text-muted mb-3">
              ¿Seguro que querés eliminar <b>{borrar.nomcomerc || borrar.razon}</b> ({borrar.cod}) de la cartera? Usalo cuando
              el cliente ya no está o cerró. El historial de actividad y pedidos se conserva.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBorrar(null)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button
                onClick={eliminarContacto}
                disabled={borrando}
                className="flex-1 rounded-lg bg-red-600 text-white py-2 text-sm font-semibold disabled:opacity-50"
              >
                {borrando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {derivar && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDerivar(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-ink mb-1">↗ Derivar cliente</p>
            <p className="text-xs text-muted mb-3">
              <b>{derivar.nomcomerc || derivar.razon}</b> pasa a manos de:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DERIVAR_OPTS.filter((d) => d.codigo !== codigoActivo).map((d) => (
                <button
                  key={d.codigo}
                  onClick={() => derivarA(d.codigo)}
                  disabled={derivando}
                  className="rounded-lg border border-black/10 py-2.5 text-sm font-medium text-ink hover:border-brand/50 disabled:opacity-50"
                >
                  {d.label}
                </button>
              ))}
            </div>
            <button onClick={() => setDerivar(null)} className="w-full mt-3 rounded-lg border border-black/10 py-2 text-sm text-muted">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {notaCli && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNotaCli(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-ink mb-1">📝 Nota / recordatorio</p>
            <p className="text-xs text-muted mb-3">
              <b>{notaCli.nomcomerc || notaCli.razon}</b> ({notaCli.cod})
            </p>
            <label className="block text-xs text-muted">
              Nota — lo que hablaste o querés recordar
              <textarea
                value={notaTxt}
                onChange={(e) => setNotaTxt(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Ej: pidió que lo llame la semana que viene por la colección nueva"
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
            </label>
            <label className="block text-xs text-muted mt-2">
              📅 Recordármelo el (opcional — si ponés fecha, aparece en la Agenda ese día)
              <input
                type="date"
                value={notaFecha}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNotaFecha(e.target.value)}
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setNotaCli(null)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button
                onClick={guardarNota}
                disabled={notaSaving}
                className="flex-1 rounded-lg bg-brand text-white py-2 text-sm font-semibold disabled:opacity-50"
              >
                {notaSaving ? 'Guardando...' : notaFecha ? 'Guardar y agendar' : 'Guardar nota'}
              </button>
            </div>
          </div>
        </div>
      )}

      {avisoReserva && (() => {
        const r = reservaDe(avisoReserva.cod)
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAvisoReserva(null)}>
            <div className="bg-white rounded-2xl border border-black/10 w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-ink mb-1">⚠ Contacto ya reservado</p>
              <p className="text-xs text-muted mb-3">
                <b>{r.nombre}</b> contactó a <b>{avisoReserva.nomcomerc || avisoReserva.razon}</b>{' '}
                {r.dias === 0 ? 'hoy' : `hace ${r.dias} día${r.dias === 1 ? '' : 's'}`}. Queda reservado{' '}
                <b>{r.quedan} día{r.quedan === 1 ? '' : 's'}</b> más para no duplicar el contacto.
              </p>
              <p className="text-[11px] text-faint mb-3">
                Si igual necesitás contactarlo, podés seguir — pero avisale a {r.nombre} para no pisarse.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setAvisoReserva(null)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                  Mejor no
                </button>
                <button
                  onClick={() => {
                    const c = avisoReserva
                    setAvisoReserva(null)
                    setEnviarA(c)
                  }}
                  className="flex-1 rounded-lg bg-amber-500 text-white py-2 text-sm font-semibold"
                >
                  Contactar igual
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
