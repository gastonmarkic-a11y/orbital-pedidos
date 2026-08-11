import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { ChevronDown, ChevronRight, CalendarDays, Plane, MapPin } from 'lucide-react'

// Panel ADMIN de la agenda de campo: ve a Martín y Adrián juntos, el doble trabajo de
// prospección (turnos para vendedores + base de julio a cerrar), y los resultados del
// día + acumulados. Abajo: el FUTURO de las agendas día por día (con fechas, desplegable),
// el trabajo de los prospectores y dos reseñas (julio a cerrar + cartera del interior).

interface Row { dia_num: number; bloque: string; cohorte: string; localidad: string | null; provincia?: string | null; region?: string | null; cod: string; nombre: string | null; visitado: boolean; resultado: string | null; unidades?: number | null }
interface Turno { vendedor: string; dia_num: number; cargado_por: string | null; cliente?: string | null; localidad?: string | null }
interface Act { vendedor: string; cod_cliente: string; resultado_contacto: string | null; monto_vendido: number | null; unidades_vendidas: number | null }
interface PJ { prospector: string; cerrado: boolean; nombre: string | null; codigo: string | null; localidad?: string | null }

const VEND = [{ cod: 'Adrian', label: 'Adrián', prosp: 'Luna', prospCod: 'Marketing' }, { cod: 'Martin', label: 'Martín', prosp: 'Damián', prospCod: 'Damian' }]
const RES = { vendio: '🟢 Vendió', visito: '🔵 Visité', no_estaba: '🟠 No estaba', reagendar: '🟣 Reagendar' } as const
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

// --- Fechas: la agenda corre a partir del 11/8 (fijo); etiqueta relativa a hoy (Hoy/Mañana/DíaSem) ---
const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const INICIO_AGENDA: [number, number, number] = [2026, 7, 11]
function sumarHabiles(base: Date, k: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const paso = k >= 0 ? 1 : -1; let rem = Math.abs(k)
  while (rem > 0) { d.setDate(d.getDate() + paso); if (d.getDay() !== 0 && d.getDay() !== 6) rem-- }
  return d
}
function fechaDeDia(n: number): Date {
  const b = new Date(INICIO_AGENDA[0], INICIO_AGENDA[1], INICIO_AGENDA[2])
  while (b.getDay() === 0 || b.getDay() === 6) b.setDate(b.getDate() + 1)
  return sumarHabiles(b, n - 1)
}
function labelDia(n: number): string {
  const f = fechaDeDia(n)
  const fmt = `${DIAS_SEM[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}`
  const h = new Date(); const hoy = new Date(h.getFullYear(), h.getMonth(), h.getDate())
  const man = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(f, hoy)) return `Hoy · ${fmt}`
  if (same(f, man)) return `Mañana · ${fmt}`
  return fmt
}

// Línea de día desplegable
function DiaLinea({ label, chips, detalle }: { label: string; chips: ReactNode; detalle: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-black/5 first:border-0">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 py-2 text-left">
        {open ? <ChevronDown size={14} className="text-faint shrink-0" /> : <ChevronRight size={14} className="text-faint shrink-0" />}
        <span className="text-[12px] font-semibold w-24 shrink-0 tabular-nums">{label}</span>
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">{chips}</span>
      </button>
      {open && <div className="pb-2 pl-6 pr-1">{detalle}</div>}
    </div>
  )
}

// Sección colapsable full-width
function Seccion({ icon, titulo, sub, children, def = false }: { icon: ReactNode; titulo: string; sub?: string; children: ReactNode; def?: boolean }) {
  const [open, setOpen] = useState(def)
  return (
    <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 p-4 text-left">
        <span className="text-brand shrink-0">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold">{titulo}</span>
          {sub && <span className="block text-[11px] text-muted">{sub}</span>}
        </span>
        {open ? <ChevronDown size={18} className="text-faint" /> : <ChevronRight size={18} className="text-faint" />}
      </button>
      {open && <div className="px-4 pb-4 -mt-1">{children}</div>}
    </div>
  )
}

