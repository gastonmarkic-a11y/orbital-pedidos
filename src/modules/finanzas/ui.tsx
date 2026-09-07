/* Piezas visuales del módulo financiero.
   Estética "terminal de tesorería": negro, dorado, densa y sin decoración.
   Es el único módulo de la Suite que no sigue la paleta clara: acá se mira plata,
   y la idea es que se lea como un tablero de mesa de dinero, no como un dashboard. */

import { ReactNode } from 'react'
import { Semaforo } from '../../lib/finanzas'

export const FIN = {
  fondo: '#0A0A0B',
  panel: '#111113',
  panelAlto: '#17171A',
  borde: '#26262B',
  bordeSuave: '#1D1D21',
  oro: '#C9A667',
  oroTenue: '#8A7444',
  texto: '#E7E4DD',
  tenue: '#8B8880',
  verde: '#4ADE80',
  ambar: '#FBBF24',
  rojo: '#F87171',
}

export const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: FIN.verde,
  ambar: FIN.ambar,
  rojo: FIN.rojo,
}

/** Marco del módulo: pinta el fondo negro sobre el layout claro de la Suite. */
export function Marco({ children }: { children: ReactNode }) {
  return (
    <div
      className="fin-scope font-inter -mx-3 -mt-3 min-h-screen px-3 pt-3 pb-6 text-[13px]"
      style={{ background: FIN.fondo, color: FIN.texto }}
    >
      {children}
    </div>
  )
}

export function Panel({
  titulo,
  nota,
  derecha,
  children,
  className = '',
}: {
  titulo?: string
  nota?: string
  derecha?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-md border ${className}`}
      style={{ background: FIN.panel, borderColor: FIN.borde }}
    >
      {(titulo || derecha) && (
        <header
          className="flex items-center justify-between gap-3 px-3 py-2 border-b"
          style={{ borderColor: FIN.bordeSuave }}
        >
          <div className="min-w-0">
            {titulo && (
              <h3 className="font-fraunces text-[14px] leading-tight" style={{ color: FIN.texto }}>
                {titulo}
              </h3>
            )}
            {nota && (
              <p className="text-[10.5px] leading-tight mt-0.5" style={{ color: FIN.tenue }}>
                {nota}
              </p>
            )}
          </div>
          {derecha && <div className="shrink-0 flex items-center gap-2">{derecha}</div>}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  )
}

/** Rótulo de sección: versalitas finas, como los encabezados de una terminal. */
export function Rotulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.18em] font-inter font-medium" style={{ color: FIN.tenue }}>
      {children}
    </p>
  )
}

export function Kpi({
  label,
  valor,
  nota,
  estado,
  ref_,
}: {
  label: string
  valor: string
  nota?: string
  estado?: Semaforo
  ref_?: string
}) {
  return (
    <div
      className="rounded-md border px-3 py-2.5 min-w-0"
      style={{ background: FIN.panel, borderColor: FIN.borde }}
    >
      <div className="flex items-center gap-1.5">
        {estado && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: COLOR_SEMAFORO[estado] }}
            title={`Semáforo: ${estado}`}
          />
        )}
        <Rotulo>{label}</Rotulo>
      </div>
      <p
        className="font-jet text-[19px] leading-none mt-1.5 tabular-nums truncate"
        style={{ color: estado ? COLOR_SEMAFORO[estado] : FIN.texto }}
        title={valor}
      >
        {valor}
      </p>
      {(nota || ref_) && (
        <p className="text-[10.5px] mt-1 leading-tight" style={{ color: FIN.tenue }}>
          {nota}
          {ref_ && <span className="font-jet"> · ref {ref_}</span>}
        </p>
      )}
    </div>
  )
}

/** Número tabular. Todo dato numérico del módulo pasa por acá. */
export function N({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`font-jet tabular-nums ${className}`} style={color ? { color } : undefined}>
      {children}
    </span>
  )
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  const c = color ?? FIN.tenue
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border whitespace-nowrap"
      style={{ color: c, borderColor: c + '55', background: c + '14' }}
    >
      {children}
    </span>
  )
}

export function Btn({
  children,
  onClick,
  variante = 'ghost',
  disabled,
  title,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variante?: 'oro' | 'ghost' | 'peligro'
  disabled?: boolean
  title?: string
  className?: string
}) {
  const estilos =
    variante === 'oro'
      ? { background: FIN.oro, color: '#12100B', borderColor: FIN.oro }
      : variante === 'peligro'
        ? { background: 'transparent', color: FIN.rojo, borderColor: FIN.rojo + '66' }
        : { background: 'transparent', color: FIN.texto, borderColor: FIN.borde }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2.5 py-1.5 text-[11.5px] font-medium disabled:opacity-40 ${className}`}
      style={estilos}
    >
      {children}
    </button>
  )
}

