import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

// Panel de costeo de producción/importación — 3 variantes editables (nacional / aéreo / barco).
// Todos los % son hipótesis de arranque, 100% editables. Cuando haya una importación real,
// cada % se reemplaza por el dato real. IVA/percepciones NO se cuentan (son recuperables).

interface Datos {
  fob: number // USD FOB (aéreo/barco)
  precioProveedor: number // USD nacional
  cantidad: number
  // nacional
  factorNacional: number
  leadNacional: number
  fijoNacional: number
  // aéreo (fracción sobre FOB)
  aFlete: number
  aGastos: number
  aFinanciero: number
  aContingencia: number
  leadAereo: number
  fijoAereo: number
  // barco
  bFlete: number
  bGastos: number
  bFinanciero: number
  bContingencia: number
  leadBarco: number
  fijoBarco: number
  // comunes (impuestos: dependen de NCM/origen, no del método de envío)
  arancel: number // fracción sobre FOB
  tasaEstadistica: number // fracción sobre FOB (default 3%)
  // financiero para el capital inmovilizado
  tasaAnual: number // fracción anual
}

const DEFAULTS: Datos = {
  fob: 10,
  precioProveedor: 10,
  cantidad: 1000,
  factorNacional: 0.05,
  leadNacional: 3,
  fijoNacional: 0,
  aFlete: 0.12,
  aGastos: 0.03,
  aFinanciero: 0.03,
  aContingencia: 0.02,
  leadAereo: 15,
  fijoAereo: 0,
  bFlete: 0.05,
  bGastos: 0.05,
  bFinanciero: 0.06,
  bContingencia: 0.03,
  leadBarco: 60,
  fijoBarco: 0,
  arancel: 0,
  tasaEstadistica: 0.03,
  tasaAnual: 0.4,
}

const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const usd0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

interface Variante {
  key: 'nacional' | 'avion' | 'barco'
  nombre: string
  icono: string
  unit: number // costo landed unitario
  fijo: number
  lead: number
  capital: string // nivel de capital inmovilizado
}

