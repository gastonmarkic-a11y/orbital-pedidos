import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Panel ADMIN de la agenda de campo: ve a Martín y Adrián juntos, el doble trabajo de
// prospección (turnos para vendedores + base de julio a cerrar), y los resultados del
// día + acumulados, incluyendo los que quedaron sin visitar.

interface Row { dia_num: number; bloque: string; cohorte: string; localidad: string | null; cod: string; nombre: string | null; visitado: boolean; resultado: string | null }
interface Turno { vendedor: string; dia_num: number; cargado_por: string | null }
interface Act { vendedor: string; cod_cliente: string; resultado_contacto: string | null; monto_vendido: number | null; unidades_vendidas: number | null }

const VEND = [{ cod: 'Adrian', label: 'Adrián', prosp: 'Luna', prospCod: 'Marketing' }, { cod: 'Martin', label: 'Martín', prosp: 'Damián', prospCod: 'Damian' }]
const RES = { vendio: '🟢 Vendió', visito: '🔵 Visité', no_estaba: '🟠 No estaba', reagendar: '🟣 Reagendar' } as const
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

export default function AgendaEquipo() {
  const [planes, setPlanes] = useState<Record<string, Row[]>>({})
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [actHoy, setActHoy] = useState<Act[]>([])
  const [julio, setJulio] = useState<{ prospector: string; cerrado: boolean }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      const hoy = new Date().toISOString().slice(0, 10)
      const [a, m, t, ah] = await Promise.all([
        supabase.rpc('agenda_campo_plan', { p_vendedor: 'Adrian' }),
        supabase.rpc('agenda_campo_plan', { p_vendedor: 'Martin' }),
        supabase.from('agenda_turnos').select('vendedor,dia_num,cargado_por'),
        supabase.from('actividad_diaria').select('vendedor,cod_cliente,resultado_contacto,monto_vendido,unidades_vendidas').eq('origen', 'agenda_campo').eq('fecha', hoy),
      ])
      const pj = await supabase.from('prospectos_julio').select('prospector,cerrado')
      setPlanes({ Adrian: (a.data as Row[]) ?? [], Martin: (m.data as Row[]) ?? [] })
      setTurnos((t.data as Turno[]) ?? [])
      setActHoy((ah.data as Act[]) ?? [])
      setJulio((pj.data as { prospector: string; cerrado: boolean }[]) ?? [])
      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando equipo…</p>

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h1 className="text-lg font-bold">Agenda de equipo</h1>
        <p className="text-xs text-muted">Recorrido de campo + prospección · resultados del día y acumulados</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {VEND.map((v) => {
          const rows = (planes[v.cod] ?? [])
          const baGba = rows.filter((r) => r.bloque === 'ba_gba')
          const total = baGba.length
          const visit = baGba.filter((r) => r.visitado).length
          const dias = Array.from(new Set(baGba.map((r) => r.dia_num))).sort((a, b) => a - b)
          const hoyDia = dias.find((d) => baGba.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1
          const delDia = baGba.filter((r) => r.dia_num === hoyDia)
          const sinVisitar = delDia.filter((r) => !r.visitado)
          // resultados acumulados (por resultado guardado en agenda_campo)
          const acum = contarResultados(baGba)
          // resultados de HOY (actividad_diaria de hoy)
          const actV = actHoy.filter((a) => a.vendedor === v.cod)
          const vendioHoy = actV.filter((a) => a.resultado_contacto === 'vendio')
          const montoHoy = vendioHoy.reduce((s, a) => s + (a.monto_vendido ?? 0), 0)
          const turnosV = turnos.filter((t) => t.vendedor === v.cod)
          const interiorN = rows.filter((r) => r.bloque === 'interior').length

          return (
            <div key={v.cod} className="bg-white rounded-2xl border border-black/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">{v.label}</h2>
                <span className="text-[11px] text-faint">{dias.length} días · prospecta {v.prosp}</span>
              </div>
              {/* progreso total */}
              <div>
                <div className="flex justify-between text-[11px] text-muted mb-1"><span>Avance del recorrido</span><span>{visit}/{total}</span></div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-brand" style={{ width: `${total ? (visit / total) * 100 : 0}%` }} /></div>
              </div>
              {/* resultados HOY */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-lg font-bold">{actV.length}</p><p className="text-[10px] text-muted">visitas hoy</p></div>
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-lg font-bold text-emerald-700">{vendioHoy.length}</p><p className="text-[10px] text-muted">ventas hoy</p></div>
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-sm font-bold text-emerald-700 truncate">{kAr(montoHoy)}</p><p className="text-[10px] text-muted">$ hoy</p></div>
              </div>
              {/* acumulado por resultado */}
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(RES) as (keyof typeof RES)[]).map((k) => (
                  <span key={k} className="text-[10px] rounded-full px-2 py-0.5 bg-black/5 text-muted">{RES[k]}: <b>{acum[k] ?? 0}</b></span>
                ))}
              </div>
              {/* prospección doble trabajo */}
              <div className="border-t border-black/5 pt-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Prospección ({v.prosp})</p>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="bg-[#F6F4EF] rounded-lg p-2"><p className="font-bold">{turnosV.length}</p><p className="text-[10px] text-muted">turnos para {v.label}</p></div>
                  <div className="bg-[#F6F4EF] rounded-lg p-2"><p className="font-bold">{julio.filter((j) => j.prospector === v.prospCod && !j.cerrado).length}<span className="text-[10px] text-faint">/{julio.filter((j) => j.prospector === v.prospCod).length}</span></p><p className="text-[10px] text-muted">base julio a cerrar</p></div>
                </div>
              </div>
              {/* sin visitar del día actual */}
              <div className="border-t border-black/5 pt-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
                  Sin visitar · Día {hoyDia} · {Array.from(new Set(delDia.map((r) => r.localidad).filter(Boolean))).join(' · ') || '—'} ({sinVisitar.length})
                </p>
                {sinVisitar.length === 0 ? <p className="text-[11px] text-emerald-600">✓ Día completo</p> : (
                  <div className="space-y-1">
                    {sinVisitar.slice(0, 8).map((r) => (
                      <div key={r.cod} className="flex items-center justify-between text-[12px]"><span className="truncate">{r.nombre}</span><span className="text-[10px] text-faint shrink-0">{r.cohorte === 'canje' ? 'canje' : 'recup'}</span></div>
                    ))}
                    {sinVisitar.length > 8 && <p className="text-[10px] text-faint">+{sinVisitar.length - 8} más</p>}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-faint">Interior (viajes): {interiorN} clientes</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// contador de resultados acumulados
function contarResultados(rows: Row[]) {
  const c: Record<string, number> = {}
  for (const r of rows) if (r.visitado && r.resultado) c[r.resultado] = (c[r.resultado] ?? 0) + 1
  return c
}
