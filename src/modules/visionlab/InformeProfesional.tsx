// Orbital Vision Lab: vista del profesional (/lab/informe#…). Se abre al escanear el QR del informe: el resultado
// viaja en el fragmento de la URL (no llega al servidor) y no incluye el nombre de la persona.
// Lleva el chequeo visual, el estudio de rostro o los dos (perfil visual): con el rostro, la óptica ve forma, talle
// y medidas para elegir el armazón, como el ticket de JINS que junta medición del rostro y examen.
import { ScanFace, ShieldCheck } from 'lucide-react'
import { acuityLabel, logmar } from './logic'
import { Compacto, deB64url } from './extras'
import type { CalceCompacto, RostroCompacto } from './perfil'
import { FORMAS } from './rostro/medidas'
import './pretest.css'

type Leido = Partial<Compacto> & { f: string; ro?: RostroCompacto; ca?: CalceCompacto[] }

function leer(): Leido | null {
  try {
    const c = JSON.parse(deB64url(window.location.hash.slice(1))) as Leido
    return c && (c.a || c.ro || c.ca?.length) ? c : null
  } catch { return null }
}

const fecha = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

function filasVision(c: Leido): [string, string, string][] {
  if (!c.a || !c.n || !c.s || !c.m || !c.du) return []
  const sn = (b: boolean | null, si: string, no: string) => (b === null ? '—' : b ? si : no)
  return [
    ['Agudeza de lejos', `${(c.d ?? 0) >= 2000 ? (c.x ? '3 m (espejo a 1,5 m)' : '3 m') : '50 cm (estimada)'} · C de Landolt 8 posiciones`,
      `OD ${acuityLabel(c.a[0])} · logMAR ${logmar(c.a[0])}\nOI ${acuityLabel(c.a[1])} · logMAR ${logmar(c.a[1])}`],
    ['Agudeza de cerca', '40 cm · C de Landolt 8 posiciones', `OD ${acuityLabel(c.n[0])}\nOI ${acuityLabel(c.n[1])}`],
    ['Sensibilidad al contraste', 'Binocular · 50 cm', c.k == null ? 'no detectada' : `umbral ${c.k}%`],
    ['Reloj astigmático', '50 cm', `OD ${sn(c.s[0], 'parejo', 'DESPAREJO')} · OI ${sn(c.s[1], 'parejo', 'DESPAREJO')}`],
    ['Visión de color', 'Láminas pseudoisocromáticas rojo-verde', `${c.o}/3`],
    ['Rejilla de Amsler', '30 cm', `OD ${sn(c.m[0], 'normal', 'ALTERADA')} · OI ${sn(c.m[1], 'normal', 'ALTERADA')}`],
    ['Lectura', 'Binocular · 40 cm', c.j === 'J14' ? 'ninguno' : c.j ?? '—'],
    ['Duocromo', '40 cm', `OD ${c.du[0] ?? '—'} · OI ${c.du[1] ?? '—'}`],
    ['Distancia pupilar', 'Tarjeta en la frente + cámara', c.dp ? `lejos ${c.dp[0]} mm · cerca ${c.dp[1]} mm` : 'no medida'],
    ['Ojo dominante', 'Prueba de Miles', c.dom ? (c.dom === 'R' ? 'derecho' : 'izquierdo') : 'no medido'],
  ]
}

