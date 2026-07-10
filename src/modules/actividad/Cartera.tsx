import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { Cliente, Propuesta } from '../../lib/types'
import { daysSince, firstOfMonth } from '../../lib/dates'
import HistorialModal from './HistorialModal'

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

export default function Cartera() {
  const { vendedor, rolEfectivo } = useAuth()
  const navigate = useNavigate()
  const esAdmin = rolEfectivo === 'admin'
  const [tabVendedor, setTabVendedor] = useState('Adrian')
  const codigoActivo = esAdmin ? tabVendedor : vendedor?.codigo ?? ''
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [ultimaAct, setUltimaAct] = useState<Record<string, string>>({})
  const [propuestaMes, setPropuestaMes] = useState<Record<string, string>>({})
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [loading, setLoading] = useState(true)
  const [segmento, setSegmento] = useState<Segmento>('canje')
  const [busqueda, setBusqueda] = useState('')
  const [historial, setHistorial] = useState<Cliente | null>(null)

  useEffect(() => {
    supabase.from('propuestas_julio').select('*').then(({ data }) => setPropuestas((data as Propuesta[]) ?? []))
  }, [])

  useEffect(() => {
    if (!vendedor || !codigoActivo) return
    setLoading(true)
    async function cargar() {
      // Carga paginada: trae TODA la cartera aunque supere las 1000 filas
      const rows = await fetchPaged<Cliente>(() => {
        let q = supabase.from('clientes').select('*').not('origen', 'is', null).order('cod')
        q =
          codigoActivo === 'Marketing'
            ? q.or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
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
  }, [vendedor, codigoActivo])

  const conVentas = useMemo(
    () => clientes.filter((c) => (c.unidades_2025 ?? 0) > 0 && c.clasificacion_recupero !== 'fidelizacion'),
    [clientes]
  )
  const fidelizados = useMemo(() => clientes.filter((c) => c.clasificacion_recupero === 'fidelizacion'), [clientes])
  const aRecuperar = useMemo(
    () => clientes.filter((c) => c.clasificacion_recupero && ['2024', '2022_2023', '2021_o_antes'].includes(c.clasificacion_recupero)),
    [clientes]
  )
  const bienvenida = useMemo(() => clientes.filter((c) => c.clasificacion_recupero === 'sin_historial'), [clientes])
  const canjeTotal = useMemo(
    () => conVentas.reduce((a, c) => a + Math.floor((c.unidades_2025 ?? 0) * 0.2), 0),
    [conVentas]
  )

  const segmentoRows =
    segmento === 'canje' ? conVentas : segmento === 'recuperar' ? aRecuperar : segmento === 'fidelizacion' ? fidelizados : bienvenida

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtradas = q
      ? segmentoRows.filter(
          (c) =>
            (c.nomcomerc || c.razon || '').toLowerCase().includes(q) ||
            (c.zona || '').toLowerCase().includes(q) ||
            (c.localidad || '').toLowerCase().includes(q) ||
            (c.nota || '').toLowerCase().includes(q)
        )
      : segmentoRows
    const maxCanje = Math.max(...filtradas.map((c) => Math.floor((c.unidades_2025 ?? 0) * 0.2)), 1)
    return [...filtradas]
      .sort((a, b) => (daysSince(ultimaAct[b.cod] ?? null) ?? 9999) - (daysSince(ultimaAct[a.cod] ?? null) ?? 9999))
      .map((c) => ({ c, maxCanje }))
  }, [segmentoRows, busqueda, ultimaAct])

  function cargar(c: Cliente) {
    navigate('/cargar', { state: { cliente: c } })
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando cartera...</p>

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { label: 'Con ventas 2025', val: conVentas.length, color: 'bg-emerald-500' },
          { label: 'Canje propuesto', val: canjeTotal, color: 'bg-amber-500' },
          { label: 'A recuperar', val: aRecuperar.length, color: 'bg-orange-500' },
          { label: 'Bienvenida', val: bienvenida.length, color: 'bg-red-500' },
          { label: '⭐ Fidelizados', val: fidelizados.length, color: 'bg-violet-500' },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-black/10 rounded-xl p-3 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.color}`} />
            <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-bold">{k.val}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            ['canje', `↩ Con canje (${conVentas.length})`],
            ['recuperar', `📋 A recuperar (${aRecuperar.length})`],
            ['bienvenida', `🔍 Bienvenida (${bienvenida.length})`],
            ['fidelizacion', `⭐ Fidelizados (${fidelizados.length})`],
          ] as [Segmento, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSegmento(key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
              segmento === key ? 'bg-brand border-brand text-white' : 'border-black/10 text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        placeholder="Buscar por nombre, zona, localidad, nota..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-brand"
      />

      <div className="overflow-x-auto rounded-xl border border-black/10">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-[#f7f7fa]">
            <tr>
              <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Prio</th>
              <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Comercio</th>
              <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Zona / Localidad</th>
              <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">WhatsApp</th>
              {segmento === 'canje' && (
                <>
                  <th className="text-right text-[10px] uppercase text-muted font-semibold px-2.5 py-2">U. 2025</th>
                  <th className="text-right text-[10px] uppercase text-amber-600 font-semibold px-2.5 py-2">↩ Canje</th>
                </>
              )}
              {segmento === 'recuperar' && (
                <>
                  <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Última compra</th>
                  <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Clasificación</th>
                </>
              )}
              <th className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">Última actividad</th>
              <th className="px-2.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {filas.map(({ c, maxCanje }) => {
              const dias = daysSince(ultimaAct[c.cod] ?? null)
              const canje = Math.floor((c.unidades_2025 ?? 0) * 0.2)
              const canjePct = Math.round((canje / maxCanje) * 100)
              return (
                <tr key={c.cod} className="border-t border-black/10 hover:bg-[#f7f7fa]">
                  <td className="px-2.5 py-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${c.prioridad ? PRIO_COLORS[c.prioridad] ?? 'bg-[#c8c8d4]' : 'bg-[#c8c8d4]'}`}
                    />
                  </td>
                  <td className="px-2.5 py-2 max-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-ink truncate">{c.nomcomerc || c.razon}</p>
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
                  <td className="px-2.5 py-2 text-muted text-xs">
                    {c.zona}
                    <br />
                    <span className="text-[10px] text-faint">{c.localidad}</span>
                  </td>
                  <td className="px-2.5 py-2">
                    {c.whatsapp ? (
                      <a
                        href={`https://wa.me/${(c.whatsapp || '').replace(/\D/g, '').replace(/^(?!54)/, '54')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#2f6fdb] text-xs font-mono"
                      >
                        {c.whatsapp}
                      </a>
                    ) : (
                      <span className="text-faint text-xs">—</span>
                    )}
                  </td>
                  {segmento === 'canje' && (
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
                  {segmento === 'recuperar' && (
                    <>
                      <td className="px-2.5 py-2 text-xs text-muted">
                        {c.ultima_compra_fecha ?? '—'}
                        {c.ultima_compra_monto ? (
                          <div className="text-[10px] text-faint">${Math.round(c.ultima_compra_monto).toLocaleString()}</div>
                        ) : null}
                      </td>
                      <td className="px-2.5 py-2 text-xs text-orange-600">
                        {c.clasificacion_recupero === '2024'
                          ? '2024'
                          : c.clasificacion_recupero === '2022_2023'
                            ? '2022-23'
                            : '2021 o antes'}
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
                <td colSpan={8} className="text-center text-sm text-faint py-8">
                  No hay contactos en este segmento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {historial && <HistorialModal cliente={historial} propuestas={propuestas} onClose={() => setHistorial(null)} />}
    </div>
  )
}
