import { useRef, useState } from 'react'

interface Props {
  contactosDia: number
  convRate: number // 0-1 (contacto → venta)
  unidadesPorVenta: number
  habilesMes: number
  objetivoVentas: number
  precioBase?: number
}

const fmtNum = (n: number) => (isFinite(n) ? Math.round(n).toLocaleString('es-AR') : '—')
const fmtMoney = (n: number) => (isFinite(n) ? '$' + Math.round(n).toLocaleString('es-AR') : '—')

// ── Perilla circular tipo bandeja de DJ (se arrastra vertical para cambiar el valor) ──
function Knob({
  label,
  icon,
  value,
  min,
  max,
  step,
  onChange,
  accent,
  fmt,
}: {
  label: string
  icon: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  accent: string
  fmt?: (v: number) => string
}) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const r = 34
  const c = 2 * Math.PI * r
  const arc = 0.75 // arco de 270°
  const dash = pct * arc * c

  function onDown(e: React.PointerEvent) {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { y: e.clientY, v: value }
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return
    const dy = drag.current.y - e.clientY // arrastrar hacia arriba sube
    const sens = (max - min) / 160
    let nv = drag.current.v + dy * sens
    nv = Math.round(nv / step) * step
    nv = Math.max(min, Math.min(max, nv))
    if (nv !== value) onChange(nv)
  }
  function onUp() {
    drag.current = null
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        width={84}
        height={84}
        viewBox="0 0 90 90"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ touchAction: 'none', cursor: 'ns-resize' }}
      >
        <g transform="rotate(135 45 45)">
          <circle cx={45} cy={45} r={r} fill="none" stroke="#2a2a32" strokeWidth={7} strokeDasharray={`${arc * c} ${c}`} strokeLinecap="round" />
          <circle cx={45} cy={45} r={r} fill="none" stroke={accent} strokeWidth={7} strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
        </g>
        <circle cx={45} cy={45} r={26} fill="#0f0f13" stroke="#2a2a32" />
        <text x={45} y={49} textAnchor="middle" fontSize={15} fontWeight={700} fill="#ffffff">
          {fmt ? fmt(value) : value}
        </text>
      </svg>
      <span className="text-[10px] text-white/70 text-center leading-tight">
        {icon} {label}
      </span>
    </div>
  )
}

