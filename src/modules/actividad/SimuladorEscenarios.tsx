import { useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts'

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

// Una perilla de la consola: slider + valor + rango.
function Perilla({
  icon,
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  icon: string
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div className="bg-[#F8F6F0] rounded-lg p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">
          {icon} {label}
        </span>
        <span className="text-sm font-bold text-brandDark tabular-nums">
          {value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full mt-1.5 accent-[#15151A]"
      />
      {hint && <p className="text-[10px] text-faint leading-tight">{hint}</p>}
    </div>
  )
}

export default function SimuladorEscenarios(props: Props) {
  const baseContactos = Math.max(1, Math.round(props.contactosDia) || 5)
  const baseConv = Math.max(1, Math.round((props.convRate || 0.1) * 100))
  const baseUxv = Math.max(1, Math.round(props.unidadesPorVenta) || 4)
  const basePrecio = Math.max(0, Math.round(props.precioBase ?? 150000))

  const [contactosDia, setContactosDia] = useState(baseContactos)
  const [conv, setConv] = useState(baseConv) // %
  const [uxv, setUxv] = useState(baseUxv)
  const [descuento, setDescuento] = useState(0)
  const [precio, setPrecio] = useState(basePrecio)

  // Modelo: ventas = contactos/día × días hábiles × conversión. Unidades = ventas × unidades/venta.
  const ventasSim = contactosDia * props.habilesMes * (conv / 100)
  const unidadesSim = ventasSim * uxv
  const ingresoSim = unidadesSim * precio * (1 - descuento / 100)

  const ventasBase = baseContactos * props.habilesMes * (baseConv / 100)
  const deltaVentas = ventasSim - ventasBase

  // Coach: cuántos contactos/día harían falta para el objetivo, a la conversión elegida
  const contactosParaObjetivo =
    props.objetivoVentas > 0 && conv > 0 ? props.objetivoVentas / (props.habilesMes * (conv / 100)) : 0

  const data = [
    { name: 'Ritmo actual', ventas: Math.round(ventasBase), fill: '#9B968B' },
    { name: 'Simulado', ventas: Math.round(ventasSim), fill: '#15151A' },
    ...(props.objetivoVentas > 0 ? [{ name: 'Objetivo', ventas: props.objetivoVentas, fill: '#C8A96E' }] : []),
  ]

  function reset() {
    setContactosDia(baseContactos)
    setConv(baseConv)
    setUxv(baseUxv)
    setDescuento(0)
    setPrecio(basePrecio)
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">🎛 Simulador de escenarios</p>
          <p className="text-[11px] text-faint">Mové las perillas y mirá qué pasaría este mes. Arranca de tu ritmo real.</p>
        </div>
        <button onClick={reset} className="text-[11px] text-brandDark font-medium border border-black/10 rounded-lg px-2.5 py-1">
          ↺ Volver a mi ritmo
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Perilla
          icon="📞"
          label="Contactos por día"
          hint={`Tu ritmo actual: ${baseContactos}/día`}
          value={contactosDia}
          min={1}
          max={Math.max(30, baseContactos * 3)}
          step={1}
          onChange={setContactosDia}
        />
        <Perilla
          icon="🎯"
          label="Conversión (contacto→venta)"
          hint="Sube con mejores propuestas, colecciones y zonas"
          value={conv}
          min={1}
          max={60}
          step={1}
          onChange={setConv}
          suffix="%"
        />
        <Perilla
          icon="🕶"
          label="Unidades por venta"
          hint="Sube ofreciendo más modelos / colecciones"
          value={uxv}
          min={1}
          max={40}
          step={1}
          onChange={setUxv}
        />
        <Perilla
          icon="🏷"
          label="Descuento"
          hint="Afecta el ingreso por unidad"
          value={descuento}
          min={0}
          max={40}
          step={1}
          onChange={setDescuento}
          suffix="%"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#F1EDE4] rounded-lg p-2">
          <p className="text-[10px] text-muted uppercase tracking-wide">Ventas / mes</p>
          <p className="text-xl font-bold">{fmtNum(ventasSim)}</p>
          <p className={`text-[10px] font-semibold ${deltaVentas >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {deltaVentas >= 0 ? '+' : ''}
            {fmtNum(deltaVentas)} vs hoy
          </p>
        </div>
        <div className="bg-[#F1EDE4] rounded-lg p-2">
          <p className="text-[10px] text-muted uppercase tracking-wide">Unidades / mes</p>
          <p className="text-xl font-bold">{fmtNum(unidadesSim)}</p>
        </div>
        <div className="bg-[#F1EDE4] rounded-lg p-2">
          <p className="text-[10px] text-muted uppercase tracking-wide">Ingreso est.</p>
          <p className="text-xl font-bold">{fmtMoney(ingresoSim)}</p>
          <p className="text-[10px] text-faint">a ${precio.toLocaleString('es-AR')}/u</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#00000010" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9B968B' }} axisLine={{ stroke: '#00000014' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9B968B' }} axisLine={false} tickLine={false} width={30} />
          <Tooltip cursor={{ fill: '#00000006' }} formatter={(v) => [`${v} ventas`, '']} />
          <Bar dataKey="ventas" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
            <LabelList dataKey="ventas" position="top" fontSize={11} fill="#15151A" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-muted flex items-center gap-1">
          💲 Precio prom./unidad (estimado):
          <input
            type="number"
            value={precio}
            onChange={(e) => setPrecio(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-28 border border-black/10 rounded-md px-2 py-1 text-xs"
          />
        </label>
      </div>

      {props.objetivoVentas > 0 && (
        <div className="bg-brand/5 border border-brand/20 rounded-lg px-3 py-2 text-xs text-ink">
          🧭 <b>Coach:</b> para llegar al objetivo de <b>{props.objetivoVentas}</b> ventas a una conversión del{' '}
          <b>{conv}%</b>, necesitás cerca de <b>{Math.ceil(contactosParaObjetivo)} contactos/día</b>
          {contactosParaObjetivo > contactosDia
            ? ` — hoy estás simulando ${contactosDia}. Subí contactos o mejorá la conversión.`
            : ' — con este escenario ya llegás. 💪'}
        </div>
      )}
    </div>
  )
}
