// Orbital Vision Lab: piezas del informe y del inicio que no son pruebas de agudeza.
// - Hábitos (alimentan la sugerencia de cristales).
// - Duocromo rojo-verde, ojo dominante, QR para el profesional, recordatorio del próximo control e historial local.
import { Dispatch, ReactNode, SetStateAction, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { CalendarPlus, Check, History, QrCode } from 'lucide-react'
import { acuityLabel, Duo, Eye as Ojo, Habitos, NearId, Resultados, Usa } from './logic'

// ────────────────────────────────────────────────────────────────────────────────────────────
/** Cuestionario de hábitos (como el "Vision Profile" de Zeiss). Todo opcional. */
export function CuestionarioHabitos({ h, set }: { h: Habitos; set: Dispatch<SetStateAction<Habitos>> }) {
  const fila = <K extends keyof Habitos>(k: K, titulo: string, ops: [Habitos[K], string][]) => (
    <div>
      <label>{titulo}</label>
      <div className="chips2" role="radiogroup" aria-label={titulo}>
        {ops.map(([v, t]) => (
          <button key={t} type="button" role="radio" aria-checked={h[k] === v} className={h[k] === v ? 'sel' : ''} onClick={() => set((x) => ({ ...x, [k]: x[k] === v ? null : v }))}>{t}</button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="card field">
      <div>
        <h3 style={{ margin: 0 }}>Tu día a día <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>(opcional)</span></h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Con esto te sugerimos los cristales que mejor van con tu rutina.</p>
      </div>
      {fila('pantalla', 'Horas por día frente a pantallas', [['poco', 'Menos de 2'], ['medio', '2 a 6'], ['mucho', 'Más de 6']])}
      {fila('noche', '¿Manejás de noche?', [[true, 'Sí'], [false, 'No']])}
      {fila('sol', '¿Pasás mucho tiempo al sol?', [[true, 'Sí'], [false, 'No']])}
      {fila('control', '¿Cuándo fue tu último control visual?', [['reciente', 'Hace menos de 1 año'], ['1-2', '1 a 2 años'], ['mas2', 'Más de 2 años'], ['nunca', 'Nunca']])}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Duocromo: anillos negros sobre medio rojo y medio verde. Con la graduación justa se ven igual de nítidos.
export function Duocromo({ px }: { px: number }) {
  const anillos = (k: string) => (
    <div className="duo-lado" key={k}>
      {[1, 0.7, 0.5].map((f) => (
        <svg key={f} width={px * f} height={px * f} viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="4" fill="none" stroke="#000" strokeWidth="1" />
          <circle cx="5" cy="5" r="1.6" fill="none" stroke="#000" strokeWidth="1" />
        </svg>
      ))}
    </div>
  )
  return (
    <div className="duo" aria-label="Mitad roja y mitad verde con anillos negros">
      <div className="r">{anillos('r')}</div>
      <div className="g">{anillos('g')}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Ojo dominante (prueba de Miles): curiosidad que sirve al óptico para centrar multifocales y para deportes.
export function OjoDominante({ valor, onListo }: { valor: Ojo | null; onListo: (o: Ojo) => void }) {
  const [paso, setPaso] = useState(valor ? 2 : 0)
  return (
    <div className="card flat extra">
      <div className="hd"><b>Tu ojo dominante</b><span className="tag">1 minuto</span></div>
      {paso === 0 && (
        <>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Estirá los brazos y juntá las manos formando un triángulo chico entre los pulgares y los índices.</li>
            <li>Con los dos ojos abiertos, encuadrá en el triángulo algo lejano (un picaporte, un cuadro).</li>
            <li>Sin mover las manos, cerrá el ojo izquierdo.</li>
          </ol>
          <button className="btn ghost" onClick={() => setPaso(1)}>Listo, cerré el izquierdo</button>
        </>
      )}
      {paso === 1 && (
        <>
          <p className="small" style={{ margin: 0 }}>¿El objeto <b>sigue dentro</b> del triángulo?</p>
          <div className="answers2">
            <button className="btn ghost" onClick={() => { onListo('R'); setPaso(2) }}>Sí, sigue</button>
            <button className="btn ghost" onClick={() => { onListo('L'); setPaso(2) }}>No, se movió</button>
          </div>
        </>
      )}
      {paso === 2 && valor && (
        <p className="small" style={{ margin: 0 }}>Tu ojo dominante es el <b>{valor === 'R' ? 'derecho' : 'izquierdo'}</b>. Contáselo al óptico: lo usa para centrar los multifocales. <button className="inline-link" onClick={() => setPaso(0)}>Repetir</button></p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// QR para el profesional: abre /lab/informe con el resultado en el fragmento (#…). El fragmento no viaja al
// servidor ni queda en logs, y no lleva el nombre. Sirve sin internet del lado de la óptica salvo para cargar la página.
export interface Compacto {
  c: string; f: string; e: number | null; u: Usa; x: 0 | 1; d: number
  a: [number | null, number | null]; n: [number | null, number | null]; k: number | null
  s: [boolean | null, boolean | null]; o: number; m: [boolean | null, boolean | null]; j: NearId | null
  du: [Duo | null, Duo | null]; dp: [number, number] | null; i: number; se: string; dom: Ojo | null; ppi: number
}

export function compactar(S: Resultados, code: string, edad: number | null, usa: Usa, indice: number, semaforo: string, dom: Ojo | null): Compacto {
  return {
    c: code, f: new Date().toISOString().slice(0, 10), e: edad, u: usa, x: S.espejo ? 1 : 0, d: S.distMm,
    a: [S.acuity.R, S.acuity.L], n: [S.acuityNear.R, S.acuityNear.L], k: S.contrast, s: [S.astig.R, S.astig.L],
    o: S.colorHits, m: [S.amsler.R, S.amsler.L], j: S.near, du: [S.duo.R, S.duo.L],
    dp: S.dp ? [S.dp.lejos, S.dp.cerca] : null, i: indice, se: semaforo, dom, ppi: Math.round(S.pxPerMm * 25.4),
  }
}
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const deB64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))
export const urlProfesional = (c: Compacto) => `${window.location.origin}/lab/informe#${b64url(JSON.stringify(c))}`

export function QRProfesional({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#17171c', light: '#ffffff' } }).then(setSrc).catch(() => setSrc(null))
  }, [url])
  return (
    <div className="qrbox">
      {src ? <img src={src} alt="Código QR con el resultado para el profesional" /> : <QrCode size={64} />}
      <div>
        <b>Para tu óptico u oftalmólogo</b>
        <span className="muted small">Que escanee este código: ve el resultado completo, prueba por prueba, en su celular. No incluye tu nombre.</span>
        <a className="inline-link small no-print" href={url} target="_blank" rel="noopener">Ver cómo lo ve el profesional</a>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Recordatorio del próximo control: un evento de calendario (.ics) que la persona agrega a su agenda.
export function Recordatorio({ meses }: { meses: number }) {
  const [listo, setListo] = useState(false)
  const bajar = () => {
    const d = new Date()
    d.setMonth(d.getMonth() + meses)
    const f = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, '')
    const fin = new Date(d)
    fin.setDate(fin.getDate() + 1)
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbital Eyewear//Vision Lab//ES', 'BEGIN:VEVENT',
      `UID:${Date.now()}@lab.orbitaleyewear.com.ar`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${f(d)}`, `DTEND;VALUE=DATE:${f(fin)}`,
      'SUMMARY:Control visual', `DESCRIPTION:Repetí el chequeo en ${window.location.origin}/lab/pretest y pedí turno con tu oftalmólogo.`,
      'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:Control visual', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    a.download = 'control-visual.ics'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setListo(true)
  }
  return (
    <button className="btn ghost" onClick={bajar}>
      {listo ? <Check size={16} /> : <CalendarPlus size={16} />}
      {listo ? 'Agregado: abrilo para guardarlo en tu calendario' : `Recordarme el próximo control (en ${meses === 12 ? '1 año' : meses + ' meses'})`}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Historial en este celular (localStorage): si repite el chequeo, ve cómo le dio la vez anterior. Sin alertas de
// cambio (eso ya sería diagnóstico): solo los valores lado a lado.
export interface Registro { f: string; a: [number | null, number | null]; n: [number | null, number | null]; k: number | null; m: [boolean | null, boolean | null] }
const CLAVE = 'ovl-historial-v1'
export function leerHistorial(): Registro[] {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as Registro[] } catch { return [] }
}
export function guardarEnHistorial(S: Resultados) {
  try {
    const r: Registro = { f: new Date().toISOString(), a: [S.acuity.R, S.acuity.L], n: [S.acuityNear.R, S.acuityNear.L], k: S.contrast, m: [S.amsler.R, S.amsler.L] }
    localStorage.setItem(CLAVE, JSON.stringify([...leerHistorial(), r].slice(-10)))
  } catch { /* sin almacenamiento: no pasa nada */ }
}

export function Evolucion({ previos, S }: { previos: Registro[]; S: Resultados }) {
  if (!previos.length) return null
  const ant = previos[previos.length - 1]
  const fecha = new Date(ant.f).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
  const ag = (v: number | null) => acuityLabel(v).split(' ')[0]
  const par = (a: number | null, b: number | null) => `${ag(a)} / ${ag(b)}`
  const rej = (m: [boolean | null, boolean | null]) => m.map((x) => (x === null ? '—' : x ? 'normal' : 'alterada')).join(' / ')
  const fila = (t: string, a: ReactNode, b: ReactNode) => <tr key={t}><td>{t}</td><td className="num">{a}</td><td className="num">{b}</td></tr>
  return (
    <div className="card flat extra">
      <div className="hd"><b><History size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Tu evolución</b><span className="tag">{previos.length + 1} chequeos en este celular</span></div>
      <table className="evo">
        <thead><tr><th>OD / OI</th><th>{fecha}</th><th>Hoy</th></tr></thead>
        <tbody>
          {fila('Lejos', par(ant.a[0], ant.a[1]), par(S.acuity.R, S.acuity.L))}
          {fila('Cerca', par(ant.n[0], ant.n[1]), par(S.acuityNear.R, S.acuityNear.L))}
          {fila('Contraste', ant.k === null ? '—' : ant.k + '%', S.contrast === null ? '—' : S.contrast + '%')}
          {fila('Rejilla', rej(ant.m), rej([S.amsler.R, S.amsler.L]))}
        </tbody>
      </table>
      <p className="muted small" style={{ margin: 0 }}>Cambios chicos son normales (luz, distancia, cansancio). Si algo te preocupa, llevá los dos resultados a la consulta.</p>
    </div>
  )
}
