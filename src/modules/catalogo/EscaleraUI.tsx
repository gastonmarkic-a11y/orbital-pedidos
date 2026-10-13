// ── Escalera por volumen en el carrito: cómo pagar + cuánto falta para el próximo escalón ──
// Se muestra en el catálogo de ópticas cuando no hay pack ni bono de campaña.
import { useEffect, useState, type ReactNode } from 'react'
import { TrendingUp, Plus, Star, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { FotoProd } from './FotoProd'
import { colorLegible } from './colorLegible'
import { CONTADO_PCT, materialDe, type EscaleraCalc } from './escalera'

const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const enumerar = (xs: string[]) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs[0] ?? ''

export interface VarSugerida {
  codigo: string; descripcion: string | null; clasificacion: string | null
  precio: number; caliente: boolean; imagen: string | null; stock: number; proyectado?: boolean
}

/** Resumen de condiciones + elección plazo/contado. */
export function EscaleraResumen({ calc, subtotal, contado, onContado, children }: {
  calc: EscaleraCalc; subtotal: number; contado: boolean | null; onContado: (v: boolean) => void; children?: ReactNode
}) {
  const { actual, proximo } = calc
  const matProx = proximo ? materialDe(proximo.desde) : null
  const matSubio = calc.subio ? materialDe(calc.subio.desde) : null
  return (
    <div className="rounded-xl border border-[#0004FF]/15 bg-[#0004FF]/[0.03] p-3 mb-3 space-y-2">
      {proximo && (
        <div className="flex items-start gap-2 rounded-lg bg-[#0004FF] text-white px-3 py-2">
          {matProx?.img && matProx !== calc.material
            ? <img src={matProx.img} alt={matProx.nombre} className="w-11 h-14 object-cover object-top rounded-md shrink-0 bg-white" />
            : <TrendingUp size={16} className="shrink-0 mt-0.5" />}
          <p className="text-[12px] leading-snug">
            Sumá <b>{calc.faltan} {calc.faltan === 1 ? 'anteojo' : 'anteojos'}</b> y pasás al paquete <b>{proximo.paquete}</b>: 🎁 <b>{enumerar(calc.premioProximo)}</b>.
          </p>
        </div>
      )}
      {calc.subio && (
        <p className="flex items-center gap-2.5 text-[12px] rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2">
          {matSubio?.img && <img src={matSubio.img} alt={matSubio.nombre} className="w-11 h-14 object-cover object-top rounded-md shrink-0" />}
          <span>🎉 ¡Llegaste al paquete <b>{calc.subio.paquete}</b>! Ganaste <b>{enumerar(calc.premioSubio)}</b>.</span>
        </p>
      )}
      {(calc.material || calc.materialProximo) && (
        <div className="rounded-lg bg-white border border-black/10 p-2 text-[12px] leading-snug space-y-2">
          {calc.material && (
            <div className="flex items-center gap-2.5">
              {calc.material.img && <img src={calc.material.img} alt={calc.material.nombre} className="w-12 h-14 object-cover object-top rounded-md shrink-0" />}
              <p>📦 Te llevás para la vidriera: <b>{calc.material.detalle}</b>.</p>
            </div>
          )}
          {calc.materialProximo && (
            <div className="flex items-center gap-2.5">
              {calc.materialProximo.img && <img src={calc.materialProximo.img} alt={calc.materialProximo.nombre} className="w-12 h-14 object-cover object-top rounded-md shrink-0 opacity-90" />}
              <p className="text-neutral-600">
                Sumá <b>{calc.faltanMaterial} {calc.faltanMaterial === 1 ? 'anteojo' : 'anteojos'}</b> y te llevás también <b className="text-[#0004FF]">{calc.materialProximo.nombre}</b>.
              </p>
            </div>
          )}
        </div>
      )}
      {children}
      <div className="text-sm space-y-0.5">
        <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span>{kAr(subtotal)}</span></div>
        {actual.pct > 0 && <div className="flex justify-between"><span className="text-neutral-500">Paquete {actual.paquete} · descuento por volumen {actual.pct}%</span><span className="text-[#0004FF]">− {kAr(calc.descuento)}</span></div>}
      </div>
      <p className="text-[11px] font-semibold text-neutral-600 pt-1">¿Cómo lo querés pagar?</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onContado(false)}
          className={`rounded-lg border px-2.5 py-2 text-left ${contado === false ? 'border-[#0004FF] bg-white ring-2 ring-[#0004FF]/20' : 'border-black/10 bg-white'}`}>
          <span className="block text-[11px] text-neutral-500">A plazo · {calc.plazo}</span>
          <span className="block text-sm font-bold">{kAr(calc.neto)} <span className="text-[10px] font-normal text-neutral-400">+ IVA</span></span>
        </button>
        <button onClick={() => onContado(true)}
          className={`rounded-lg border px-2.5 py-2 text-left ${contado === true ? 'border-emerald-600 bg-white ring-2 ring-emerald-600/20' : 'border-black/10 bg-white'}`}>
          <span className="block text-[11px] text-emerald-700">Contado / transf. −{CONTADO_PCT}%</span>
          <span className="block text-sm font-bold text-emerald-700">{kAr(calc.netoContado)} <span className="text-[10px] font-normal text-neutral-400">+ IVA</span></span>
        </button>
      </div>
    </div>
  )
}

