// Orbital Vision Lab: vista del profesional (/lab/informe#…). Se abre al escanear el QR del informe: el resultado
// viaja en el fragmento de la URL (no llega al servidor) y no incluye el nombre de la persona.
import { ShieldCheck } from 'lucide-react'
import { acuityLabel, logmar } from './logic'
import { Compacto, deB64url } from './extras'
import './pretest.css'

function leer(): Compacto | null {
  try { return JSON.parse(deB64url(window.location.hash.slice(1))) as Compacto } catch { return null }
}

export default function InformeProfesional() {
  const c = leer()
  const sn = (b: boolean | null, si: string, no: string) => (b === null ? '—' : b ? si : no)
  const filas: [string, string, string][] = c ? [
    ['Agudeza de lejos', `${c.d >= 2000 ? (c.x ? '3 m (espejo a 1,5 m)' : '3 m') : '50 cm (estimada)'} · C de Landolt 8 posiciones`,
      `OD ${acuityLabel(c.a[0])} · logMAR ${logmar(c.a[0])}\nOI ${acuityLabel(c.a[1])} · logMAR ${logmar(c.a[1])}`],
    ['Agudeza de cerca', '40 cm · C de Landolt 8 posiciones', `OD ${acuityLabel(c.n[0])}\nOI ${acuityLabel(c.n[1])}`],
    ['Sensibilidad al contraste', 'Binocular · 50 cm', c.k === null ? 'no detectada' : `umbral ${c.k}%`],
    ['Reloj astigmático', '50 cm', `OD ${sn(c.s[0], 'parejo', 'DESPAREJO')} · OI ${sn(c.s[1], 'parejo', 'DESPAREJO')}`],
    ['Visión de color', 'Láminas pseudoisocromáticas rojo-verde', `${c.o}/3`],
    ['Rejilla de Amsler', '30 cm', `OD ${sn(c.m[0], 'normal', 'ALTERADA')} · OI ${sn(c.m[1], 'normal', 'ALTERADA')}`],
    ['Lectura', 'Binocular · 40 cm', c.j === 'J14' ? 'ninguno' : c.j ?? '—'],
    ['Duocromo', '40 cm', `OD ${c.du[0] ?? '—'} · OI ${c.du[1] ?? '—'}`],
    ['Distancia pupilar', 'Tarjeta en la frente + cámara', c.dp ? `lejos ${c.dp[0]} mm · cerca ${c.dp[1]} mm` : 'no medida'],
    ['Ojo dominante', 'Prueba de Miles', c.dom ? (c.dom === 'R' ? 'derecho' : 'izquierdo') : 'no medido'],
  ] : []
  return (
    <div className="ovl">
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <div className="logo"><b>ORBITAL</b><span>Vision Lab</span></div>
            <span className="side">Vista profesional</span>
          </div>
        </header>
        <section className="step">
          {!c ? (
            <div className="card"><p style={{ margin: 0 }}>No pudimos leer este informe. Pedile a la persona que vuelva a mostrar el código QR de su informe.</p></div>
          ) : (
            <div className="report">
              <div className="rh">
                <div>
                  <div className="t">Pretest visual autoadministrado</div>
                  <div className="d">{new Date(c.f + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}{c.e ? ` · ${c.e} años` : ''} · {c.u === 'si' ? 'con su corrección' : c.u === 'viejos' ? 'tiene corrección, no la usa' : 'sin corrección'}</div>
                </div>
                <span className="code">{c.c}</span>
              </div>
              <table className="rtable">
                <tbody>
                  {filas.map(([n, cond, v]) => (
                    <tr key={n}><td><div className="nm">{n}</div><div className="tx">{cond}</div></td><td><div className="vv" style={{ whiteSpace: 'pre-line' }}>{v}</div></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="rf">
                <b><ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Autoevaluación orientativa, hecha por la persona con su celular</b> (pantalla calibrada con tarjeta, {c.ppi} ppi;
                índice {c.i}/100, semáforo {c.se}). No es un examen ni un diagnóstico: los valores dependen de la calibración, la luz, la distancia y
                las respuestas. Sirve como antecedente para la consulta.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
