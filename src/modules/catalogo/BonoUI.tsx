// ── Capa visual del bono de campaña en el catálogo público ──
// Solo se renderiza si el token trae bono (catalogo_bono). Sin bono, el catálogo
// queda exactamente como estaba: los links de vendedores no ven nada de esto.
import { useEffect, useState } from 'react'
import { Gift, Clock, ChevronRight } from 'lucide-react'
import type { BonoCalc, BonoEstado } from './bono'
import { cuentaRegresiva } from './bono'

const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

/** Cuenta regresiva que se refresca sola. */
export function BonoReloj({ vence, className = '' }: { vence: string; className?: string }) {
  const [t, setT] = useState(() => cuentaRegresiva(vence))
  useEffect(() => {
    const id = setInterval(() => setT(cuentaRegresiva(vence)), 1000)
    return () => clearInterval(id)
  }, [vence])
  if (!t) return <span className={className}>vencido</span>
  return <span className={`tabular-nums ${className}`}>{t}</span>
}

/** Franja superior: identidad del beneficio + vencimiento. */
export function BonoBanner({ bono }: { bono: BonoEstado }) {
  return (
    <div className="bg-[#0004FF] text-white text-[11px] text-center py-2 px-3 font-semibold flex items-center justify-center gap-2 flex-wrap">
      <Gift size={13} className="shrink-0" />
      <span>Beneficio exclusivo por comprar desde el catálogo</span>
      <span className="opacity-70">·</span>
      <span className="flex items-center gap-1 opacity-90">
        <Clock size={12} /> vence en <BonoReloj vence={bono.vence_at} />
      </span>
    </div>
  )
}

/** Barra fija abajo: lo ganado, lo que falta para el próximo escalón y el progreso. */
export function BonoBarra({ calc, onVerPares }: { calc: BonoCalc; onVerPares?: () => void }) {
  const { bonificacion, piezas, proximo } = calc
  const ganoAlgo = bonificacion > 0 || piezas > 0

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t-2 border-[#0004FF] shadow-[0_-6px_20px_rgba(0,0,0,0.10)]">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        {ganoAlgo && (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {bonificacion > 0 && (
              <span className="text-[11px] font-bold bg-[#0004FF] text-white rounded-full px-2.5 py-1">
                Bonificación {kAr(bonificacion)} activa
              </span>
            )}
            {piezas > 0 && (
              <button
                onClick={onVerPares}
                className="text-[11px] font-bold bg-emerald-600 text-white rounded-full px-2.5 py-1 flex items-center gap-1"
              >
                {piezas} pares sin cargo · elegilos <ChevronRight size={12} />
              </button>
            )}
          </div>
        )}

        {proximo ? (
          <>
            <p className="text-[12px] leading-snug mb-1.5">
              Sumá <b>{kAr(proximo.falta)}</b>
              <span className="text-neutral-500"> —unos {proximo.pares} pares— </span>
              y te llevás <b className="text-[#0004FF]">{proximo.premio}</b>
            </p>
            <div className="h-2 rounded-full bg-[#0004FF]/10 overflow-hidden">
              <div
                className="h-full bg-[#0004FF] transition-[width] duration-500 ease-out"
                style={{ width: `${Math.round(proximo.progreso * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="text-[12px] font-semibold text-emerald-700">
            Llegaste al máximo beneficio del catálogo. 🎉
          </p>
        )}
      </div>
    </div>
  )
}

/** Cartel de celebración al cruzar un escalón. Se va solo. */
export function BonoCelebra({ texto, onClose }: { texto: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 4200)
    return () => clearTimeout(id)
  }, [onClose])

  return (
    <div className="fixed inset-x-3 top-20 z-50 flex justify-center pointer-events-none">
      <div className="bg-[#0004FF] text-white rounded-xl px-5 py-3.5 shadow-2xl max-w-sm w-full text-center animate-[bonoIn_.35s_ease-out]">
        <p className="text-[10px] tracking-[0.2em] uppercase opacity-75 mb-1">Desbloqueaste</p>
        <p className="text-base font-bold leading-tight">{texto}</p>
      </div>
      <style>{`@keyframes bonoIn{from{opacity:0;transform:translateY(-14px) scale(.96)}to{opacity:1;transform:none}}`}</style>
    </div>
  )
}

/** Resumen dentro del carrito: bonificación, pares y el descuento por efectivo. */
export function BonoResumen({ calc, financieroPct }: { calc: BonoCalc; financieroPct: number }) {
  return (
    <div className="rounded-xl border border-[#0004FF]/25 bg-[#0004FF]/[0.04] p-3 mb-3 space-y-1.5">
      <p className="text-[10px] tracking-[0.18em] uppercase text-[#0004FF] font-bold">Tu beneficio</p>

      {calc.bonificacion > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-600">Bonificación por catálogo</span>
          <span className="font-semibold text-[#0004FF]">− {kAr(calc.bonificacion)}</span>
        </div>
      )}

      {calc.piezas > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-600">Pares sin cargo</span>
          <span className="font-semibold text-emerald-700">{calc.piezas} a elección</span>
        </div>
      )}

      {financieroPct > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-600">Pago en efectivo ({financieroPct}%)</span>
          <span className="font-semibold text-emerald-700">− {kAr(calc.financiero)}</span>
        </div>
      )}

      <div className="flex justify-between pt-1.5 border-t border-[#0004FF]/15">
        <span className="text-sm font-semibold">Pagando en efectivo</span>
        <span className="font-bold text-lg">{kAr(calc.pagaEfectivo)}</span>
      </div>

      <p className="text-[10px] text-neutral-500 leading-snug">
        El descuento por efectivo se liquida como nota de crédito al confirmarse el pago. Los pares
        sin cargo los elegís de Oportunidades y se suman al pedido en $0.
      </p>
    </div>
  )
}
