import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { Actividad, ObjetivoMes, Propuesta, Vendedor } from '../../lib/types'
import { monthKey, habilesTranscurridos, habilesDelMes } from '../../lib/dates'
import { clasificarVoz } from './voz'
import { useAuth } from '../../lib/auth'
import Comparativa3Meses from './Comparativa3Meses'

interface Metrica {
  label: string
  real: number
  objetivo: number
}

interface FilaVendedor {
  codigo: string
  nombre: string
  esProspeccion: boolean
  color: string
  metricas: Metrica[]
  vencidos: number
  totalActividades: number
  ventas: number
  envios: number
}

interface CanalStat {
  key: 'llamada' | 'whatsapp' | 'mail'
  label: string
  icono: string
  count: number
  color: string
}

interface SeqBucket {
  label: string
  clientes: number
  conversiones: number
  tasa: number
}

const COLORES_PERSONA = ['#C8A96E', '#15151A', '#8F6A34', '#1a7abf', '#c0392b', '#6E6A61']

function colorAvance(pct: number) {
  return pct >= 100 ? '#10b981' : pct >= 60 ? '#C8A96E' : pct >= 30 ? '#f59e0b' : '#ef4444'
}

// Canal del contacto, deducido del texto de la actividad (mismo criterio que el Historial)
function canalDe(desarrollo: string | null): 'llamada' | 'whatsapp' | 'mail' | null {
  const d = (desarrollo || '').toLowerCase()
  if (d.includes('llamada')) return 'llamada'
  if (d.includes('whatsapp')) return 'whatsapp'
  if (d.includes('mail') || d.includes('correo')) return 'mail'
  return null
}

function Donut({ real, objetivo, label }: Metrica) {
  const pct = objetivo > 0 ? Math.round((real / objetivo) * 100) : 0
  const r = 33
  const c = 2 * Math.PI * r
  const avance = Math.min(100, pct)
  const color = colorAvance(pct)
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-[92px]">
      <svg width="86" height="86" viewBox="0 0 86 86" className="text-ink">
        <circle cx="43" cy="43" r={r} fill="none" stroke="rgba(128,128,150,0.18)" strokeWidth="9" />
        <circle
          cx="43"
          cy="43"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(avance / 100) * c} ${c}`}
          transform="rotate(-90 43 43)"
        />
        <text x="43" y="41" textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor">
          {objetivo > 0 ? `${pct}%` : real}
        </text>
        <text x="43" y="56" textAnchor="middle" fontSize="9.5" fill="#9797ad">
          {real} / {objetivo || '—'}
        </text>
      </svg>
      <p className="text-[10px] text-muted text-center leading-tight">{label}</p>
    </div>
  )
}

function BarrasComparativas({ data, unidad }: { data: { label: string; value: number; color: string }[]; unidad: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const total = data.reduce((a, d) => a + d.value, 0)
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate text-muted shrink-0">{d.label}</span>
          <div className="flex-1 h-3.5 bg-black/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.round((d.value / max) * 100)}%`, background: d.color }} />
          </div>
          <span className="w-20 text-right font-semibold text-ink shrink-0">
            {d.value} <span className="text-faint font-normal">({total > 0 ? Math.round((d.value / total) * 100) : 0}%)</span>
          </span>
        </div>
      ))}
      {total === 0 && <p className="text-xs text-faint">Sin {unidad} este mes todavía.</p>}
    </div>
  )
}