// ── Pads de colores (foco de cartera / propuesta) ──
function Pads({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { k: string; label: string; color: string }[]
  value: string
  onChange: (k: string) => void
}) {
  return (
    <div>
      <p className="text-[10px] text-white/50 mb-1 uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.k}
            onClick={() => onChange(o.k)}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all"
            style={
              value === o.k
                ? { background: o.color, color: '#0f0f13', boxShadow: `0 0 10px ${o.color}66` }
                : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SimuladorEscenarios(props: Props) {
  const baseContactos = Math.max(1, Math.round(props.contactosDia) || 5)
  const baseConv = Math.max(1, Math.round((props.convRate || 0.1) * 100))
  const baseUxv = Math.max(1, Math.round(props.unidadesPorVenta) || 4)
  const basePrecio = Math.max(0, Math.round(props.precioBase ?? 150000))

  const [contactosDia, setContactosDia] = useState(baseContactos)
  const [conv, setConv] = useState(baseConv)
  const [uxv, setUxv] = useState(baseUxv)
  const [plazo, setPlazo] = useState(0) // días (0 = contado)
  const [descuento, setDescuento] = useState(12) // arranca 12% como pediste
  const [precio, setPrecio] = useState(basePrecio)
  const [foco, setFoco] = useState('todos')
  const [propuesta, setPropuesta] = useState('general')

  const FOCO: Record<string, number> = { todos: 1, activos: 1.4, recuperar: 1.0, frios: 0.6 }
  const PROP: Record<string, number> = { general: 1, preventa: 1.2, canje: 1.1, bienvenida: 1.05 }
  // Plazo: contado 0.9 → 150 días 1.15 (a más plazo, más fácil el sí). Descuento: leve empujón.
  const plazoM = 0.9 + (Math.min(plazo, 150) / 150) * 0.25
  const descM = 1 + (descuento / 100) * 0.4
  const convEfectiva = Math.min(95, conv * (FOCO[foco] ?? 1) * (PROP[propuesta] ?? 1) * plazoM * descM)

  const ventasSim = contactosDia * props.habilesMes * (convEfectiva / 100)
  const unidadesSim = ventasSim * uxv
  const ingresoSim = unidadesSim * precio * (1 - descuento / 100)
  const ventasBase = baseContactos * props.habilesMes * (baseConv / 100)
  const deltaVentas = ventasSim - ventasBase
  const pctObj = props.objetivoVentas > 0 ? ventasSim / props.objetivoVentas : 0
  const contactosParaObjetivo =
    props.objetivoVentas > 0 && convEfectiva > 0 ? props.objetivoVentas / (props.habilesMes * (convEfectiva / 100)) : 0

  // Medidor radial (gauge) del % de objetivo
  const gp = Math.max(0, Math.min(1, pctObj))
  const gr = 30
  const gc = 2 * Math.PI * gr
  const gaugeColor = pctObj >= 1 ? '#34d399' : pctObj >= 0.7 ? '#f59e0b' : '#f472b6'

  function reset() {
    setContactosDia(baseContactos)
    setConv(baseConv)
    setUxv(baseUxv)
    setPlazo(0)
    setDescuento(12)
    setPrecio(basePrecio)
    setFoco('todos')
    setPropuesta('general')
  }

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'linear-gradient(160deg,#17171c,#0f0f13)' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">🎛 Consola comercial</p>
          <p className="text-[11px] text-white/45">Girá las perillas (arrastrá ↑↓) y tocá los pads. Arranca de tu ritmo real.</p>
        </div>
        <button onClick={reset} className="text-[11px] text-white/70 font-medium border border-white/15 rounded-lg px-2.5 py-1">
          ↺ Mi ritmo
        </button>
      </div>

      {/* Perillas */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
        <Knob icon="📞" label="Contactos/día" value={contactosDia} min={1} max={Math.max(30, baseContactos * 3)} step={1} onChange={setContactosDia} accent="#38bdf8" />
        <Knob icon="🎯" label="Conversión" value={conv} min={1} max={60} step={1} onChange={setConv} accent="#f59e0b" fmt={(v) => `${v}%`} />
        <Knob icon="🕶" label="Unid./venta" value={uxv} min={1} max={40} step={1} onChange={setUxv} accent="#a78bfa" />
        <Knob icon="💳" label="Plazo" value={plazo} min={0} max={150} step={15} onChange={setPlazo} accent="#34d399" fmt={(v) => (v === 0 ? 'Ctdo' : `${v}d`)} />
        <Knob icon="🏷" label="Descuento" value={descuento} min={0} max={40} step={1} onChange={setDescuento} accent="#f472b6" fmt={(v) => `${v}%`} />
      </div>

      {/* Pads */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-white/10 pt-3">
        <Pads
          label="Foco de cartera"
          value={foco}
          onChange={setFoco}
          options={[
            { k: 'todos', label: 'Toda', color: '#94a3b8' },
            { k: 'activos', label: 'Activos', color: '#34d399' },
            { k: 'recuperar', label: 'A recuperar', color: '#f59e0b' },
            { k: 'frios', label: 'Fríos', color: '#38bdf8' },
          ]}
        />
        <Pads
          label="Propuesta / colección"
          value={propuesta}
          onChange={setPropuesta}
          options={[
            { k: 'general', label: 'General', color: '#94a3b8' },
            { k: 'preventa', label: 'Preventa', color: '#a78bfa' },
            { k: 'canje', label: 'Canje', color: '#f472b6' },
            { k: 'bienvenida', label: 'Bienvenida', color: '#38bdf8' },
          ]}
        />
      </div>

      {/* Display tipo LCD + gauge */}
      <div className="flex items-stretch gap-3 border-t border-white/10 pt-3">
        <div className="flex-1 grid grid-cols-3 gap-2">
          {[
            { t: 'VENTAS/MES', v: fmtNum(ventasSim), d: `${deltaVentas >= 0 ? '+' : ''}${fmtNum(deltaVentas)} vs hoy`, dc: deltaVentas >= 0 ? '#34d399' : '#f87171' },
            { t: 'UNIDADES', v: fmtNum(unidadesSim), d: `${uxv} x venta`, dc: '#ffffff80' },
            { t: 'INGRESO EST.', v: fmtMoney(ingresoSim), d: `−${descuento}% desc.`, dc: '#ffffff80' },
          ].map((k) => (
            <div key={k.t} className="rounded-lg px-2 py-2 text-center" style={{ background: '#0b0b0e', border: '1px solid #ffffff14' }}>
              <p className="text-[9px] tracking-wider" style={{ color: '#ffffff55' }}>
                {k.t}
              </p>
              <p className="text-lg font-bold tabular-nums" style={{ color: '#7CF5A0', fontFamily: 'ui-monospace,monospace' }}>
                {k.v}
              </p>
              <p className="text-[9px]" style={{ color: k.dc }}>
                {k.d}
              </p>
            </div>
          ))}
        </div>
        {props.objetivoVentas > 0 && (
          <div className="flex flex-col items-center justify-center px-1">
            <svg width={78} height={78} viewBox="0 0 78 78">
              <g transform="rotate(-90 39 39)">
                <circle cx={39} cy={39} r={gr} fill="none" stroke="#2a2a32" strokeWidth={7} />
                <circle cx={39} cy={39} r={gr} fill="none" stroke={gaugeColor} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${gp * gc} ${gc}`} />
              </g>
              <text x={39} y={36} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">
                {Math.round(pctObj * 100)}%
              </text>
              <text x={39} y={50} textAnchor="middle" fontSize={8} fill="#ffffff70">
                objetivo
              </text>
            </svg>
          </div>
        )}
      </div>

      <p className="text-[10px] text-white/40">
        Conversión efectiva <b className="text-white/70">{convEfectiva.toFixed(1)}%</b> (base {conv}% × palancas). Multiplicadores = supuestos para tantear.
      </p>

      {props.objetivoVentas > 0 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(124,245,160,0.08)', border: '1px solid rgba(124,245,160,0.25)', color: '#d7f5e2' }}>
          🧭 <b>Coach:</b> para el objetivo de <b>{props.objetivoVentas}</b> ventas a {convEfectiva.toFixed(0)}% de conversión efectiva, necesitás ~
          <b>{Math.ceil(contactosParaObjetivo)} contactos/día</b>
          {contactosParaObjetivo > contactosDia ? ` (estás simulando ${contactosDia} — subí contactos o mejorá la propuesta).` : ' — con este escenario ya llegás 💪.'}
        </div>
      )}

      <label className="text-[11px] text-white/50 flex items-center gap-1">
        💲 Precio prom./unidad (estimado):
        <input
          type="number"
          value={precio}
          onChange={(e) => setPrecio(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-28 rounded-md px-2 py-1 text-xs"
          style={{ background: '#0b0b0e', border: '1px solid #ffffff20', color: '#fff' }}
        />
      </label>
    </div>
  )
}