export default function AgendaEquipo() {
  const [planes, setPlanes] = useState<Record<string, Row[]>>({})
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [actHoy, setActHoy] = useState<Act[]>([])
  const [julio, setJulio] = useState<PJ[]>([])
  const [loading, setLoading] = useState(true)
  const [semana, setSemana] = useState<number | null>(null)

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      const hoy = new Date().toISOString().slice(0, 10)
      const [a, m, t, ah] = await Promise.all([
        supabase.rpc('agenda_campo_plan', { p_vendedor: 'Adrian' }),
        supabase.rpc('agenda_campo_plan', { p_vendedor: 'Martin' }),
        supabase.from('agenda_turnos').select('vendedor,dia_num,cargado_por,cliente,localidad'),
        supabase.from('actividad_diaria').select('vendedor,cod_cliente,resultado_contacto,monto_vendido,unidades_vendidas').eq('origen', 'agenda_campo').eq('fecha', hoy),
      ])
      const pj = await supabase.from('prospectos_julio').select('prospector,cerrado,nombre,codigo,localidad')
      setPlanes({ Adrian: (a.data as Row[]) ?? [], Martin: (m.data as Row[]) ?? [] })
      setTurnos((t.data as Turno[]) ?? [])
      setActHoy((ah.data as Act[]) ?? [])
      setJulio((pj.data as PJ[]) ?? [])
      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando equipo…</p>

  const cohChip = (c: string) => c === 'canje'
    ? <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700">canje</span>
    : <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700">recup</span>

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h1 className="text-lg font-bold">Agenda de equipo</h1>
        <p className="text-xs text-muted">Recorrido de campo + prospección · resultados del día, acumulados y lo que viene</p>
      </div>

      {(() => {
        const allBa = [...(planes.Adrian ?? []), ...(planes.Martin ?? [])].filter((r) => r.bloque === 'ba_gba')
        const total = allBa.length, visit = allBa.filter((r) => r.visitado).length
        const vh = actHoy.length, ventas = actHoy.filter((a) => a.resultado_contacto === 'vendio')
        const monto = ventas.reduce((s, a) => s + (a.monto_vendido ?? 0), 0)
        const conv = vh ? Math.round((ventas.length / vh) * 100) : 0
        return (
          <div className="bg-ink text-white rounded-2xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/60 mb-2">Resumen general — hoy</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><p className="text-2xl font-bold">{vh}</p><p className="text-[10px] text-white/60">visitas hoy</p></div>
              <div><p className="text-2xl font-bold text-emerald-300">{ventas.length}</p><p className="text-[10px] text-white/60">ventas hoy</p></div>
              <div><p className="text-lg font-bold text-emerald-300">{kAr(monto)}</p><p className="text-[10px] text-white/60">facturado hoy</p></div>
              <div><p className="text-2xl font-bold text-gold">{conv}%</p><p className="text-[10px] text-white/60">conversión</p></div>
              <div><p className="text-2xl font-bold">{visit}<span className="text-sm text-white/50">/{total}</span></p><p className="text-[10px] text-white/60">avance total</p></div>
            </div>
          </div>
        )
      })()}

      {/* ===== ALERTAS + LÍNEA DE TIEMPO (Gantt) + SELECTOR DE SEMANA ===== */}
      {(() => {
        const vendData = VEND.map((v) => {
          const baGba = (planes[v.cod] ?? []).filter((r) => r.bloque === 'ba_gba')
          const dias = Array.from(new Set(baGba.map((r) => r.dia_num))).sort((a, b) => a - b)
          const hoyDia = dias.find((d) => baGba.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1
          const perDay = dias.map((d) => {
            const del = baGba.filter((r) => r.dia_num === d)
            return { d, n: del.length, vis: del.filter((r) => r.visitado).length, turnos: turnos.filter((t) => t.vendedor === v.cod && t.dia_num === d).length, flojo: del.length < 4, zona: Array.from(new Set(del.map((r) => r.localidad).filter(Boolean))).slice(0, 2).join(' · ') }
          })
          return { v, dias, hoyDia, perDay }
        })
        const maxDia = Math.max(1, ...vendData.flatMap((x) => x.dias))
        const semanas = Math.max(1, Math.ceil(maxDia / 5))
        const curWeek = Math.max(1, Math.ceil(Math.min(...vendData.map((x) => x.hoyDia)) / 5))
        const semSel = Math.min(semana ?? curWeek, semanas)
        const maxN = Math.max(1, ...vendData.flatMap((x) => x.perDay.map((p) => p.n)))
        const enSemana = (d: number) => Math.ceil(d / 5) === semSel
        // Alertas: prospección faltante en los próximos 3 días + días flojos
        const alertas: { color: string; txt: string }[] = []
        for (const vd of vendData) {
          for (const p of vd.perDay) {
            if (p.d >= vd.hoyDia && p.d <= vd.hoyDia + 2 && p.turnos < 5)
              alertas.push({ color: 'amber', txt: `${vd.v.label} · ${labelDia(p.d)}: faltan ${5 - p.turnos} turnos de ${vd.v.prosp} (prospección)` })
          }
          const flojos = vd.perDay.filter((p) => p.flojo)
          if (flojos.length) alertas.push({ color: 'red', txt: `${vd.v.label}: ${flojos.length} día(s) flojo(s) con menos de 4 clientes (${flojos.slice(0, 3).map((p) => labelDia(p.d)).join(', ')}${flojos.length > 3 ? '…' : ''})` })
        }
        const colAl = (c: string) => c === 'red' ? 'border-red-400 bg-red-50 text-red-700' : 'border-amber-400 bg-amber-50 text-amber-800'
        return (
          <>
            {alertas.length > 0 && (
              <div className="bg-white rounded-2xl border border-black/10 p-4">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">⚠ Alertas de gestión ({alertas.length})</p>
                <div className="space-y-1.5">
                  {alertas.map((a, i) => (
                    <div key={i} className={`text-[12px] rounded-lg border-l-4 px-3 py-1.5 ${colAl(a.color)}`}>{a.txt}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-black/10 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <p className="text-sm font-bold">Línea de tiempo · carga por día</p>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <button onClick={() => setSemana(Math.max(1, semSel - 1))} disabled={semSel <= 1} className="w-7 h-7 rounded-lg border border-black/10 disabled:opacity-30">‹</button>
                  <span className="font-semibold w-24 text-center">Semana {semSel}/{semanas}</span>
                  <button onClick={() => setSemana(Math.min(semanas, semSel + 1))} disabled={semSel >= semanas} className="w-7 h-7 rounded-lg border border-black/10 disabled:opacity-30">›</button>
                  <button onClick={() => setSemana(curWeek)} className="ml-1 text-[11px] text-brandDark font-medium">hoy</button>
                </div>
              </div>
              {/* Gantt: una fila por vendedor, un bar por día. Semana elegida resaltada. */}
              <div className="space-y-2 overflow-x-auto">
                {vendData.map((vd) => (
                  <div key={vd.v.cod} className="flex items-end gap-[3px] min-w-max">
                    <span className="w-14 shrink-0 text-[11px] font-semibold text-muted self-center">{vd.v.label}</span>
                    {vd.perDay.map((p) => {
                      const completo = p.vis >= p.n && p.n > 0
                      const color = completo ? 'bg-emerald-500' : p.flojo ? 'bg-red-400' : p.turnos < 5 && p.d <= vd.hoyDia + 2 ? 'bg-amber-400' : 'bg-brand'
                      return (
                        <button key={p.d} onClick={() => setSemana(Math.ceil(p.d / 5))} title={`${labelDia(p.d)} · ${p.zona || 'zona'} · ${p.n} clientes · ${p.turnos} prosp. · ${p.vis} visitados`}
                          className={`w-[13px] rounded-t transition-all ${color} ${enSemana(p.d) ? 'ring-2 ring-ink/40 opacity-100' : 'opacity-55 hover:opacity-90'}`}
                          style={{ height: `${8 + (p.n / maxN) * 40}px` }} />
                      )
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-3 pl-14 text-[9px] text-faint pt-1 min-w-max">
                  <span>Día {(semSel - 1) * 5 + 1}–{Math.min(semSel * 5, maxDia)}</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />completo</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-brand inline-block" />ok</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />falta prosp.</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-red-400 inline-block" />flojo</span>
                </div>
              </div>
              {/* Resumen de la semana elegida */}
              <div className="grid gap-2 md:grid-cols-2 mt-3">
                {vendData.map((vd) => {
                  const dSem = vd.perDay.filter((p) => enSemana(p.d))
                  const cli = dSem.reduce((s, p) => s + p.n, 0)
                  const vis = dSem.reduce((s, p) => s + p.vis, 0)
                  const tur = dSem.reduce((s, p) => s + p.turnos, 0)
                  return (
                    <div key={vd.v.cod} className="bg-[#F6F4EF] rounded-lg p-2.5 text-[12px] flex items-center justify-between">
                      <span className="font-semibold">{vd.v.label} · sem {semSel}</span>
                      <span className="text-muted">{dSem.length} días · {cli} clientes · {vis} visit. · <b className="text-[#8F6A34]">{tur}</b> turnos prosp.</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )
      })()}

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
          const acum = contarResultados(baGba)
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
              <div>
                <div className="flex justify-between text-[11px] text-muted mb-1"><span>Avance del recorrido</span><span>{visit}/{total}</span></div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-brand" style={{ width: `${total ? (visit / total) * 100 : 0}%` }} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-lg font-bold">{actV.length}</p><p className="text-[10px] text-muted">visitas hoy</p></div>
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-lg font-bold text-emerald-700">{vendioHoy.length}</p><p className="text-[10px] text-muted">ventas hoy</p></div>
                <div className="bg-[#F6F4EF] rounded-lg p-2 text-center"><p className="text-sm font-bold text-emerald-700 truncate">{kAr(montoHoy)}</p><p className="text-[10px] text-muted">$ hoy</p></div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(RES) as (keyof typeof RES)[]).map((k) => (
                  <span key={k} className="text-[10px] rounded-full px-2 py-0.5 bg-black/5 text-muted">{RES[k]}: <b>{acum[k] ?? 0}</b></span>
                ))}
              </div>
              <div className="border-t border-black/5 pt-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Prospección ({v.prosp})</p>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="bg-[#F6F4EF] rounded-lg p-2"><p className="font-bold">{turnosV.length}</p><p className="text-[10px] text-muted">turnos para {v.label}</p></div>
                  <div className="bg-[#F6F4EF] rounded-lg p-2"><p className="font-bold">{julio.filter((j) => j.prospector === v.prospCod && !j.cerrado).length}<span className="text-[10px] text-faint">/{julio.filter((j) => j.prospector === v.prospCod).length}</span></p><p className="text-[10px] text-muted">base julio a cerrar</p></div>
                </div>
              </div>
              <div className="border-t border-black/5 pt-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
                  Sin visitar · {labelDia(hoyDia)} · {Array.from(new Set(delDia.map((r) => r.localidad).filter(Boolean))).join(' · ') || '—'} ({sinVisitar.length})
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

      {/* ===== FUTURO DE LAS AGENDAS: día por día, con fechas, desplegable ===== */}
      {VEND.map((v) => {
        const baGba = (planes[v.cod] ?? []).filter((r) => r.bloque === 'ba_gba')
        const dias = Array.from(new Set(baGba.map((r) => r.dia_num))).sort((a, b) => a - b)
        return (
          <Seccion key={v.cod} icon={<CalendarDays size={18} />}
            titulo={`Próximos días — ${v.label}`}
            sub={`${dias.length} días de recorrido · prospección de ${v.prosp} 2 días antes · tocá un día para ver los clientes`}>
            <div>
              {dias.map((d) => {
                const del = baGba.filter((r) => r.dia_num === d)
                const canje = del.filter((r) => r.cohorte === 'canje').length
                const recup = del.filter((r) => r.cohorte === 'recuperar').length
                const vis = del.filter((r) => r.visitado).length
                const turnosDia = turnos.filter((t) => t.vendedor === v.cod && t.dia_num === d)
                const zona = Array.from(new Set(del.map((r) => r.localidad).filter(Boolean))).slice(0, 4).join(' · ')
                const pot = del.reduce((s, r) => s + (r.unidades ?? 0), 0)
                return (
                  <DiaLinea key={d} label={labelDia(d)}
                    chips={<>
                      <span className="text-[12px] text-ink truncate max-w-[45%]">{zona || 'Zona'}</span>
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-black/5 text-muted">{del.length} cli</span>
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700">{canje} canje</span>
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700">{recup} recup</span>
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-[#8F6A34]/10 text-[#8F6A34]">{turnosDia.length} prosp.</span>
                      {vis > 0 && <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-emerald-100 text-emerald-700">{vis} visit.</span>}
                    </>}
                    detalle={<div className="space-y-1">
                      {del.map((r) => (
                        <div key={r.cod} className="flex items-center justify-between gap-2 text-[12px]">
                          <span className={`truncate ${r.visitado ? 'text-muted line-through' : ''}`}>{r.nombre}</span>
                          <span className="flex items-center gap-1.5 shrink-0">{cohChip(r.cohorte)}{r.localidad && <span className="text-[10px] text-faint">{r.localidad}</span>}</span>
                        </div>
                      ))}
                      {turnosDia.length > 0 && (
                        <div className="pt-1 mt-1 border-t border-black/5">
                          <p className="text-[10px] font-semibold text-[#8F6A34] uppercase tracking-wide mb-0.5">Prospección ({v.prosp}) — {turnosDia.length} turno{turnosDia.length === 1 ? '' : 's'}</p>
                          {turnosDia.map((t, i) => <p key={i} className="text-[11px] text-muted truncate">• {t.cliente}{t.localidad ? ` · ${t.localidad}` : ''}</p>)}
                        </div>
                      )}
                      <p className="text-[10px] text-faint pt-0.5">Potencial del día: {pot} u. históricas.</p>
                    </div>}
                  />
                )
              })}
              <p className="text-[10px] text-faint pt-2">Pendiente pasar prospección hacia adelante: cada día se completa hasta 12 visitas con los turnos de {v.prosp}.</p>
            </div>
          </Seccion>
        )
      })}

      {/* ===== RESEÑA 1: prospección paralela — +100 contactos de julio a cerrar ===== */}
      <Seccion icon={<CalendarDays size={18} />}
        titulo="Reseña · Prospección de julio a cerrar este mes"
        sub={`Contactos que ya se hablaron el mes pasado y hay que cerrar por catálogo — trabajo en paralelo de Luna y Damián`}>
        <div className="grid gap-3 md:grid-cols-2">
          {VEND.map((v) => {
            const propios = julio.filter((j) => j.prospector === v.prospCod)
            const abiertos = propios.filter((j) => !j.cerrado)
            const cerrados = propios.length - abiertos.length
            return (
              <div key={v.prospCod} className="bg-[#F7F5F0] rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold">{v.prosp}</p>
                  <p className="text-[11px] text-muted">{abiertos.length} <span className="text-faint">abiertos</span> · {cerrados} cerrados · {propios.length} total</p>
                </div>
                <div className="h-2 bg-black/10 rounded-full overflow-hidden mb-2"><div className="h-full bg-emerald-500" style={{ width: `${propios.length ? (cerrados / propios.length) * 100 : 0}%` }} /></div>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {abiertos.slice(0, 60).map((j, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate">{j.nombre}</span>
                      <span className="text-[10px] text-faint shrink-0">{[j.codigo, j.localidad].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                  {abiertos.length > 60 && <p className="text-[10px] text-faint">+{abiertos.length - 60} más…</p>}
                  {abiertos.length === 0 && <p className="text-[11px] text-emerald-600">✓ Todos cerrados</p>}
                </div>
              </div>
            )
          })}
        </div>
      </Seccion>

      {/* ===== RESEÑA 2: cartera del interior del país (viajes) de los vendedores ===== */}
      <Seccion icon={<Plane size={18} />}
        titulo="Reseña · Cartera del interior del país (viajes)"
        sub="Clientes de canje y a recuperar fuera de BA+GBA — se trabajan por viaje, no en el recorrido diario">
        <div className="grid gap-3 md:grid-cols-2">
          {VEND.map((v) => {
            const inter = (planes[v.cod] ?? []).filter((r) => r.bloque === 'interior')
            // agrupar por provincia/región para leerlo como plan de viaje
            const porZona = new Map<string, Row[]>()
            for (const r of inter) { const k = (r.provincia || r.region || r.localidad || '(sin zona)') as string; (porZona.get(k) ?? porZona.set(k, []).get(k)!).push(r) }
            const zonas = [...porZona.entries()].sort((a, b) => b[1].length - a[1].length)
            return (
              <div key={v.cod} className="bg-[#F7F5F0] rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold">{v.label}</p>
                  <p className="text-[11px] text-muted">{inter.length} clientes · {zonas.length} zonas</p>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {zonas.map(([z, rs]) => (
                    <div key={z} className="flex items-center justify-between gap-2 text-[12px] border-t border-black/5 first:border-0 py-1">
                      <span className="flex items-center gap-1.5 min-w-0"><MapPin size={12} className="text-[#8F6A34] shrink-0" /><span className="truncate font-medium">{z}</span></span>
                      <span className="text-[10px] text-faint shrink-0">{rs.length} cli · {rs.filter((r) => r.cohorte === 'canje').length} canje / {rs.filter((r) => r.cohorte === 'recuperar').length} recup</span>
                    </div>
                  ))}
                  {inter.length === 0 && <p className="text-[11px] text-faint">Sin clientes de interior.</p>}
                </div>
              </div>
            )
          })}
        </div>
      </Seccion>
    </div>
  )
}

function contarResultados(rows: Row[]) {
  const c: Record<string, number> = {}
  for (const r of rows) if (r.visitado && r.resultado) c[r.resultado] = (c[r.resultado] ?? 0) + 1
  return c
}
