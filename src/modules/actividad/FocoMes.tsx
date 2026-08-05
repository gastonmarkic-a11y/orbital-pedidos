import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Actividad } from '../../lib/types'
import { monthKey } from '../../lib/dates'

// Cuadro de foco del mes para el prospector — sin plata.
// Muestra el foco del mes, una mejora concreta y, sobre todo, las propuestas
// enviadas el mes pasado que todavía no retomó este mes (para trabajarlas).

const MAPA: Record<string, { codigos: string[]; nombre: string }> = {
  Marketing: { codigos: ['Marketing'], nombre: 'Luna' },
  Damian: { codigos: ['ProspeccionVenta', 'Damian'], nombre: 'Damián' },
}

const CONSEJOS: Record<string, string> = {
  propuestas: 'Mantené el ritmo de envíos y priorizá las ópticas con más potencial de recompra.',
  reuniones: 'Cerrá cada propuesta con una fecha concreta de reunión: ofrecé dos horarios en el mismo mensaje.',
  cierres: 'Seguimiento a las 48 hs del envío y cerrá con un beneficio puntual (envío, plazo o combo).',
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0
}

interface Prog {
  propuestas: number
  reuniones: number
  cierres: number
}
interface Props {
  codigoEfectivo: string
  propValidas: Set<number>
  actsMesActual: Actividad[]
  prog: Prog
  objProp: number
  objReuniones: number
  objCierres: number
}

interface Pend {
  cod: string
  nombre: string
  tel: string | null
}

export default function FocoMes({ codigoEfectivo, propValidas, actsMesActual, prog, objProp, objReuniones, objCierres }: Props) {
  const info = MAPA[codigoEfectivo]
  const [pendientes, setPendientes] = useState<Pend[]>([])
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!info) return
    let cancel = false
    ;(async () => {
      const mes = monthKey()
      const [y, m] = mes.split('-').map(Number)
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      const desde = `${py}-${String(pm).padStart(2, '0')}-01`
      const hasta = `${mes}-01`
      const { data } = await supabase
        .from('actividad_diaria')
        .select('cod_cliente, nombre_comercio, telefono, propuesta_enviada_id, fecha')
        .in('vendedor', info.codigos)
        .gte('fecha', desde)
        .lt('fecha', hasta)
        .order('fecha', { ascending: false })

      const tocadosEsteMes = new Set(
        actsMesActual.filter((a) => a.vendedor && info.codigos.includes(a.vendedor) && a.cod_cliente).map((a) => a.cod_cliente)
      )
      const vistos = new Set<string>()
      const out: Pend[] = []
      for (const a of (data as any[]) ?? []) {
        if (!a.cod_cliente || !a.propuesta_enviada_id || !propValidas.has(a.propuesta_enviada_id)) continue
        if (tocadosEsteMes.has(a.cod_cliente) || vistos.has(a.cod_cliente)) continue
        vistos.add(a.cod_cliente)
        out.push({ cod: a.cod_cliente, nombre: a.nombre_comercio || a.cod_cliente, tel: a.telefono })
      }
      if (cancel) return
      setPendientes(out)
      setCargado(true)
    })()
    return () => {
      cancel = true
    }
  }, [codigoEfectivo])

  if (!info || !cargado) return null

  // Bullets de foco (sin plata): reconoce lo fuerte, marca una mejora y empuja a retomar.
  const metricas = [
    { key: 'propuestas', label: 'propuestas', log: prog.propuestas, obj: objProp },
    { key: 'reuniones', label: 'reuniones', log: prog.reuniones, obj: objReuniones },
    { key: 'cierres', label: 'cierres', log: prog.cierres, obj: objCierres },
  ].filter((m) => m.obj > 0)

  const bullets: string[] = []
  bullets.push('El foco de este mes es convertir el volumen de propuestas en reuniones y cierres. Paso a paso.')
  if (pendientes.length > 0) {
    bullets.push(
      `Tenés ${pendientes.length} propuesta${pendientes.length === 1 ? '' : 's'} del mes pasado sin retomar todavía: son las más calientes. Empezá por ahí — un llamado para coordinar reunión o cerrar.`
    )
  }
  if (metricas.length) {
    const peor = [...metricas].sort((a, b) => pct(a.log, a.obj) - pct(b.log, b.obj))[0]
    bullets.push(`A trabajar este mes: ${peor.label} (vas ${peor.log} de ${peor.obj}). ${CONSEJOS[peor.key]}`)
  }

  return (
    <div className="rounded-xl p-4 border border-brand/20" style={{ background: 'linear-gradient(160deg,#FBF8F1,#F3ECDD)' }}>
      <p className="text-sm font-semibold text-ink">🎯 Tu foco de este mes</p>
      <div className="mt-2 space-y-1.5">
        {bullets.map((b, i) => (
          <p key={i} className="text-sm text-ink flex gap-2">
            <span className="text-brand shrink-0">•</span>
            <span>{b}</span>
          </p>
        ))}
      </div>

      {pendientes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-black/10">
          <p className="text-xs font-semibold text-ink mb-1">📨 Propuestas del mes pasado para retomar ({pendientes.length})</p>
          <p className="text-[10px] text-faint mb-2">Ya recibieron una propuesta y todavía no los contactaste este mes. Retomalos para coordinar reunión o cerrar.</p>
          <div className="max-h-56 overflow-auto space-y-1">
            {pendientes.map((p) => (
              <div key={p.cod} className="flex items-center justify-between gap-2 text-sm border-l-2 border-brand/40 pl-2.5">
                <span className="truncate">
                  {p.nombre} <span className="text-faint text-[11px]">· {p.cod}</span>
                </span>
                {p.tel && <span className="text-[11px] text-brandDark whitespace-nowrap">📞 {p.tel}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
