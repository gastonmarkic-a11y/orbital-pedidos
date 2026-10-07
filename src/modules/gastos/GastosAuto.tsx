import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Car, Fuel, ParkingCircle, Receipt, ChevronDown, ChevronRight, Camera, Trash2, Check, X, Settings2, MapPin } from 'lucide-react'

// Gastos de auto de los vendedores de campo (Adrián, Bruno, Lola), atados a los check-ins.
// Lo deducible lo calcula la base (gastos_jornadas, supabase/sql/gastos_auto.sql):
//   combustible → km reconstruidos de los check-ins × consumo × precio, comparado a nivel MES;
//   peaje → tope por día cuando alguna visita queda lejos de la base;
//   estacionamiento → tope por visita dentro de CABA.
// El vendedor carga tickets; administración aprueba con el monto sugerido o lo ajusta.

const VEND = [{ cod: 'Adrian', label: 'Adrián' }, { cod: 'Bruno', label: 'Bruno' }, { cod: 'Lola', label: 'Lola' }]
type Tipo = 'combustible' | 'peaje' | 'estacionamiento' | 'otro'
const TIPOS: Record<Tipo, { label: string; icon: typeof Fuel }> = {
  combustible: { label: 'Combustible', icon: Fuel },
  peaje: { label: 'Peaje', icon: Car },
  estacionamiento: { label: 'Estacionamiento', icon: ParkingCircle },
  otro: { label: 'Otro', icon: Receipt },
}
const ESTADO: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobado: 'bg-emerald-100 text-emerald-800',
  rechazado: 'bg-red-100 text-red-700',
}

interface Jornada {
  fecha: string; visitas: number; visitas_sin_gps: number; visitas_caba: number
  km: number; dist_max_base_km: number | null
  combustible_teorico: number; desgaste: number; tope_peaje: number; tope_estac: number
  cargado_combustible: number; litros: number; cargado_peaje: number; cargado_estac: number; cargado_otro: number
  deducible_peaje: number; deducible_estac: number
  puntos: { t: string; cod: string; nombre: string | null }[]
}
interface Gasto {
  id: number; vendedor: string; fecha: string; tipo: Tipo; monto: number; litros: number | null
  comprobante_path: string | null; nota: string | null; estado: string; monto_aprobado: number | null
}
interface Param {
  vendedor: string; base_direccion: string | null; base_lat: number | null; base_lon: number | null
  km_acercamiento: number; consumo_l_100km: number; precio_litro: number; factor_ruta: number; costo_km_desgaste: number
  umbral_km_peaje: number; tope_peaje_dia: number; tope_estac_visita: number; tope_estac_dia: number
}

