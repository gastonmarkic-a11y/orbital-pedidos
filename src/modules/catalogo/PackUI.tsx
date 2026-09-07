// ── Carteles del Pack de Bienvenida dentro del catálogo ──
// Solo se renderizan en modo pack (?pack=bienvenida). Sin ese modo el catálogo
// queda exactamente como estaba.
import { Gift, ChevronRight, Check } from 'lucide-react'
import type { PackCalc } from './pack'
import { PACK_MIN_LINEA } from './pack'

const AZUL = '#0004FF'

/** Franja superior: qué es esto. */
export function PackBanner() {
  return (
    <div className="bg-[#0004FF] text-white text-[11px] text-center py-2 px-3 font-semibold flex items-center justify-center gap-2 flex-wrap">
      <Gift size={13} className="shrink-0" />
      <span>Estás armando tu Pack de Bienvenida</span>
      <span className="opacity-70">·</span>
      <span className="opacity-90">desde 12 de línea sumás piezas sin cargo de Oportunidades</span>
    </div>
  )
}

/** Cartel de arranque: los tres pasos, en la home del catálogo. */
export function PackPasos({ calc, onVerOportunidades }: { calc: PackCalc; onVerOportunidades: () => void }) {
  const pasos = [
    {
      n: '01',
      titulo: `Elegí al menos ${PACK_MIN_LINEA} piezas de línea`,
      texto: 'Navegá las secciones y sumá los modelos que querés en tu exhibidor. Son las que forman tu pack.',
      hecho: calc.linea >= PACK_MIN_LINEA,
    },
    {
      n: '02',
      titulo: 'Sumá tus piezas sin cargo de Oportunidades',
      texto: 'Cada 4 de línea te llevás 1 sin cargo. Las piezas sin cargo salen siempre de la sección Oportunidades —no de línea— y entran al pedido en $0.',
      hecho: calc.sinCargo > 0 && calc.faltanElegir === 0,
    },
    {
      n: '03',
      titulo: 'Enviá el pedido',
      texto: 'Tu vendedor lo revisa, confirma el precio del pack y coordina la entrega del exhibidor.',
      hecho: false,
    },
  ]

  return (
    <div className="rounded-2xl border border-[#0004FF]/20 bg-[#0004FF]/[0.04] p-4 sm:p-5">
      <p className="text-[10px] tracking-[0.18em] uppercase font-bold" style={{ color: AZUL }}>Cómo armás tu pack</p>
      <h2 className="text-base sm:text-lg font-bold mt-1 mb-3">Tres pasos y lo tenés listo.</h2>
      <div className="space-y-2.5">
        {pasos.map((p) => (
          <div key={p.n} className="flex gap-3">
            <span
              className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
                p.hecho ? 'bg-emerald-600 text-white' : 'bg-white border border-[#0004FF]/30 text-[#0004FF]'
              }`}
            >
              {p.hecho ? <Check size={13} /> : p.n}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight">{p.titulo}</p>
              <p className="text-[12px] text-neutral-600 leading-relaxed mt-0.5">{p.texto}</p>
            </div>
          </div>
        ))}
      </div>
      {/* El mínimo no es una barrera de compra: es la condición del beneficio.
          Decirlo evita que alguien crea que no puede pedir menos y abandone. */}
      <p className="text-[11.5px] text-neutral-500 leading-relaxed mt-3 pt-3 border-t border-[#0004FF]/10">
        ¿Querés llevar menos de {PACK_MIN_LINEA}? Podés, el pedido se hace igual y sin problema.
        Lo único es que por debajo de {PACK_MIN_LINEA} piezas de línea no se activan las piezas
        sin cargo del Pack de Bienvenida.
      </p>
      {calc.sinCargo > 0 && (
        <button
          onClick={onVerOportunidades}
          className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-[12px] font-bold px-4 py-2.5"
        >
          Elegir mis {calc.sinCargo} piezas sin cargo en Oportunidades <ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}

/** Barra fija abajo: el contador vivo de línea → sin cargo. */
export function PackBarra({ calc, onVerOportunidades }: { calc: PackCalc; onVerOportunidades: () => void }) {
  const arrancando = calc.linea === 0

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t-2 border-[#0004FF] shadow-[0_-6px_20px_rgba(0,0,0,0.10)]">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] font-bold bg-[#0004FF] text-white rounded-full px-2.5 py-1">
            {calc.linea} de línea
          </span>
          {calc.sinCargo > 0 && (
            <button
              onClick={onVerOportunidades}
              className="text-[11px] font-bold bg-emerald-600 text-white rounded-full px-2.5 py-1 flex items-center gap-1"
            >
              {calc.sinCargo} sin cargo de oportunidad
              {calc.faltanElegir > 0 ? ` · elegí ${calc.faltanElegir}` : ' · elegidas'}
              <ChevronRight size={12} />
            </button>
          )}
          {calc.seFacturan > 0 && (
            <span className="text-[11px] font-semibold text-neutral-500">
              +{calc.seFacturan} de oportunidad se facturan
            </span>
          )}
        </div>

        <p className="text-[12px] leading-snug mb-1.5">
          {arrancando ? (
            <>
              Sumá <b>{PACK_MIN_LINEA} piezas de línea</b> y te llevás{' '}
              <b className="text-[#0004FF]">3 sin cargo de Oportunidades</b>
            </>
          ) : (
            <>
              Sumá <b>{calc.faltaLinea} {calc.faltaLinea === 1 ? 'pieza' : 'piezas'} de línea</b>
              {calc.sinCargo > 0 ? ' y pasás a ' : ' y desbloqueás '}
              <b className="text-[#0004FF]">{calc.proximoSinCargo} sin cargo de Oportunidades</b>
            </>
          )}
        </p>
        <div className="h-2 rounded-full bg-[#0004FF]/10 overflow-hidden">
          <div
            className="h-full bg-[#0004FF] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round(calc.progreso * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/** Resumen dentro del carrito: qué se factura y qué va en $0. */
export function PackResumen({ calc }: { calc: PackCalc }) {
  return (
    <div className="rounded-xl border border-[#0004FF]/25 bg-[#0004FF]/[0.04] p-3 mb-3 space-y-1.5">
      <p className="text-[10px] tracking-[0.18em] uppercase text-[#0004FF] font-bold">Tu pack de bienvenida</p>

      <div className="flex justify-between text-sm">
        <span className="text-neutral-600">Piezas de línea</span>
        <span className="font-semibold">{calc.linea}</span>
      </div>

      <div className="flex justify-between text-sm">
        <span className="text-neutral-600">Piezas sin cargo — de Oportunidades</span>
        <span className="font-semibold text-emerald-700">{calc.sinCargo}</span>
      </div>

      {calc.eligio > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-600">Ya elegiste de Oportunidades</span>
          <span className="font-semibold">{calc.eligio} en $0</span>
        </div>
      )}

      {calc.faltanElegir > 0 && (
        <p className="text-[11px] font-semibold text-emerald-700 leading-snug">
          {calc.faltanElegir === 1
            ? 'Te queda 1 pieza sin cargo por elegir de Oportunidades.'
            : `Te quedan ${calc.faltanElegir} piezas sin cargo por elegir de Oportunidades.`}
        </p>
      )}

      {calc.seFacturan > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-600">Oportunidades que se facturan</span>
          <span className="font-semibold">{calc.seFacturan}</span>
        </div>
      )}

      {calc.linea < 12 && (
        <p className="text-[11px] text-neutral-500 leading-snug">
          Con {12 - calc.linea} {12 - calc.linea === 1 ? 'pieza' : 'piezas'} más de línea llegás a las 12 y
          desbloqueás 3 sin cargo.
        </p>
      )}

      <p className="text-[10px] text-neutral-500 leading-snug pt-1 border-t border-[#0004FF]/15">
        Las piezas sin cargo se eligen de <b>Oportunidades</b> —no de línea— y van al pedido en $0. Tu
        vendedor confirma el pack y coordina la entrega del exhibidor y el material POP.
      </p>
    </div>
  )
}
