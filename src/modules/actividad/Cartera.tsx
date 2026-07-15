import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, Propuesta } from '../../lib/types'
import { daysSince, firstOfMonth } from '../../lib/dates'
import HistorialModal from './HistorialModal'
import TelefonoAcciones from '../../lib/TelefonoAcciones'

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

const TABS_VENDEDOR = [
  { codigo: 'Adrian', label: 'Adrián' },
  { codigo: 'Martin', label: 'Martín' },
  { codigo: 'Marketing', label: 'Prospección' },
  { codigo: 'ProspeccionVenta', label: 'Prosp. venta directa' },
  { codigo: 'Corporativo', label: 'Corporativo' },
]

type Segmento = 'canje' | 'recuperar' | 'bienvenida' | 'fidelizacion'
type ColOrden = 'comercio' | 'contacto' | 'mail' | 'zona' | 'u2025' | 'canje' | 'ultima_compra' | 'clasificacion' | 'actividad'

export default function Cartera() {
  const { vendedor, rolEfectivo, codigoEfectivo } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const esAdmin = rolEfectivo === 'admin'
  const [tabVendedor, setTabVendedor] = useState('Adrian')
  const codigoActivo = esAdmin ? tabVendedor : codigoEfectivo
  const esProspeccion = codigoActivo === 'Marketing' || codigoActivo === 'ProspeccionVenta'
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [ultimaAct, setUltimaAct] = useState<Record<string, string>>({})
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
  const [dm, setDm] = useState({ nombre: '', contacto: '', telefono: '', email: '', direccion: '', horario: '' })
  const [dmSaving, setDmSaving] = useState(false)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [np, setNp] = useState({ nomcomerc: '', razon: '', contacto: '', telefono: '', email: '', localidad: '', zona: '', nota: '' })
  const [npSaving, setNpSaving] = useState(false)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    supabase.from('propuestas_julio').select('*').then(({ data }) => setPropuestas((data as Propuesta[]) ?? []))
  }, [])

  useEffect(() => {
    if (!vendedor || !codigoActivo) return
    setLoading(true)
    async function cargar() {
      const rows = await fetchPaged<Cliente>(() => {
        let q = supabase.from('clientes').select('*').not('origen', 'is', null).order('cod')
        // Prospección compartida: Luna (Marketing) y Damián (ProspeccionVenta) ven la misma cartera
        q =
          codigoActivo === 'Marketing' || codigoActivo === 'ProspeccionVenta'
            ? q.or('vendedor_asignado.eq.Marketing,vendedor_asignado.eq.ProspeccionVenta,vendedor_asignado.is.null')
            : q.eq('vendedor_asignado', codigoActivo)
        return q
      })
      setClientes(rows)
      const codsSet = new Set(rows.map((c) => c.cod))
      const acts = await fetchPaged<{ cod_cliente: string | null; fecha: string; propuesta_enviada_id: number | null }>(
        () =>
          supabase
            .from('actividad_diaria')
            .select('cod_cliente, fecha, propuesta_enviada_id')
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
      )
      const ult: Record<string, string> = {}
      const prop: Record<string, string> = {}
      const inicioMes = firstOfMonth()
      for (const a of acts) {
        if (!a.cod_cliente || !codsSet.has(a.cod_cliente)) continue
        if (!ult[a.cod_cliente]) ult[a.cod_cliente] = a.fecha
        if (a.propuesta_enviada_id && a.fecha >= inicioMes && !prop[a.cod_cliente])
          prop[a.cod_cliente] = String(a.propuesta_enviada_id)
      }
      setUltimaAct(ult)
      setPropuestaMes(prop)
      setLoading(false)
    }
    cargar()
  }, [vendedor, codigoActivo, recarga])

  // En prospección no existen los segmentos Canje ni Fidelizados como opción normal → arrancar en "A recuperar"
  useEffect(() => {
    if (esProspeccion && (segmento === 'canje' || segmento === 'fidelizacion')) setSegmento('recuperar')
  }, [esProspeccion])

  const esFidelizado = (c: Cliente) => c.clasificacion_recupero === 'fidelizacion'
  const conVentas = useMemo(
    () => clientes.filter((c) => ((c.unidades_2025 ?? 0) > 0 || c.clasificacion_recupero === 'activo') && !esFidelizado(c)),
    [clientes]
  )
  const aRecuperar = useMemo(
    () => clientes.filter((c) => c.clasificacion_recupero && ['2024', '2022_2023', '2021_o_antes'].includes(c.clasificacion_recupero)),
    [clientes]
  )
  const bienvenida = useMemo(() => clientes.filter((c) => c.clasificacion_recupero === 'sin_historial'), [clientes])
  const fidelizados = useMemo(() => clientes.filter(esFidelizado), [clientes])
  const canjeTotal = useMemo(() => conVentas.reduce((a, c) => a + Math.floor((c.unidades_2025 ?? 0) * 0.2), 0), [conVentas])

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
  }, [segmentoRows, clientes, busqueda, zonaFiltro, corpFiltro, codigoActivo, orden, ultimaAct])

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
      telefono: c.whatsapp ?? c.telefono ?? '',
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
      whatsapp: dm.telefono.trim() || null,
      telefono: dm.telefono.trim() || editDatos.telefono,
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

  function cargar(c: Cliente) {
    navigate('/cargar', { state: { cliente: c } })
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

      <div className={`grid grid-cols-2 ${esProspeccion ? 'md:grid-cols-3' : 'md:grid-cols-5'} gap-2`}>
        {(esProspeccion
          ? [
              { label: 'Con ventas 2025', val: conVentas.length, color: 'bg-emerald-500' },
              { label: 'A recuperar', val: aRecuperar.length, color: 'bg-orange-500' },
              { label: 'Bienvenida', val: bienvenida.length, color: 'bg-red-500' },
            ]
          : [
              { label: 'Con ventas 2025', val: conVentas.length, color: 'bg-emerald-500' },
              { label: 'Canje propuesto', val: canjeTotal, color: 'bg-amber-500' },
              { label: 'A recuperar', val: aRecuperar.length, color: 'bg-orange-500' },
              { label: 'Bienvenida', val: bienvenida.length, color: 'bg-red-500' },
              { label: '⭐ Fidelizados', val: fidelizados.length, color: 'bg-violet-500' },
            ]
        ).map((k) => (
          <div key={k.label} className="bg-white border border-black/10 rounded-xl p-3 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.color}`} />
            <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold">{k.val}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setRecarga((r) => r + 1)}
          className="text-xs font-medium px-3 py-1.5 rounded-full border border-black/10 text-muted"
        >
          ⟳ Actualizar
        </button>
        {(esProspeccion
          ? ([
              ['recuperar', `📋 A recuperar (${aRecuperar.length})`],
              ['bienvenida', `🔍 Bienvenida (${bienvenida.length})`],
              ['fidelizacion', `⭐ Prospección directa (${fidelizados.length})`],
            ] as [Segmento, string][])
          : ([
              ['canje', `↩ Con canje (${conVentas.length})`],
              ['recuperar', `📋 A recuperar (${aRecuperar.length})`],
              ['bienvenida', `🔍 Bienvenida (${bienvenida.length})`],
              ['fidelizacion', `⭐ Fidelizados (${fidelizados.length})`],
            ] as [Segmento, string][])
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSegmento(key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
              segmento === key && !buscando ? 'bg-brand border-brand text-white' : 'border-black/10 text-muted'
            }`}
          >
            {label}
          </button>
        ))}
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

      {/* Vista celular: tarjetas con todos los datos, sin scroll lateral */}
      <div className="md:hidden space-y-2">
        {filas.map(({ c }) => {
          const dias = daysSince(ultimaAct[c.cod] ?? null)
          const canje = Math.floor((c.unidades_2025 ?? 0) * 0.2)
          return (
            <div key={c.cod} className="bg-white border border-black/10 rounded-xl p-3 space-y-1.5">
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
              </div>
              {c.nota && <p className="text-[11px] text-muted">📝 {c.nota}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => cargar(c)} className="flex-1 rounded-lg bg-brand text-white py-1.5 text-xs font-medium">
                  Cargar actividad
                </button>
                <button
                  onClick={() => navigate('/pedidos/nuevo', { state: { cliente: c } })}
                  className="flex-1 rounded-lg bg-emerald-600 text-white py-1.5 text-xs font-medium"
                >
                  🛒 Pedido
                </button>
                <button onClick={() => setHistorial(c)} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-muted">
                  Historial
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
              <Th>WhatsApp</Th>
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
              return (
                <tr key={c.cod} className="border-t border-black/10 hover:bg-[#F1EDE4]">
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
                      <TelefonoAcciones whatsapp={c.whatsapp} telefono={c.telefono} />
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
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <button onClick={() => cargar(c)} className="text-[11px] text-brandDark font-medium whitespace-nowrap">
                        Cargar →
                      </button>
                      <button
                        onClick={() => navigate('/pedidos/nuevo', { state: { cliente: c } })}
                        className="text-[11px] text-emerald-600 font-medium whitespace-nowrap"
                      >
                        🛒 Pedido →
                      </button>
                      <button onClick={() => setHistorial(c)} className="text-[11px] text-muted font-medium whitespace-nowrap">
                        Historial
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
                  ['telefono', 'Teléfono / WhatsApp'],
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
    </div>
  )
}