export default function PanelCosteo() {
  const { vendedor } = useAuth()
  const toast = useToast()
  const [d, setD] = useState<Datos>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase
      .from('costeo_config')
      .select('datos')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const guardado = (data?.datos ?? {}) as Partial<Datos>
        setD({ ...DEFAULTS, ...guardado })
        setLoading(false)
      })
  }, [])

  function set<K extends keyof Datos>(k: K, v: number) {
    setD((p) => ({ ...p, [k]: v }))
  }

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase
      .from('costeo_config')
      .update({ datos: d, actualizado_at: new Date().toISOString(), actualizado_por: vendedor?.nombre ?? null })
      .eq('id', 1)
    setGuardando(false)
    toast(error ? 'No se pudo guardar: ' + error.message : 'Parámetros de costeo guardados', error ? 'error' : 'success')
  }

  const variantes: Variante[] = useMemo(() => {
    const impuestos = d.arancel + d.tasaEstadistica
    return [
      {
        key: 'nacional',
        nombre: 'Nacional',
        icono: '🏭',
        unit: d.precioProveedor * (1 + d.factorNacional),
        fijo: d.fijoNacional,
        lead: d.leadNacional,
        capital: 'bajo',
      },
      {
        key: 'avion',
        nombre: 'Aéreo',
        icono: '✈️',
        unit: d.fob * (1 + d.aFlete + d.aGastos + d.aFinanciero + d.aContingencia + impuestos),
        fijo: d.fijoAereo,
        lead: d.leadAereo,
        capital: 'bajo/medio',
      },
      {
        key: 'barco',
        nombre: 'Barco',
        icono: '🚢',
        unit: d.fob * (1 + d.bFlete + d.bGastos + d.bFinanciero + d.bContingencia + impuestos),
        fijo: d.fijoBarco,
        lead: d.leadBarco,
        capital: 'alto',
      },
    ]
  }, [d])

  // Métricas por variante (para la cantidad actual)
  const calc = variantes.map((v) => {
    const totalLanded = v.fijo + v.unit * d.cantidad
    const finFactor = (d.tasaAnual * v.lead) / 365
    const costoFinanciero = totalLanded * finFactor
    const efectivoTotal = totalLanded + costoFinanciero
    return {
      ...v,
      costoRealUnit: d.cantidad > 0 ? totalLanded / d.cantidad : v.unit,
      inversionTotal: totalLanded,
      costoFinanciero,
      efectivoTotal,
      efectivoUnit: d.cantidad > 0 ? efectivoTotal / d.cantidad : v.unit,
      // línea de costo efectivo: A + B*q
      A: v.fijo * (1 + finFactor),
      B: v.unit * (1 + finFactor),
    }
  })

  const minReal = Math.min(...calc.map((c) => c.costoRealUnit))
  const minEfectivo = Math.min(...calc.map((c) => c.efectivoUnit))

  // Cortes por volumen: envolvente inferior de las 3 rectas de costo efectivo (A + B*q)
  const segmentos = useMemo(() => {
    const lines = calc.map((c) => ({ name: c.nombre, A: c.A, B: c.B }))
    const bps = new Set<number>([0])
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const dB = lines[j].B - lines[i].B
        if (Math.abs(dB) < 1e-9) continue
        const q = (lines[i].A - lines[j].A) / dB
        if (q > 1 && q < 1e7) bps.add(Math.round(q))
      }
    const puntos = [...bps].sort((a, b) => a - b)
    const ganadorEn = (q: number) => {
      let best = lines[0]
      for (const l of lines) if (l.A + l.B * q < best.A + best.B * q) best = l
      return best.name
    }
    const segs: { desde: number; hasta: number | null; variante: string }[] = []
    for (let i = 0; i < puntos.length; i++) {
      const desde = puntos[i]
      const hasta = i + 1 < puntos.length ? puntos[i + 1] : null
      const medio = hasta ? (desde + hasta) / 2 : desde + 1000
      const variante = ganadorEn(medio)
      const ult = segs[segs.length - 1]
      if (ult && ult.variante === variante) ult.hasta = hasta
      else segs.push({ desde, hasta, variante })
    }
    return segs
  }, [calc])

  const recomendadaAhora = calc.reduce((a, b) => (b.efectivoUnit < a.efectivoUnit ? b : a)).nombre

  if (loading) return <p className="text-sm text-muted p-4">Cargando panel de costeo…</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">🧮 Panel de costeo de producción</h2>
          <p className="text-[11px] text-faint">Nacional vs. Aéreo vs. Barco · todos los valores editables (hipótesis hasta cargar datos reales)</p>
        </div>
        <button onClick={guardar} disabled={guardando} className="text-xs px-3 py-2 rounded-lg bg-brand text-white font-medium disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar parámetros'}
        </button>
      </div>

      {/* Comunes */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-[10px] uppercase text-faint font-semibold mb-3">Datos comunes</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Campo label="FOB (USD) — aéreo/barco" val={d.fob} onCh={(v) => set('fob', v)} step={0.5} />
          <Campo label="Precio proveedor (USD) — nacional" val={d.precioProveedor} onCh={(v) => set('precioProveedor', v)} step={0.5} />
          <Campo label="Cantidad del pedido (u.)" val={d.cantidad} onCh={(v) => set('cantidad', v)} step={100} />
          <CampoPct label="Tasa financiera anual" val={d.tasaAnual} onCh={(v) => set('tasaAnual', v)} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-black/5">
          <CampoPct label="Arancel (% s/FOB, por NCM)" val={d.arancel} onCh={(v) => set('arancel', v)} />
          <CampoPct label="Tasa estadística (% s/FOB)" val={d.tasaEstadistica} onCh={(v) => set('tasaEstadistica', v)} />
        </div>
        <p className="text-[10px] text-faint mt-2">
          Arancel y tasa estadística dependen de la clasificación (NCM) y el origen — no del método de envío — así que aplican
          igual a aéreo y barco. IVA/percepciones no se cuentan acá (son recuperables).
        </p>
      </div>

      {/* Parámetros por variante */}
      <div className="grid md:grid-cols-3 gap-3">
        <BloqueVariante titulo="🏭 Nacional">
          <CampoPct label="Factor nacional" val={d.factorNacional} onCh={(v) => set('factorNacional', v)} />
          <Campo label="Lead time (días)" val={d.leadNacional} onCh={(v) => set('leadNacional', v)} />
          <Campo label="Costo fijo del pedido (USD)" val={d.fijoNacional} onCh={(v) => set('fijoNacional', v)} step={50} />
        </BloqueVariante>
        <BloqueVariante titulo="✈️ Aéreo (% sobre FOB)">
          <CampoPct label="Flete + seguro" val={d.aFlete} onCh={(v) => set('aFlete', v)} />
          <CampoPct label="Gastos origen/destino" val={d.aGastos} onCh={(v) => set('aGastos', v)} />
          <CampoPct label="Financiero" val={d.aFinanciero} onCh={(v) => set('aFinanciero', v)} />
          <CampoPct label="Contingencia" val={d.aContingencia} onCh={(v) => set('aContingencia', v)} />
          <Campo label="Lead time (días)" val={d.leadAereo} onCh={(v) => set('leadAereo', v)} />
          <Campo label="Costo fijo del pedido (USD)" val={d.fijoAereo} onCh={(v) => set('fijoAereo', v)} step={50} />
        </BloqueVariante>
        <BloqueVariante titulo="🚢 Barco (% sobre FOB)">
          <CampoPct label="Flete + seguro" val={d.bFlete} onCh={(v) => set('bFlete', v)} />
          <CampoPct label="Gastos origen/destino" val={d.bGastos} onCh={(v) => set('bGastos', v)} />
          <CampoPct label="Financiero" val={d.bFinanciero} onCh={(v) => set('bFinanciero', v)} />
          <CampoPct label="Contingencia" val={d.bContingencia} onCh={(v) => set('bContingencia', v)} />
          <Campo label="Lead time (días)" val={d.leadBarco} onCh={(v) => set('leadBarco', v)} />
          <Campo label="Costo fijo del pedido (USD)" val={d.fijoBarco} onCh={(v) => set('fijoBarco', v)} step={50} />
        </BloqueVariante>
      </div>

      {/* Resultados lado a lado */}
      <div className="grid md:grid-cols-3 gap-3">
        {calc.map((c) => {
          const masBarato = Math.abs(c.costoRealUnit - minReal) < 1e-9
          const recomendada = Math.abs(c.efectivoUnit - minEfectivo) < 1e-9
          return (
            <div key={c.key} className={`bg-white rounded-xl p-4 border ${recomendada ? 'border-emerald-300' : 'border-black/10'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">{c.icono} {c.nombre}</p>
                {masBarato && <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 font-medium">más barato</span>}
              </div>
              <p className="text-[10px] text-faint uppercase tracking-wide">Costo real / unidad</p>
              <p className="text-2xl font-bold text-brandDark leading-none">{usd.format(c.costoRealUnit)}</p>
              <div className="mt-3 space-y-1 text-sm">
                <Fila k="Inversión total" v={usd0.format(c.inversionTotal)} />
                <Fila k="Días inmovilizado" v={`${ent.format(c.lead)} días`} />
                <Fila k="Capital inmovilizado" v={c.capital} />
                <Fila k="Costo financiero est." v={usd0.format(c.costoFinanciero)} />
                <div className="pt-1 mt-1 border-t border-black/5">
                  <Fila k="Costo efectivo / unidad" v={usd.format(c.efectivoUnit)} bold />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Recomendación por volumen */}
      <div className="bg-[#F7F5F0] rounded-xl p-4">
        <p className="text-sm font-semibold mb-1">📊 Recomendación por volumen</p>
        <p className="text-[11px] text-faint mb-2">
          Cortes calculados cruzando el costo efectivo (costo + logística + impuestos + financiero) de las tres variantes.
          Para <b>{ent.format(d.cantidad)} u.</b> conviene <b className="text-brandDark">{recomendadaAhora}</b>.
        </p>
        <div className="space-y-1.5">
          {segmentos.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-brand">•</span>
              <span>
                {s.hasta
                  ? `De ${ent.format(s.desde)} a ${ent.format(s.hasta)} u.`
                  : `Más de ${ent.format(s.desde)} u.`}
                : conviene <b>{s.variante}</b>
              </span>
            </div>
          ))}
          {segmentos.length === 1 && (
            <p className="text-[11px] text-faint">
              Con estos parámetros, {segmentos[0].variante} conviene en todo el rango. Cargá costos fijos por pedido para que
              aparezcan cortes por volumen.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Fila({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted text-xs">{k}</span>
      <span className={`shrink-0 ${bold ? 'font-bold text-ink' : 'font-medium text-ink'}`}>{v}</span>
    </div>
  )
}

function BloqueVariante({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <p className="text-xs font-semibold mb-3">{titulo}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Campo({ label, val, onCh, step }: { label: string; val: number; onCh: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] text-faint block mb-0.5">{label}</span>
      <input
        type="number"
        step={step ?? 1}
        value={val}
        onChange={(e) => onCh(parseFloat(e.target.value) || 0)}
        className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-ink"
      />
    </label>
  )
}

// Editor de porcentaje: muestra ×100, guarda fracción.
function CampoPct({ label, val, onCh }: { label: string; val: number; onCh: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-faint block mb-0.5">{label}</span>
      <div className="flex items-center">
        <input
          type="number"
          step={0.5}
          value={Math.round(val * 1000) / 10}
          onChange={(e) => onCh((parseFloat(e.target.value) || 0) / 100)}
          className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-ink"
        />
        <span className="text-xs text-faint ml-1">%</span>
      </div>
    </label>
  )
}