export default function AdminActividad() {
  const { rolEfectivo } = useAuth()
  const [filas, setFilas] = useState<FilaVendedor[]>([])
  const [temas, setTemas] = useState<{ label: string; count: number }[]>([])
  const [propStats, setPropStats] = useState<
    { nombre: string; enviadas: number; clientes: number; conversiones: number; tasa: number }[]
  >([])
  const [canales, setCanales] = useState<CanalStat[]>([])
  const [secuencia, setSecuencia] = useState<SeqBucket[]>([])
  const [promedioVenta, setPromedioVenta] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const mes = monthKey()
    const hoy = new Date().toISOString().slice(0, 10)
    async function cargar() {
      const [{ data: vend }, { data: objs }, { data: props }] = await Promise.all([
        supabase.from('vendedores').select('*').eq('activo', true),
        supabase.from('objetivos_mes').select('*').eq('mes_anio', mes),
        supabase.from('propuestas_julio').select('*'),
      ])
      const acts = await fetchPaged<Actividad>(() =>
        supabase.from('actividad_diaria').select('*').gte('fecha', `${mes}-01`).order('id')
      )
      const notas = await fetchPaged<{ voz_cliente_nota: string | null }>(() =>
        supabase.from('actividad_diaria').select('voz_cliente_nota').not('voz_cliente_nota', 'is', null).order('id')
      )
      const objetivos = (objs as ObjetivoMes[]) ?? []
      const propuestas = (props as Propuesta[]) ?? []
      const propValidas = new Set(propuestas.filter((p) => /bienvenida|canje|preventa/i.test(p.nombre)).map((p) => p.id))

      const rows: FilaVendedor[] = []
      let colorIdx = 0

      async function vencidosDe(codigo: string) {
        const { count } = await supabase
          .from('clientes')
          .select('cod', { count: 'exact', head: true })
          .eq('vendedor_asignado', codigo)
          .lt('proxima_agenda_fecha', hoy)
        return count ?? 0
      }

      // Vendedores de campo: Adrián y Martín (objetivos de julio como estaban)
      const campo = ((vend as Vendedor[]) ?? []).filter(
        (v) => v.rol === 'vendedor' && !['Marketing', 'ProspeccionVenta', 'Damian', 'Corporativo'].includes(v.codigo)
      )
      for (const v of campo) {
        const actos = acts.filter((a) => a.vendedor === v.codigo)
        const obj = objetivos.find((o) => o.vendedor === v.codigo)
        rows.push({
          codigo: v.codigo,
          nombre: v.nombre,
          esProspeccion: false,
          color: COLORES_PERSONA[colorIdx++ % COLORES_PERSONA.length],
          vencidos: await vencidosDe(v.codigo),
          totalActividades: actos.length,
          ventas: actos.filter((a) => (a.unidades_vendidas ?? 0) > 0).length,
          envios: actos.filter((a) => a.propuesta_enviada_id).length,
          metricas: [
            {
              label: 'Contactos trabajados',
              real: new Set(actos.map((a) => a.cod_cliente).filter(Boolean)).size,
              objetivo: obj?.objetivo_contactos ?? 0,
            },
            { label: 'Propuestas enviadas', real: actos.filter((a) => a.propuesta_enviada_id).length, objetivo: obj?.objetivo_propuestas ?? 0 },
            { label: 'Ventas cerradas', real: actos.filter((a) => (a.unidades_vendidas ?? 0) > 0).length, objetivo: obj?.objetivo_ventas ?? 0 },
          ],
        })
      }

      // Prospectadores: Luna (Marketing) y Damián (ProspeccionVenta + Damian) — objetivos individuales
      const prospectadores: { nombre: string; codigos: string[]; objetivoDe: string; vencidosDe: string }[] = [
        { nombre: 'Luna (Prospección)', codigos: ['Marketing'], objetivoDe: 'Marketing', vencidosDe: 'Marketing' },
        { nombre: 'Damián (Prospección)', codigos: ['ProspeccionVenta', 'Damian'], objetivoDe: 'ProspeccionVenta', vencidosDe: 'ProspeccionVenta' },
      ]
      for (const p of prospectadores) {
        const actos = acts.filter((a) => a.vendedor && p.codigos.includes(a.vendedor))
        const obj = objetivos.find((o) => o.vendedor === p.objetivoDe)
        const cierres = actos.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Venta directa cerrada')).length
        rows.push({
          codigo: p.objetivoDe,
          nombre: p.nombre,
          esProspeccion: true,
          color: COLORES_PERSONA[colorIdx++ % COLORES_PERSONA.length],
          vencidos: await vencidosDe(p.vencidosDe),
          totalActividades: actos.length,
          ventas: cierres,
          envios: actos.filter((a) => a.propuesta_enviada_id).length,
          metricas: [
            {
              label: 'Propuestas válidas (Bienv./Canje/Preventa)',
              real: actos.filter((a) => a.propuesta_enviada_id && propValidas.has(a.propuesta_enviada_id)).length,
              objetivo: obj?.objetivo_propuestas ?? 300,
            },
            {
              label: 'Reuniones coordinadas',
              real: actos.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Derivado a ')).length,
              objetivo: obj?.objetivo_contactos ?? 24,
            },
            { label: 'Cierres telefónicos (venta directa)', real: cierres, objetivo: obj?.objetivo_ventas ?? 18 },
          ],
        })
      }

      // Apertura por propuesta: enviadas, clientes únicos y conversiones a venta
      const ventasPorCliente: Record<string, string[]> = {}
      for (const a of acts) {
        if (a.cod_cliente && (a.unidades_vendidas ?? 0) > 0) {
          ;(ventasPorCliente[a.cod_cliente] = ventasPorCliente[a.cod_cliente] || []).push(a.fecha)
        }
      }
      const stats = propuestas
        .map((prop) => {
          const envios = acts.filter((a) => a.propuesta_enviada_id === prop.id)
          const clientesUnicos = new Set(envios.map((a) => a.cod_cliente).filter(Boolean))
          let conversiones = 0
          for (const cod of clientesUnicos) {
            const fechaEnvio = envios.filter((e) => e.cod_cliente === cod).map((e) => e.fecha).sort()[0]
            if ((ventasPorCliente[cod as string] ?? []).some((f) => f >= fechaEnvio)) conversiones++
          }
          return {
            nombre: prop.nombre,
            enviadas: envios.length,
            clientes: clientesUnicos.size,
            conversiones,
            tasa: clientesUnicos.size > 0 ? Math.round((conversiones / clientesUnicos.size) * 100) : 0,
          }
        })
        .filter((x) => x.enviadas > 0)
        .sort((a, b) => b.tasa - a.tasa || b.enviadas - a.enviadas)
      setPropStats(stats)

      setFilas(rows)

      // Envíos del mes por canal (parseado del texto de la actividad)
      const cuentaCanal: Record<string, number> = { llamada: 0, whatsapp: 0, mail: 0 }
      for (const a of acts) {
        if (!a.propuesta_enviada_id) continue
        const c = canalDe(a.actividad_desarrollo)
        if (c) cuentaCanal[c]++
      }
      setCanales([
        { key: 'llamada', label: 'Llamadas', icono: '📞', count: cuentaCanal.llamada, color: '#f59e0b' },
        { key: 'whatsapp', label: 'WhatsApp', icono: '💬', count: cuentaCanal.whatsapp, color: '#10b981' },
        { key: 'mail', label: 'Mail', icono: '✉️', count: cuentaCanal.mail, color: '#1a7abf' },
      ])

      // Secuencia de multicontactos: toques por cliente (histórico) y su conversión
      const seq = await fetchPaged<{ cod_cliente: string | null; unidades_vendidas: number | null }>(() =>
        supabase
          .from('actividad_diaria')
          .select('cod_cliente, unidades_vendidas')
          .not('cod_cliente', 'is', null)
          .order('id')
      )
      const toques: Record<string, number> = {}
      const compro: Record<string, boolean> = {}
      for (const a of seq) {
        const k = a.cod_cliente as string
        toques[k] = (toques[k] ?? 0) + 1
        if ((a.unidades_vendidas ?? 0) > 0) compro[k] = true
      }
      const bucketsDef: { label: string; test: (n: number) => boolean }[] = [
        { label: '1 contacto', test: (n) => n === 1 },
        { label: '2 contactos', test: (n) => n === 2 },
        { label: '3 contactos', test: (n) => n === 3 },
        { label: '4+ contactos', test: (n) => n >= 4 },
      ]
      const buckets: SeqBucket[] = bucketsDef.map((b) => {
        const cods = Object.keys(toques).filter((k) => b.test(toques[k]))
        const conversiones = cods.filter((k) => compro[k]).length
        return {
          label: b.label,
          clientes: cods.length,
          conversiones,
          tasa: cods.length > 0 ? Math.round((conversiones / cods.length) * 100) : 0,
        }
      })
      setSecuencia(buckets)
      const codsCompraron = Object.keys(compro)
      const promedio =
        codsCompraron.length > 0
          ? codsCompraron.reduce((a, k) => a + (toques[k] ?? 0), 0) / codsCompraron.length
          : 0
      setPromedioVenta(Math.round(promedio * 10) / 10)

      const porTema: Record<string, number> = {}
      for (const n of notas) {
        const t = clasificarVoz(n.voz_cliente_nota)
        if (t) porTema[t.label] = (porTema[t.label] ?? 0) + 1
      }
      setTemas(
        Object.entries(porTema)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count)
      )
      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando tablero del equipo...</p>

  const barActividad = filas.map((f) => ({ label: f.nombre, value: f.totalActividades, color: f.color }))
  const barVentas = filas.map((f) => ({ label: f.nombre, value: f.ventas, color: f.color }))
  const barEnvios = filas.map((f) => ({ label: f.nombre, value: f.envios, color: f.color }))
  const maxTema = Math.max(...temas.map((t) => t.count), 1)
  const totalEnvios = canales.reduce((a, c) => a + c.count, 0)
  const maxCanal = Math.max(...canales.map((c) => c.count), 1)
  const maxSeqCli = Math.max(...secuencia.map((s) => s.clientes), 1)

  // Reseña automática del mes
  const habilesT = habilesTranscurridos()
  const habilesM = habilesDelMes()
  const pctMes = Math.round((habilesT / Math.max(habilesM, 1)) * 100)
  const reseña: string[] = [`Va el día hábil ${habilesT} de ${habilesM} (${pctMes}% del mes).`]
  const masActivo = [...filas].sort((a, b) => b.totalActividades - a.totalActividades)[0]
  if (masActivo && masActivo.totalActividades > 0)
    reseña.push(`${masActivo.nombre} lidera en actividad con ${masActivo.totalActividades} registros.`)
  const masVentas = [...filas].sort((a, b) => b.ventas - a.ventas)[0]
  if (masVentas && masVentas.ventas > 0) reseña.push(`${masVentas.nombre} encabeza las ventas/cierres con ${masVentas.ventas}.`)
  if (totalEnvios > 0) {
    const canalTop = [...canales].sort((a, b) => b.count - a.count)[0]
    reseña.push(`${totalEnvios} envíos este mes; el canal más usado es ${canalTop.icono} ${canalTop.label.toLowerCase()}.`)
  }
  if (promedioVenta > 0) reseña.push(`Hacen falta ~${promedioVenta} contactos en promedio para cerrar una venta.`)
  for (const f of filas) {
    const atrasadas = f.metricas.filter((m) => m.objetivo > 0 && Math.round((m.real / m.objetivo) * 100) < pctMes - 20)
    if (atrasadas.length)
      reseña.push(`⚠ ${f.nombre} viene atrasado en: ${atrasadas.map((m) => m.label.toLowerCase()).join(', ')}.`)
  }
  const conVencidos = filas.filter((f) => f.vencidos > 0)
  if (conVencidos.length)
    reseña.push(`Agendas vencidas: ${conVencidos.map((f) => `${f.nombre} (${f.vencidos})`).join(', ')}.`)

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">📊 Equipo · {monthKey()}</h2>
        {rolEfectivo === 'admin' && (
          <Link to="/actividad-admin/marketing" className="text-xs font-medium text-brandDark">
            Gestionar piezas de marketing →
          </Link>
        )}
      </div>

      {/* Reseña del mes */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">📝 Lectura rápida del mes</p>
        {reseña.map((r, i) => (
          <p key={i} className="text-sm text-ink flex gap-2 py-0.5">
            <span className="text-brand">•</span>
            <span>{r}</span>
          </p>
        ))}
      </div>

      {/* Comparación de los últimos 3 meses */}
      <Comparativa3Meses />

      {/* Avance de objetivos por persona */}
      {filas.map((f) => (
        <div key={f.codigo} className="bg-white rounded-xl p-4 border border-black/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.color }} />
              {f.esProspeccion ? '📞' : '🧳'} {f.nombre}
            </p>
            {f.vencidos > 0 && (
              <span className="text-[10px] bg-red-50 text-red-700 rounded-full px-2 py-0.5">{f.vencidos} agendas vencidas</span>
            )}
          </div>
          <div className="flex flex-wrap justify-around gap-2">
            {f.metricas.map((m) => (
              <Donut key={m.label} {...m} />
            ))}
          </div>
        </div>
      ))}

      {/* Comparativas en barras */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Actividades registradas este mes</p>
          <BarrasComparativas data={barActividad} unidad="actividades" />
        </div>
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Envíos de propuestas este mes</p>
          <BarrasComparativas data={barEnvios} unidad="envíos" />
        </div>
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Ventas y cierres este mes</p>
          <BarrasComparativas data={barVentas} unidad="ventas" />
        </div>
      </div>

      {/* Multicontacto: envíos por canal + secuencia de contactos */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink mb-1">🔗 Motor de multicontacto</p>
        <p className="text-[11px] text-faint mb-3">
          Por dónde salen los contactos y cuántos toques hacen falta para que un cliente compre.
        </p>

        {/* Envíos por canal este mes */}
        <p className="text-[10px] uppercase text-faint font-semibold mb-2">
          Envíos del equipo este mes por canal · {totalEnvios} en total
        </p>
        {totalEnvios === 0 ? (
          <p className="text-sm text-faint mb-4">Todavía no se registraron envíos este mes.</p>
        ) : (
          <div className="space-y-2 mb-5">
            {canales.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-muted shrink-0">
                  {c.icono} {c.label}
                </span>
                <div className="flex-1 h-3.5 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round((c.count / maxCanal) * 100)}%`, background: c.color }} />
                </div>
                <span className="w-20 text-right font-semibold text-ink shrink-0">
                  {c.count}{' '}
                  <span className="text-faint font-normal">({totalEnvios > 0 ? Math.round((c.count / totalEnvios) * 100) : 0}%)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Secuencia: conversión según cantidad de toques */}
        <p className="text-[10px] uppercase text-faint font-semibold mb-2">
          Secuencia de contactos — cuántos toques hacen falta para vender
        </p>
        {secuencia.every((s) => s.clientes === 0) ? (
          <p className="text-sm text-faint">Todavía no hay historial de contactos suficiente.</p>
        ) : (
          <div className="space-y-2.5">
            {secuencia.map((s) => (
              <div key={s.label}>
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span className="font-medium text-ink">{s.label}</span>
                  <span className="text-muted shrink-0">
                    {s.clientes} clientes ·{' '}
                    <b className={s.tasa >= 30 ? 'text-emerald-600' : s.tasa > 0 ? 'text-amber-600' : 'text-faint'}>
                      {s.conversiones} compraron ({s.tasa}%)
                    </b>
                  </span>
                </div>
                <div className="h-3 bg-black/5 rounded-full overflow-hidden flex" title={`${s.clientes} clientes con ${s.label}`}>
                  <div className="h-full bg-emerald-500" style={{ width: `${(s.conversiones / maxSeqCli) * 100}%` }} />
                  <div className="h-full bg-brand/30" style={{ width: `${((s.clientes - s.conversiones) / maxSeqCli) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-sm text-ink bg-[#F7F5F0] rounded-lg p-3 mt-1">
              📈 En promedio, un cliente que terminó comprando recibió{' '}
              <b className="text-brandDark">{promedioVenta} contactos</b>. La constancia en la secuencia es la que convierte
              — no aflojar después del primer intento.
            </p>
            <p className="text-[10px] text-faint">
              ■ verde: clientes que compraron · ■ violeta: contactados en esa cantidad, sin compra aún
            </p>
          </div>
        )}
      </div>

      {/* Apertura por propuesta comercial */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink mb-1">📨 Propuestas comerciales — cuál funciona mejor</p>
        <p className="text-[11px] text-faint mb-3">
          Envíos del mes, clientes alcanzados y cuántos terminaron comprando después de recibirla.
        </p>
        {propStats.length === 0 ? (
          <p className="text-sm text-faint">Todavía no se enviaron propuestas este mes.</p>
        ) : (
          <div className="space-y-3">
            {propStats.map((p) => (
              <div key={p.nombre}>
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span className="font-medium text-ink truncate">{p.nombre}</span>
                  <span className="text-muted shrink-0">
                    {p.enviadas} envíos · {p.clientes} clientes ·{' '}
                    <b className={p.tasa >= 20 ? 'text-emerald-600' : p.tasa > 0 ? 'text-amber-600' : 'text-faint'}>
                      {p.conversiones} ventas ({p.tasa}%)
                    </b>
                  </span>
                </div>
                <div className="h-3 bg-black/5 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${p.clientes > 0 ? (p.conversiones / p.clientes) * 100 : 0}%` }}
                    title="Convirtieron en venta"
                  />
                  <div
                    className="h-full bg-brand/40"
                    style={{ width: `${p.clientes > 0 ? ((p.clientes - p.conversiones) / p.clientes) * 100 : 0}%` }}
                    title="Recibieron la propuesta, sin venta aún"
                  />
                </div>
              </div>
            ))}
            <p className="text-[10px] text-faint">
              ■ verde: clientes que compraron después de recibirla · ■ violeta: la recibieron y todavía no compraron
            </p>
          </div>
        )}
      </div>

      {/* Voz del cliente en barras */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink mb-1">🗣 Voz del cliente — temas frecuentes</p>
        <p className="text-[11px] text-faint mb-3">Lo que dicen los clientes en cada contacto, clasificado automáticamente.</p>
        {temas.length === 0 ? (
          <p className="text-sm text-faint">Todavía no hay suficientes notas de clientes clasificables.</p>
        ) : (
          <div className="space-y-2">
            {temas.map((t) => (
              <div key={t.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink font-medium">{t.label}</span>
                  <span className="text-faint">{t.count}</span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full bg-brand rounded-full" style={{ width: `${(t.count / maxTema) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
