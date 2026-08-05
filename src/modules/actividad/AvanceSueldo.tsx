import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Actividad } from '../../lib/types'

// Panel motivacional para el prospector: muestra, en vivo y para el mes en curso,
// cómo va sumando su sueldo (comisión) a medida que carga actividades.
// Usa el mismo esquema que la liquidación de administración, pero con el básico
// del mes completo (el ajuste por medio mes se aplica en la liquidación oficial).

const MAPA: Record<string, { codigo: string; codigos: string[]; nombre: string }> = {
  Marketing: { codigo: 'Marketing', codigos: ['Marketing'], nombre: 'Luna' },
  Damian: { codigo: 'Damian', codigos: ['ProspeccionVenta', 'Damian'], nombre: 'Damián' },
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

interface ConfigCom {
  basico: number
  factor_basico: number
  tarifa_propuesta: number
  tarifa_reunion: number
  pct_cierre: number
}

interface Props {
  codigoEfectivo: string
  acts: Actividad[]
  propValidas: Set<number>
  objProp: number
  objReuniones: number
  objCierres: number
}

export default function AvanceSueldo({ codigoEfectivo, acts, propValidas, objProp, objReuniones, objCierres }: Props) {
  const info = MAPA[codigoEfectivo]
  const [cfg, setCfg] = useState<ConfigCom | null>(null)
  const [reuniones, setReuniones] = useState(0)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!info) return
    let cancel = false
    ;(async () => {
      const [{ data: c }, { count }] = await Promise.all([
        supabase.from('comisiones_config').select('*').eq('codigo', info.codigo).maybeSingle(),
        supabase
          .from('clientes')
          .select('cod', { count: 'exact', head: true })
          .in('derivado_por', info.codigos)
          .not('proxima_agenda_fecha', 'is', null),
      ])
      if (cancel) return
      setCfg((c as ConfigCom) ?? null)
      setReuniones(count ?? 0)
      setCargado(true)
    })()
    return () => {
      cancel = true
    }
  }, [codigoEfectivo])

  if (!info || !cargado) return null

  // Clientes propios con propuesta válida este mes (por cliente único)
  const mios = new Set<string>()
  const otros = new Set<string>()
  for (const a of acts) {
    if (!a.propuesta_enviada_id || !propValidas.has(a.propuesta_enviada_id) || !a.cod_cliente || !a.vendedor) continue
    if (info.codigos.includes(a.vendedor)) mios.add(a.cod_cliente)
    else otros.add(a.cod_cliente)
  }
  let compartidos = 0
  for (const c of mios) if (otros.has(c)) compartidos++
  const unidades = mios.size - compartidos + compartidos * 0.5

  const cierresRows = acts.filter(
    (a) => a.vendedor && info.codigos.includes(a.vendedor) && (a.actividad_desarrollo ?? '').toLowerCase().startsWith('venta directa cerrada')
  )
  const facturacion = cierresRows.reduce((s, a) => s + (a.monto_vendido ?? 0), 0)

  const basico = Number(cfg?.basico ?? 0)
  const tarifaProp = Number(cfg?.tarifa_propuesta ?? 0)
  const tarifaReunion = Number(cfg?.tarifa_reunion ?? 0)
  const pctCierre = Number(cfg?.pct_cierre ?? 0)
  const sinEsquema = basico === 0 && tarifaProp === 0 && tarifaReunion === 0 && pctCierre === 0

  if (sinEsquema)
    return (
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold">💰 Tu sueldo del mes</p>
        <p className="text-xs text-faint mt-1">
          Tu esquema de comisiones todavía no está cargado. En cuanto se cargue vas a ver acá cómo suma tu sueldo a medida
          que cargás actividades.
        </p>
      </div>
    )

  const mProp = unidades * tarifaProp
  const mReu = reuniones * tarifaReunion
  const mCierre = facturacion * pctCierre
  const total = basico + mProp + mReu + mCierre

  // Meta: cuánto rondaría si completa los objetivos del mes
  const meta = basico + objProp * tarifaProp + objReuniones * tarifaReunion + mCierre
  const pctMeta = meta > 0 ? Math.min(100, Math.round((total / meta) * 100)) : 0

  const lineas = [
    { label: 'Básico del mes', detalle: 'fijo', monto: basico },
    { label: 'Propuestas válidas', detalle: `${num.format(unidades)} × ${money.format(tarifaProp)}`, monto: mProp, suma: `cada propuesta suma ${money.format(tarifaProp)}` },
    { label: 'Reuniones', detalle: `${reuniones} × ${money.format(tarifaReunion)}`, monto: mReu, suma: `cada reunión suma ${money.format(tarifaReunion)}` },
    { label: 'Cierres telefónicos', detalle: `${num.format(pctCierre * 100)}% de ${money.format(facturacion)}`, monto: mCierre, suma: `${num.format(pctCierre * 100)}% de lo que factures` },
  ]

  return (
    <div className="rounded-xl p-4 border border-brand/20" style={{ background: 'linear-gradient(160deg,#FBF8F1,#F3ECDD)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-ink">💰 Cómo va tu sueldo este mes</p>
          <p className="text-[11px] text-faint">Se actualiza solo con cada actividad que cargás.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-faint uppercase tracking-wide">Acumulado</p>
          <p className="text-2xl font-bold text-brandDark leading-none">{money.format(total)}</p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {lineas.map((l) => (
          <div key={l.label} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className="text-ink">{l.label}</span>
              <span className="block text-[10px] text-faint">
                {l.detalle}
                {l.suma && total > 0 ? ` · ${l.suma}` : ''}
              </span>
            </div>
            <span className="font-semibold text-ink shrink-0">{money.format(l.monto)}</span>
          </div>
        ))}
      </div>

      {/* Camino a la meta del mes */}
      <div className="mt-3 pt-3 border-t border-black/10">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-muted">Si completás los objetivos del mes</span>
          <span className="font-semibold text-ink">≈ {money.format(meta)}</span>
        </div>
        <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pctMeta}%` }} />
        </div>
        <p className="text-[10px] text-faint mt-1">
          Vas por el {pctMeta}% de esa meta. Cada propuesta, reunión y cierre que sumes lo empuja para arriba.
        </p>
      </div>
    </div>
  )
}