/** Sugerencias para completar el escalón: otros colores de lo que pidió + los que más rotan. */
export function EscaleraSugerencias({ clave, modelosCarrito, modelosTop, enCarrito, faltan, paquete, onAdd }: {
  clave: string; modelosCarrito: string[]; modelosTop: string[]; enCarrito: Record<string, number>
  faltan: number; paquete?: string; onAdd: (v: VarSugerida, modelo: string) => void
}) {
  const [sug, setSug] = useState<{ v: VarSugerida; modelo: string; mismo: boolean }[]>([])
  const key = [...modelosCarrito].sort().join('|') + '#' + modelosTop.join('|')

  useEffect(() => {
    const propios = modelosCarrito.slice(0, 4)
    const top = modelosTop.filter((m) => !propios.includes(m)).slice(0, 4)
    let vivo = true
    Promise.all([...propios, ...top].map((m) =>
      supabase.rpc('catalogo_modelo_v2', { p_clave: clave, p_modelo: m, p_tipo: null, p_clasif: null, p_trat: null })
        .then(({ data }) => ({ m, vs: ((data as VarSugerida[]) ?? []) }))
    )).then((res) => {
      if (!vivo) return
      const out: { v: VarSugerida; modelo: string; mismo: boolean }[] = []
      for (const { m, vs } of res) {
        const mismo = propios.includes(m)
        vs.filter((v) => v.stock > 0 && !v.proyectado && !enCarrito[v.codigo])
          .sort((a, b) => Number(b.caliente) - Number(a.caliente) || Number(!!b.imagen) - Number(!!a.imagen))
          .slice(0, mismo ? 2 : 1)
          .forEach((v) => out.push({ v, modelo: m, mismo }))
      }
      setSug(out.slice(0, 8))
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, key])

  const visibles = sug.filter((s) => !enCarrito[s.v.codigo])
  if (!visibles.length || faltan <= 0) return null
  // Carga automática: reparte las unidades que faltan entre las sugerencias (de a una, sin pasar el stock).
  const plan: { v: VarSugerida; modelo: string }[] = []
  const usados: Record<string, number> = {}
  for (let vuelta = 0; plan.length < faltan && vuelta < faltan; vuelta++) {
    for (const s of visibles) {
      if (plan.length >= faltan) break
      if ((usados[s.v.codigo] ?? 0) >= s.v.stock) continue
      usados[s.v.codigo] = (usados[s.v.codigo] ?? 0) + 1
      plan.push(s)
    }
  }
  return (
    <div>
      {plan.length === faltan && (
        <button onClick={() => plan.forEach((s) => onAdd(s.v, s.modelo))}
          className="w-full mb-2 flex items-center justify-center gap-1.5 rounded-lg bg-[#0004FF] text-white text-[12px] font-bold py-2">
          <Zap size={14} /> Completar {paquete ? `el paquete ${paquete}` : 'el paquete'}: agregar {faltan} {faltan === 1 ? 'anteojo' : 'anteojos'} sugeridos
        </button>
      )}
      <p className="text-[11px] font-semibold text-neutral-600 mb-1.5">Para completar, según lo que pediste y lo que más se vende:</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibles.map(({ v, modelo, mismo }) => (
          <div key={v.codigo} className="shrink-0 w-28 rounded-lg bg-white border border-black/5 p-1.5">
            <div className="relative">
              <FotoProd src={v.imagen} className="w-full h-14 rounded-md bg-white" />
              {!mismo && <span className="absolute top-1 left-1 bg-[#0004FF] text-white text-[8px] font-bold rounded-full px-1.5 py-0.5 flex items-center gap-0.5"><Star size={8} />TOP</span>}
            </div>
            <p className="text-[11px] font-medium truncate mt-1">{modelo}</p>
            <p className="text-[10px] text-neutral-500 truncate">{colorLegible(v.descripcion)}</p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] font-bold text-[#0004FF]">{kAr(v.precio)}</span>
              <button onClick={() => onAdd(v, modelo)} aria-label={`Agregar ${modelo}`}
                className="w-6 h-6 rounded-md bg-[#0004FF] text-white flex items-center justify-center"><Plus size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