const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const fechaCorta = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}` }
const horaAR = (ts: string) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
function rangoMes(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number)
  const fin = new Date(y, m, 0).getDate()
  return [`${ym}-01`, `${ym}-${String(fin).padStart(2, '0')}`]
}

export default function GastosAuto() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esAdmin = rolEfectivo === 'admin' || rolEfectivo === 'administracion'
  const [vend, setVend] = useState(esAdmin ? 'Adrian' : codigoEfectivo)
  const [mes, setMes] = useState(hoyAR().slice(0, 7))
  const [jornadas, setJornadas] = useState<Jornada[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [param, setParam] = useState<Param | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verParams, setVerParams] = useState(false)

  async function cargar() {
    setCargando(true); setError(null)
    const [desde, hasta] = rangoMes(mes)
    const [j, g, p] = await Promise.all([
      supabase.rpc('gastos_jornadas', { p_vendedor: vend, p_desde: desde, p_hasta: hasta }),
      supabase.from('gastos_vendedor').select('*').eq('vendedor', vend).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('id'),
      supabase.from('gastos_parametros').select('*').in('vendedor', [vend, '*']),
    ])
    if (j.error || g.error) setError((j.error ?? g.error)!.message)
    setJornadas((j.data ?? []).map((r: Jornada) => ({ ...r, km: Number(r.km) })))
    setGastos(g.data ?? [])
    const ps = (p.data ?? []) as Param[]
    setParam(ps.find((x) => x.vendedor === vend) ?? ps.find((x) => x.vendedor === '*') ?? null)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [vend, mes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Totales del mes y el monto sugerido de cada gasto
  const res = useMemo(() => {
    const s = (k: keyof Jornada) => jornadas.reduce((a, j) => a + Number(j[k] ?? 0), 0)
    const teorico = s('combustible_teorico'), cargComb = s('cargado_combustible')
    const dedComb = Math.min(teorico, cargComb)
    const dedPeaje = s('deducible_peaje'), dedEstac = s('deducible_estac')
    const porDia = new Map(jornadas.map((j) => [j.fecha, j]))
    const ratioComb = cargComb > 0 ? Math.min(1, teorico / cargComb) : 0
    const sugerido = (g: Gasto): { monto: number; motivo: string } => {
      const j = porDia.get(g.fecha)
      if (g.tipo === 'otro') return { monto: g.monto, motivo: 'Sin regla: revisar a mano' }
      if (g.tipo === 'combustible') {
        if (ratioComb >= 1) return { monto: g.monto, motivo: 'Dentro del consumo teórico del mes' }
        return { monto: g.monto * ratioComb, motivo: `El mes cargó ${$(cargComb)} y los km justifican ${$(teorico)}` }
      }
      if (!j || j.visitas === 0) return { monto: 0, motivo: 'Ese día no hay check-ins' }
      const carg = g.tipo === 'peaje' ? j.cargado_peaje : j.cargado_estac
      const ded = g.tipo === 'peaje' ? j.deducible_peaje : j.deducible_estac
      if (ded === 0) return { monto: 0, motivo: g.tipo === 'peaje' ? 'Ninguna visita del día queda lejos de la base' : 'Ninguna visita del día en CABA' }
      if (ded >= carg) return { monto: g.monto, motivo: 'Dentro del tope del día' }
      return { monto: g.monto * (ded / carg), motivo: `Tope del día ${$(ded)}` }
    }
    const aprobado = gastos.reduce((a, g) => a + (g.estado === 'aprobado' ? Number(g.monto_aprobado ?? 0) : 0), 0)
    return {
      visitas: s('visitas'), km: s('km'), teorico, cargComb, dedComb, litros: s('litros'), desgaste: s('desgaste'),
      cargPeaje: s('cargado_peaje'), dedPeaje, cargEstac: s('cargado_estac'), dedEstac, cargOtro: s('cargado_otro'),
      deducible: dedComb + dedPeaje + dedEstac + s('desgaste'), aprobado, sugerido,
      diasSinVisita: jornadas.filter((j) => j.visitas === 0).length,
      sinGps: s('visitas_sin_gps'),
    }
  }, [jornadas, gastos])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Car size={20} /> Gastos de auto</h1>
          <p className="text-xs text-muted">Se reconoce lo que justifican los check-ins: km del recorrido, peajes y estacionamiento por visita.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-black/10 rounded-lg px-2 py-1.5 text-sm" />
          {esAdmin && (
            <button onClick={() => setVerParams((v) => !v)} className="border border-black/10 rounded-lg p-2" title="Parámetros del auto">
              <Settings2 size={16} />
            </button>
          )}
        </div>
      </div>

      {esAdmin && (
        <div className="flex gap-1 bg-black/5 rounded-xl p-1 w-fit">
          {VEND.map((v) => (
            <button key={v.cod} onClick={() => setVend(v.cod)}
              className={`px-4 py-1.5 rounded-lg text-sm ${vend === v.cod ? 'bg-white shadow-sm font-semibold' : 'text-muted'}`}>{v.label}</button>
          ))}
        </div>
      )}

      {esAdmin && verParams && param && <Parametros p={param} vend={vend} onGuardado={cargar} />}
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Resumen del mes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Visitas con check-in" valor={String(res.visitas)} sub={`${res.km.toFixed(0)} km reconocidos`} />
        <Kpi label="Combustible" valor={$(res.dedComb)} sub={`cargó ${$(res.cargComb)} · justifica ${$(res.teorico)}`} alerta={res.cargComb > res.teorico} />
        <Kpi label="Peaje + estacionamiento" valor={$(res.dedPeaje + res.dedEstac)} sub={`cargó ${$(res.cargPeaje + res.cargEstac)}`} alerta={res.cargPeaje + res.cargEstac > res.dedPeaje + res.dedEstac} />
        <Kpi label="Deducible del mes" valor={$(res.deducible)} sub={`aprobado ${$(res.aprobado)}${res.cargOtro ? ` · otros ${$(res.cargOtro)} a revisar` : ''}`} fuerte />
      </div>
      {(res.diasSinVisita > 0 || res.sinGps > 0 || (param && param.base_lat == null)) && (
        <div className="text-xs text-amber-800 bg-amber-100 rounded-lg px-3 py-2 space-y-0.5">
          {res.diasSinVisita > 0 && <p>· {res.diasSinVisita} día(s) con gastos y sin check-in: no son deducibles.</p>}
          {res.sinGps > 0 && <p>· {res.sinGps} visita(s) sin ubicación (ni del check-in ni del cliente): no suman km.</p>}
          {param && param.base_lat == null && <p>· Sin punto de salida cargado: se suman {param.km_acercamiento} km fijos por día de ida y vuelta.</p>}
        </div>
      )}

      {!esAdmin && <CargarGasto vend={vend} onCargado={cargar} />}

      {/* Días */}
      <div className="bg-white rounded-2xl border border-black/10 divide-y divide-black/5">
        {cargando ? <p className="p-4 text-sm text-muted">Cargando…</p>
          : jornadas.length === 0 ? <p className="p-4 text-sm text-muted">Sin check-ins ni gastos este mes.</p>
          : [...jornadas].reverse().map((j) => (
            <Dia key={j.fecha} j={j} gastos={gastos.filter((g) => g.fecha === j.fecha)} esAdmin={esAdmin}
              sugerido={res.sugerido} onCambio={cargar} />
          ))}
      </div>

      {param && (
        <p className="text-[11px] text-faint">
          Cálculo: km = recorrido entre check-ins{param.base_lat != null ? ' + ida y vuelta a la base' : ` + ${param.km_acercamiento} km fijos`} × {param.factor_ruta} (calle vs. línea recta) ·
          combustible = km × {param.consumo_l_100km} L/100 km × {$(param.precio_litro)}/L ·
          peaje hasta {$(param.tope_peaje_dia)}/día si alguna visita queda a más de {param.umbral_km_peaje} km ·
          estacionamiento hasta {$(param.tope_estac_visita)} por visita en CABA (máx. {$(param.tope_estac_dia)}/día).
        </p>
      )}
    </div>
  )
}

function Kpi({ label, valor, sub, alerta, fuerte }: { label: string; valor: string; sub: string; alerta?: boolean; fuerte?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${fuerte ? 'bg-ink text-white border-transparent' : 'bg-white border-black/10'}`}>
      <p className={`text-[11px] ${fuerte ? 'text-white/70' : 'text-muted'}`}>{label}</p>
      <p className="text-lg font-semibold font-jet">{valor}</p>
      <p className={`text-[11px] ${alerta ? 'text-orange-700' : fuerte ? 'text-white/70' : 'text-faint'}`}>{sub}</p>
    </div>
  )
}