function filasRostro(ro: RostroCompacto, dpTarjeta: boolean): [string, string, string][] {
  const info = FORMAS[ro.fo]
  return [
    ['Forma del rostro', 'Malla facial de 478 puntos · 7 prototipos', info?.nombre ?? ro.fo],
    ['Talle de armazón', 'Ancho de frente ≈ ancho de sien a sien', `${ro.t} · ideal ${ro.w} mm (${ro.r[0]}–${ro.r[1]} mm)`],
    ['Medidas del rostro', 'Escala por diámetro de iris · ±5 %', `Pómulos ${ro.mm[0]} mm · largo ${ro.mm[1]} mm\nFrente ${ro.mm[2]} mm · mandíbula ${ro.mm[3]} mm`],
    ...(!dpTarjeta ? [['Distancia pupilar', 'Aproximada por el escaneo', `≈ ${ro.dp} mm (confirmar)`] as [string, string, string]] : []),
    ['Formas que le favorecen', 'Contraste con la forma del rostro', info ? info.si.map((x) => x.e).join(' · ') : '—'],
    ['Formas a evitar', '', info ? info.no.map((x) => x.e).join(' · ') : '—'],
  ]
}

function Tabla({ filas }: { filas: [string, string, string][] }) {
  return (
    <table className="rtable pro">
      <tbody>
        {filas.map(([n, cond, v]) => (
          <tr key={n}><td><div className="nm">{n}</div>{cond && <div className="tx">{cond}</div>}</td><td><div className="vv" style={{ whiteSpace: 'pre-line' }}>{v}</div></td></tr>
        ))}
      </tbody>
    </table>
  )
}

export default function InformeProfesional() {
  const c = leer()
  const vision = c ? filasVision(c) : []
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
            <>
              {vision.length > 0 && (
                <div className="report">
                  <div className="rh">
                    <div>
                      <div className="t">Pretest visual autoadministrado</div>
                      <div className="d">{fecha(c.f)}{c.e ? ` · ${c.e} años` : ''} · {c.u === 'si' ? 'con su corrección' : c.u === 'viejos' ? 'tiene corrección, no la usa' : 'sin corrección'}</div>
                    </div>
                    {c.c && <span className="code">{c.c}</span>}
                  </div>
                  <Tabla filas={vision} />
                  <div className="rf">
                    <b><ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Autoevaluación orientativa, hecha por la persona con su celular</b> (pantalla calibrada con tarjeta, {c.ppi} ppi;
                    índice {c.i}/100, semáforo {c.se}). No es un examen ni un diagnóstico: los valores dependen de la calibración, la luz, la distancia y
                    las respuestas. Sirve como antecedente para la consulta.
                  </div>
                </div>
              )}
              {!vision.length && c.c && (
                <div className="card flat"><p className="small" style={{ margin: 0 }}>Hizo el chequeo visual con el código <b className="num">{c.c}</b>: el detalle está en su informe o en el panel de Orbital.</p></div>
              )}
              {c.ro && (
                <div className="report">
                  <div className="rh">
                    <div>
                      <div className="t"><ScanFace size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />Estudio de rostro · ficha de armazón</div>
                      <div className="d">{fecha(c.f)}</div>
                    </div>
                    <span className="code">Talle {c.ro.t}</span>
                  </div>
                  <Tabla filas={filasRostro(c.ro, !!c.dp)} />
                  <div className="rf">
                    <b>Medidas por escaneo facial con la cámara del celular</b> (escala por el iris, ±5 mm). Guía de estilo y talle: confirmá
                    el calce, la altura de montaje y la DP en la óptica. Con graduación alta conviene un lente más chico.
                  </div>
                </div>
              )}
              {c.ca && c.ca.length > 0 && (
                <div className="report">
                  <div className="rh">
                    <div>
                      <div className="t">Medición de calce en vivo</div>
                      <div className="d">Armazón virtual a escala sobre su cara · calce = ancho del marco / ancho del rostro</div>
                    </div>
                  </div>
                  <Tabla filas={c.ca.map(([m, w, k, p]) => [m, `Frente ${w} mm`, `Calce ${k} % (${k > 103 ? 'grande' : k < 97 ? 'chico' : 'justo'})
Pupila al ${p} % del lente desde la nariz`] as [string, string, string])} />
                  <div className="rf"><b>Calce ideal 97–103 %; pupila ideal 40–60 %.</b> Medición aproximada por cámara: confirmá con el armazón real puesto.</div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
