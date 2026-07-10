import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { Actividad, ObjetivoMes, Propuesta, Vendedor } from '../../lib/types'
import { monthKey } from '../../lib/dates'
import { clasificarVoz } from './voz'
import { useAuth } from '../../lib/auth'

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
}

const PROSPECCION = ['Marketing', 'ProspeccionVenta', 'Damian']
const COLORES_PERSONA = ['#7048e8', '#2a9d5c', '#e07020', '#1a7abf', '#c0392b', '#c8a96e']
const COLORES_TEMA = ['#7048e8', '#2a9d5c', '#e07020', '#1a7abf', '#c0392b', '#c8a96e', '#9797ad']

function colorAvance(pct: number) {
  return pct >= 100 ? '#10b981' : pct >= 60 ? '#7048e8' : pct >= 30 ? '#f59e0b' : '#ef4444'
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

function Pie({ data, size = 132 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const activos = data.filter((d) => d.value > 0)
  const total = activos.reduce((a, d) => a + d.value, 0)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 2
  if (total === 0)
    return (
      <div className="flex items-center justify-center text-xs text-faint" style={{ width: size, height: size }}>
        Sin datos
      </div>
    )
  if (activos.length === 1)
    return (
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill={activos[0].color} />
      </svg>
    )
  let acc = 0
  return (
    <svg width={size} height={size}>
      {activos.map((d) => {
        const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2
        acc += d.value
        const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        const x0 = cx + r * Math.cos(a0)
        const y0 = cy + r * Math.sin(a0)
        const x1 = cx + r * Math.cos(a1)
        const y1 = cy + r * Math.sin(a1)
        return (
          <path
            key={d.label}
            d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
            fill={d.color}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
          />
        )
      })}
    </svg>
  )
}

function Leyenda({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  return (
    <div className="space-y-1 min-w-0">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
          <span className="text-muted truncate">{d.label}</span>
          <span className="font-semibold text-ink ml-auto">
            {d.value} <span className="text-faint font-normal">({Math.round((d.value / total) * 100)}%)</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function AdminActividad() {
  const { rolEfectivo } = useAuth()
  const [filas, setFilas] = useState<FilaVendedor[]>([])
  const [temas, setTemas] = useState<{ label: string; count: number }[]>([])
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

      const campo = ((vend as Vendedor[]) ?? []).filter(
        (v) => v.rol === 'vendedor' && !PROSPECCION.includes(v.codigo) && v.codigo !== 'Corporativo'
      )
      for (const v of campo) {
        const actos = acts.filter((a) => a.vendedor === v.codigo)
        const obj = objetivos.find((o) => o.vendedor === v.codigo)
        const { count } = await supabase
          .from('clientes')
          .select('cod', { count: 'exact', head: true })
          .eq('vendedor_asignado', v.codigo)
          .lt('proxima_agenda_fecha', hoy)
        rows.push({
          codigo: v.codigo,
          nombre: v.nombre,
          esProspeccion: false,
          color: COLORES_PERSONA[colorIdx++ % COLORES_PERSONA.length],
          vencidos: count ?? 0,
          totalActividades: actos.length,
          ventas: actos.filter((a) => (a.unidades_vendidas ?? 0) > 0).length,
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

      const actosProsp = acts.filter((a) => a.vendedor && PROSPECCION.includes(a.vendedor))
      const objProsp = objetivos.find((o) => o.vendedor === 'Marketing')
      const { count: vencProsp } = await supabase
        .from('clientes')
        .select('cod', { count: 'exact', head: true })
        .eq('vendedor_asignado', 'Marketing')
        .lt('proxima_agenda_fecha', hoy)
      const cierres = actosProsp.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Venta directa cerrada')).length
      rows.push({
        codigo: 'Marketing',
        nombre: 'Prospección (Luna + Damián)',
        esProspeccion: true,
        color: COLORES_PERSONA[colorIdx++ % COLORES_PERSONA.length],
        vencidos: vencProsp ?? 0,
        totalActividades: actosProsp.length,
        ventas: cierres,
        metricas: [
          {
            label: 'Propuestas válidas (Bienv./Canje/Preventa)',
            real: actosProsp.filter((a) => a.propuesta_enviada_id && propValidas.has(a.propuesta_enviada_id)).length,
            objetivo: objProsp?.objetivo_propuestas ?? 300,
          },
          {
            label: 'Reuniones coordinadas',
            real: actosProsp.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Derivado a ')).length,
            objetivo: objProsp?.objetivo_contactos ?? 24,
          },
          { label: 'Cierres telefónicos (venta directa)', real: cierres, objetivo: objProsp?.objetivo_ventas ?? 18 },
        ],
      })

      setFilas(rows)

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

  const pieActividad = filas.map((f) => ({ label: f.nombre, value: f.totalActividades, color: f.color }))
  const pieVentas = filas.map((f) => ({ label: f.nombre, value: f.ventas, color: f.color }))
  const pieTemas = temas.map((t, i) => ({ label: t.label, value: t.count, color: COLORES_TEMA[i % COLORES_TEMA.length] }))

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

      {/* Avance de objetivos por persona: anillos */}
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

      {/* Reparto del mes: tortas */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">🍕 Actividades del mes — quién hizo qué</p>
          <div className="flex items-center gap-4">
            <Pie data={pieActividad} />
            <Leyenda data={pieActividad} />
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">💰 Ventas / cierres del mes</p>
          <div className="flex items-center gap-4">
            <Pie data={pieVentas} />
            <Leyenda data={pieVentas} />
          </div>
        </div>
      </div>

      {/* Voz del cliente: torta de temas */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink mb-1">🗣 Voz del cliente — temas frecuentes</p>
        <p className="text-[11px] text-faint mb-3">
          Clasificación automática de lo que dicen los clientes en cada contacto, para detectar problemas o fortalezas.
        </p>
        {pieTemas.length === 0 ? (
          <p className="text-sm text-faint">Todavía no hay suficientes notas de clientes clasificables.</p>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <Pie data={pieTemas} size={150} />
            <div className="flex-1 min-w-[220px]">
              <Leyenda data={pieTemas} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