function Dia({ j, gastos, esAdmin, sugerido, onCambio }: {
  j: Jornada; gastos: Gasto[]; esAdmin: boolean
  sugerido: (g: Gasto) => { monto: number; motivo: string }; onCambio: () => void
}) {
  const [open, setOpen] = useState(false)
  const cargado = j.cargado_combustible + j.cargado_peaje + j.cargado_estac + j.cargado_otro
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-jet text-sm w-20">{fechaCorta(j.fecha)}</span>
        <span className={`text-xs ${j.visitas === 0 ? 'text-red-700 font-semibold' : 'text-muted'}`}>
          {j.visitas === 0 ? 'sin check-in' : `${j.visitas} visita${j.visitas > 1 ? 's' : ''} · ${j.km.toFixed(1)} km`}
        </span>
        <span className="ml-auto text-xs text-muted hidden sm:inline">justifica {$(j.combustible_teorico)} nafta{j.tope_peaje ? ` · peaje ${$(j.tope_peaje)}` : ''}{j.tope_estac ? ` · estac. ${$(j.tope_estac)}` : ''}</span>
        {cargado > 0 && <span className="text-xs font-semibold ml-2">{$(cargado)}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {j.puntos.length > 0 && (
            <ol className="text-xs text-muted space-y-0.5 pl-6">
              {j.puntos.map((p, i) => (
                <li key={i} className="flex items-center gap-1"><MapPin size={11} /> <span className="font-jet">{horaAR(p.t)}</span> {p.nombre ?? p.cod}</li>
              ))}
            </ol>
          )}
          {j.visitas_sin_gps > 0 && <p className="text-[11px] text-orange-700 pl-6">{j.visitas_sin_gps} visita(s) sin ubicación</p>}
          {gastos.map((g) => <FilaGasto key={g.id} g={g} esAdmin={esAdmin} sug={sugerido(g)} onCambio={onCambio} />)}
        </div>
      )}
    </div>
  )
}