export function Campo({
  label,
  value,
  onChange,
  tipo = 'text',
  sufijo,
  placeholder,
  ancho = '',
  nota,
}: {
  label: string
  value: string | number
  onChange: (v: string) => void
  tipo?: string
  sufijo?: string
  placeholder?: string
  ancho?: string
  nota?: string
}) {
  return (
    <label className={`block ${ancho}`}>
      <Rotulo>{label}</Rotulo>
      <div className="flex items-center gap-1 mt-1">
        <input
          type={tipo}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-[12.5px] font-jet tabular-nums outline-none"
          style={{ background: FIN.panelAlto, borderColor: FIN.borde, color: FIN.texto }}
        />
        {sufijo && (
          <span className="text-[11px] shrink-0" style={{ color: FIN.tenue }}>
            {sufijo}
          </span>
        )}
      </div>
      {nota && (
        <p className="text-[10px] mt-1 leading-tight" style={{ color: FIN.tenue }}>
          {nota}
        </p>
      )}
    </label>
  )
}

export function Selector({
  label,
  value,
  onChange,
  opciones,
  ancho = '',
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  opciones: { id: string; label: string }[]
  ancho?: string
}) {
  return (
    <label className={`block ${ancho}`}>
      {label && <Rotulo>{label}</Rotulo>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-2 py-1.5 text-[12px] outline-none ${label ? 'mt-1' : ''}`}
        style={{ background: FIN.panelAlto, borderColor: FIN.borde, color: FIN.texto }}
      >
        {opciones.map((o) => (
          <option key={o.id} value={o.id} style={{ background: FIN.panelAlto }}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Tabla densa: cabecera en versalitas, filas de 28px, números a la derecha. */
export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">{children}</table>
    </div>
  )
}

export function Th({ children, num, ancho }: { children?: ReactNode; num?: boolean; ancho?: string }) {
  return (
    <th
      className={`text-[9.5px] uppercase tracking-[0.14em] font-medium py-1.5 px-2 border-b whitespace-nowrap ${
        num ? 'text-right' : 'text-left'
      } ${ancho ?? ''}`}
      style={{ color: FIN.tenue, borderColor: FIN.borde }}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  num,
  color,
  className = '',
  colSpan,
  title,
}: {
  children: ReactNode
  num?: boolean
  color?: string
  className?: string
  colSpan?: number
  title?: string
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={`py-1.5 px-2 border-b align-middle ${num ? 'text-right font-jet tabular-nums' : ''} ${className}`}
      style={{ borderColor: FIN.bordeSuave, color: color ?? FIN.texto }}
    >
      {children}
    </td>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] text-center py-8" style={{ color: FIN.tenue }}>
      {children}
    </p>
  )
}

/** Aviso al pie de un panel: aclara de dónde sale un número o qué falta cargar. */
export function Nota({ children, tono }: { children: ReactNode; tono?: 'alerta' }) {
  const c = tono === 'alerta' ? FIN.ambar : FIN.tenue
  return (
    <p className="text-[10.5px] leading-snug mt-2" style={{ color: c }}>
      {children}
    </p>
  )
}