function FilaGasto({ g, esAdmin, sug, onCambio }: { g: Gasto; esAdmin: boolean; sug: { monto: number; motivo: string }; onCambio: () => void }) {
  const [monto, setMonto] = useState(String(Math.round(sug.monto)))
  const [ocupado, setOcupado] = useState(false)
  const T = TIPOS[g.tipo]
  async function verTicket() {
    if (!g.comprobante_path) return
    const { data } = await supabase.storage.from('gastos').createSignedUrl(g.comprobante_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function revisar(estado: 'aprobado' | 'rechazado' | 'pendiente') {
    setOcupado(true)
    const { error } = await supabase.rpc('gastos_revisar', { p_id: g.id, p_estado: estado, p_monto: estado === 'aprobado' ? Number(monto) : null })
    setOcupado(false)
    if (error) alert(error.message); else onCambio()
  }
  async function borrar() {
    if (!confirm('¿Borrar este gasto?')) return
    const { error } = await supabase.from('gastos_vendedor').delete().eq('id', g.id)
    if (error) alert(error.message); else onCambio()
  }
  return (
    <div className="border border-black/10 rounded-xl px-3 py-2 ml-6 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <T.icon size={15} className="text-muted" />
        <span>{T.label}{g.litros ? ` · ${g.litros} L` : ''}</span>
        {g.comprobante_path && <button onClick={verTicket} className="text-xs underline text-muted">ticket</button>}
        <span className={`text-[10px] rounded-full px-2 py-0.5 ${ESTADO[g.estado]}`}>{g.estado}</span>
        <span className="ml-auto font-semibold font-jet">{$(g.monto)}</span>
        {!esAdmin && g.estado === 'pendiente' && <button onClick={borrar} className="text-muted"><Trash2 size={14} /></button>}
      </div>
      {g.nota && <p className="text-xs text-muted">{g.nota}</p>}
      {g.estado === 'aprobado' && <p className="text-xs text-emerald-700">Aprobado: {$(Number(g.monto_aprobado))}</p>}
      {esAdmin && g.estado === 'pendiente' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${sug.monto < g.monto ? 'text-orange-700' : 'text-emerald-700'}`}>Sugerido {$(sug.monto)} · {sug.motivo}</span>
          <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            className="ml-auto w-28 border border-black/10 rounded-lg px-2 py-1 text-sm font-jet text-right" />
          <button disabled={ocupado} onClick={() => revisar('aprobado')} className="bg-emerald-600 text-white rounded-lg px-2 py-1 text-xs flex items-center gap-1"><Check size={13} /> Aprobar</button>
          <button disabled={ocupado} onClick={() => revisar('rechazado')} className="border border-black/10 rounded-lg px-2 py-1 text-xs flex items-center gap-1"><X size={13} /> Rechazar</button>
        </div>
      )}
      {esAdmin && g.estado !== 'pendiente' && (
        <button onClick={() => revisar('pendiente')} className="text-[11px] text-muted underline">Volver a pendiente</button>
      )}
    </div>
  )
}

function CargarGasto({ vend, onCargado }: { vend: string; onCargado: () => void }) {
  const [tipo, setTipo] = useState<Tipo>('combustible')
  const [fecha, setFecha] = useState(hoyAR())
  const [monto, setMonto] = useState('')
  const [litros, setLitros] = useState('')
  const [nota, setNota] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function guardar() {
    if (!Number(monto)) { setMsg('Poné el monto.'); return }
    if (tipo !== 'estacionamiento' && !foto) { setMsg('Sacale una foto al ticket.'); return }
    setGuardando(true); setMsg(null)
    let path: string | null = null
    if (foto) {
      const ext = foto.name.split('.').pop() || 'jpg'
      path = `${vend}/${fecha}-${tipo}-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('gastos').upload(path, foto)
      if (error) { setGuardando(false); setMsg('No se pudo subir la foto: ' + error.message); return }
    }
    const { error } = await supabase.from('gastos_vendedor').insert({
      vendedor: vend, fecha, tipo, monto: Number(monto),
      litros: tipo === 'combustible' && Number(litros) ? Number(litros) : null,
      comprobante_path: path, nota: nota.trim() || null,
    })
    setGuardando(false)
    if (error) { setMsg(error.message); return }
    setMonto(''); setLitros(''); setNota(''); setFoto(null); setMsg('Cargado ✓')
    onCargado()
  }

  return (
    <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
      <p className="text-sm font-semibold">Cargar gasto</p>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(TIPOS) as Tipo[]).map((t) => {
          const I = TIPOS[t].icon
          return (
            <button key={t} onClick={() => setTipo(t)}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border ${tipo === t ? 'bg-ink text-white border-transparent' : 'border-black/10'}`}>
              <I size={14} /> {TIPOS[t].label}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input type="date" value={fecha} max={hoyAR()} onChange={(e) => setFecha(e.target.value)} className="border border-black/10 rounded-lg px-2 py-1.5 text-sm" />
        <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Monto $" className="border border-black/10 rounded-lg px-2 py-1.5 text-sm font-jet" />
        {tipo === 'combustible' && <input value={litros} onChange={(e) => setLitros(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} inputMode="decimal" placeholder="Litros" className="border border-black/10 rounded-lg px-2 py-1.5 text-sm font-jet" />}
        <label className="border border-black/10 rounded-lg px-2 py-1.5 text-sm flex items-center gap-1 cursor-pointer text-muted">
          <Camera size={14} /> {foto ? 'Foto lista ✓' : 'Foto del ticket'}
          <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" className="w-full border border-black/10 rounded-lg px-2 py-1.5 text-sm" />
      <div className="flex items-center gap-2">
        <button disabled={guardando} onClick={guardar} className="bg-ink text-white rounded-lg px-4 py-1.5 text-sm">{guardando ? 'Guardando…' : 'Guardar'}</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
      <p className="text-[11px] text-faint">Se reconoce sólo lo que respaldan tus check-ins de ese día (y, para nafta, los km del mes).</p>
    </div>
  )
}

function Parametros({ p, vend, onGuardado }: { p: Param; vend: string; onGuardado: () => void }) {
  const [f, setF] = useState<Param>({ ...p, vendedor: vend })
  const [coords, setCoords] = useState(p.base_lat != null ? `${p.base_lat}, ${p.base_lon}` : '')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { setF({ ...p, vendedor: vend }); setCoords(p.base_lat != null ? `${p.base_lat}, ${p.base_lon}` : '') }, [p, vend])
  const num = (k: keyof Param) => (
    <input value={String(f[k] ?? '')} inputMode="decimal" onChange={(e) => setF({ ...f, [k]: e.target.value.replace(',', '.') })}
      className="w-full border border-black/10 rounded-lg px-2 py-1 text-sm font-jet" />
  )
  async function guardar() {
    const m = coords.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
    const fila = {
      ...f,
      base_lat: m ? Number(m[1]) : null, base_lon: m ? Number(m[2]) : null,
      km_acercamiento: Number(f.km_acercamiento), consumo_l_100km: Number(f.consumo_l_100km), precio_litro: Number(f.precio_litro),
      factor_ruta: Number(f.factor_ruta), costo_km_desgaste: Number(f.costo_km_desgaste), umbral_km_peaje: Number(f.umbral_km_peaje),
      tope_peaje_dia: Number(f.tope_peaje_dia), tope_estac_visita: Number(f.tope_estac_visita), tope_estac_dia: Number(f.tope_estac_dia),
      actualizado_en: new Date().toISOString(),
    }
    const { error } = await supabase.from('gastos_parametros').upsert(fila)
    setMsg(error ? error.message : 'Guardado ✓')
    if (!error) onGuardado()
  }
  const campos: [keyof Param, string][] = [
    ['consumo_l_100km', 'Consumo (L/100 km)'], ['precio_litro', 'Precio litro $'], ['factor_ruta', 'Factor ruta'],
    ['costo_km_desgaste', 'Desgaste $/km'], ['km_acercamiento', 'Km fijos sin base'], ['umbral_km_peaje', 'Peaje desde (km)'],
    ['tope_peaje_dia', 'Tope peaje/día $'], ['tope_estac_visita', 'Estac./visita CABA $'], ['tope_estac_dia', 'Tope estac./día $'],
  ]
  return (
    <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
      <p className="text-sm font-semibold">Parámetros del auto · {VEND.find((v) => v.cod === vend)?.label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-muted">Punto de salida (dirección)
          <input value={f.base_direccion ?? ''} onChange={(e) => setF({ ...f, base_direccion: e.target.value })} className="w-full border border-black/10 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-muted">Coordenadas (pegar de Google Maps: lat, lon)
          <input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="-34.60, -58.44" className="w-full border border-black/10 rounded-lg px-2 py-1 text-sm font-jet" />
        </label>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {campos.map(([k, l]) => <label key={k} className="text-[11px] text-muted">{l}{num(k)}</label>)}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={guardar} className="bg-ink text-white rounded-lg px-4 py-1.5 text-sm">Guardar</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  )
}
