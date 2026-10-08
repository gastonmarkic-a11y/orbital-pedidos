// Orbital Vision Lab · Tu perfil visual (/lab, y en la Suite /vision-lab/perfil): las tres herramientas en un lugar,
// todas desde el celular, que se retroalimentan entre sí —
//  1. Estudio de rostro: forma, medidas y talle  → ordena los armazones del calce y del informe.
//  2. Medición de calce: el armazón puesto, calce % y pupila en el lente (tipo tablet de JINS) → va al QR y al informe.
//  3. Chequeo visual previo a la consulta: agudeza, DP con tarjeta… → la DP afina la medición de calce.
// Un solo QR le muestra a la óptica todo junto. /lab con parámetros (?o=, ?src=) sigue abriendo el chequeo visual.
import { useEffect, useState } from 'react'
import { ArrowRight, Check, Eye, Glasses, MapPin, ScanFace, ShieldCheck, Stethoscope, Store } from 'lucide-react'
import { QRProfesional, urlPerfil } from './extras'
import { Perfil, avance, compactarCalces, compactarRostro, dpDelPerfil, guardarReceta, leerPerfil, marcoDelPerfil } from './perfil'
import Grosor from './Grosor'
import { Receta, recetaVacia } from './marcos'
import Calce from './rostro/Calce'
import { FORMAS } from './rostro/medidas'
import './pretest.css'
import './rostro/rostro.css'

const SEM = { verde: 'Sin alertas', amarillo: 'Revisar en la consulta', rojo: 'Consultar pronto' } as Record<string, string>

export default function Lab({ enSuite = false }: { enSuite?: boolean }) {
  const [perfil, setPerfil] = useState<Perfil>(leerPerfil)
  const [calce, setCalce] = useState(false)
  useEffect(() => {
    const f = () => setPerfil(leerPerfil())
    window.addEventListener('focus', f); window.addEventListener('storage', f)
    return () => { window.removeEventListener('focus', f); window.removeEventListener('storage', f) }
  }, [])
  const base = enSuite ? '/vision-lab' : '/lab'
  const n = avance(perfil)
  const { rostro, vision, calces } = perfil
  const reales = calces?.filter((c) => c.modelo !== 'Tu talle ideal')
  const mejor = calces?.length ? [...(reales?.length ? reales : calces)].sort((a, b) => Math.abs(a.calce - 100) - Math.abs(b.calce - 100))[0] : null
  const qr = n ? urlPerfil({ c: vision?.code, ro: rostro ? compactarRostro(rostro) : undefined, ca: compactarCalces(calces) }) : null

  const pasos = [
    {
      k: 'rostro', n: 1, ic: <ScanFace size={22} />, t: 'Estudio de rostro', d: 'Forma de tu cara, medidas en mm y tu talle de armazón.', dur: '10 s',
      hecho: !!rostro, res: rostro && <>Rostro <b>{FORMAS[rostro.forma].nombre.toLowerCase()}</b> · talle <b>{rostro.talle}</b> · ideal <b className="num">{rostro.ideal} mm</b></>,
      href: `${base}/rostro${enSuite ? '' : '?desde=perfil'}`, cta: rostro ? 'Ver o repetir' : 'Escanear mi rostro',
      da: 'Le da al calce tu ancho ideal y los modelos que van con tu forma.',
    },
    {
      k: 'calce', n: 2, ic: <Glasses size={22} />, t: 'Medición de calce', d: 'Te ponés el armazón en vivo y medimos si te queda: marco vs. rostro y la pupila en el lente.', dur: '1 min',
      hecho: !!calces?.length, res: mejor && <><b>{calces!.length}</b> medido{calces!.length > 1 ? 's' : ''} · mejor <b>{mejor.modelo}</b> al <b className="num">{mejor.calce} %</b></>,
      onClick: () => setCalce(true), cta: calces?.length ? 'Medir otro' : 'Medir el calce',
      da: 'Va al QR para la óptica y marca los armazones de tu informe.',
    },
    {
      k: 'vision', n: 3, ic: <Eye size={22} />, t: 'Chequeo visual previo', d: 'Siete pruebas para llegar a la consulta con el oftalmólogo con un informe orientativo.', dur: '10 min',
      hecho: !!vision, res: vision && <>Código <b className="num">{vision.code}</b> · {SEM[vision.semaforo] ?? vision.semaforo}{vision.dp ? <> · DP <b className="num">{vision.dp.lejos.toFixed(1).replace('.', ',')} mm</b></> : null}</>,
      href: `${base}/pretest${enSuite ? '' : '?desde=perfil'}`, cta: vision ? 'Repetir el chequeo' : 'Hacer el chequeo',
      da: 'Su DP medida con tarjeta afina la posición de la pupila en el calce.',
    },
  ]

  return (
    <div className={'ovl rs' + (enSuite ? ' en-suite' : '')}>
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <div className="logo"><b>ORBITAL</b><span>Vision Lab</span></div>
            <span className="side">Tu perfil visual · {n}/3</span>
          </div>
        </header>
        <section className="step">
          <div className="lab-hero">
            <div>
              <div className="kicker"><ShieldCheck size={15} />Todo desde tu celular, gratis y sin registrarte</div>
              <h1>Tu perfil visual: rostro, calce y visión.</h1>
              <p>Tres herramientas que se pasan los datos entre sí. Cuantas más hagas, más precisa es cada una, y tu óptica lo ve todo junto con un solo código.</p>
            </div>
            <div className="lab-ring" aria-label={`${n} de 3 listas`}>
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(23,23,28,.08)" strokeWidth="9" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#8f6a34" strokeWidth="9" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={264 - (264 * n) / 3} transform="rotate(-90 50 50)" />
              </svg>
              <b className="num">{n}<small>/3</small></b>
            </div>
          </div>

          <ol className="lab-pasos">
            {pasos.map((p, i) => (
              <li key={p.k} className={p.hecho ? 'ok' : ''}>
                <div className="lab-ic">{p.hecho ? <Check size={20} /> : p.ic}</div>
                <div className="lab-tx">
                  <div className="lab-h"><b>{p.n}. {p.t}</b><small>{p.dur}</small></div>
                  <p>{p.res ?? p.d}</p>
                  <small className="lab-da"><ArrowRight size={12} />{p.da}</small>
                  {p.href
                    ? <a className={'btn' + (p.hecho ? ' ghost' : '')} href={p.href}>{p.cta}</a>
                    : <button className={'btn' + (p.hecho ? ' ghost' : '')} onClick={p.onClick}>{p.cta}</button>}
                </div>
                {i < pasos.length - 1 && <i className="lab-link" aria-hidden />}
              </li>
            ))}
          </ol>

          {calces && calces.length > 0 && (
            <div className="card">
              <div className="rs-h"><h3>Armazones medidos</h3><small className="muted">Calce ideal 97–103 %</small></div>
              <table className="lab-tabla">
                <thead><tr><th>Modelo</th><th>Marco</th><th>Calce</th><th>Pupila</th></tr></thead>
                <tbody>
                  {calces.map((c) => (
                    <tr key={c.modelo}>
                      <td>{c.modelo}</td><td className="num">{c.marco} mm</td>
                      <td><span className={'lab-pill ' + c.veredicto}>{c.calce} %</span></td><td className="num">{c.pupila} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="rs-h"><h3>¿Ya tenés receta?</h3><small className="muted">Calculamos el grosor de tus cristales</small></div>
            <div className="lab-rx">
              {([['esfOD', 'Esfera OD', '-2,50'], ['cilOD', 'Cilindro OD', '-0,75'], ['ejeOD', 'Eje OD (°)', '180'], ['esfOI', 'Esfera OI', '-2,25'], ['cilOI', 'Cilindro OI', '-1,00'], ['ejeOI', 'Eje OI (°)', '10'], ['add', 'Adición', '+1,50']] as [keyof Receta, string, string][]).map(([k, t, ph]) => (
                <label key={k}><small>{t}</small><input inputMode="decimal" placeholder={ph} value={(perfil.receta ?? recetaVacia)[k] ?? ''}
                  onChange={(e) => setPerfil(guardarReceta({ ...(perfil.receta ?? recetaVacia), [k]: e.target.value }))} /></label>
              ))}
            </div>
            {perfil.receta && <Grosor rec={perfil.receta} marco={marcoDelPerfil(perfil).ancho} modelo={marcoDelPerfil(perfil).modelo} dp={dpDelPerfil(perfil)} ideal={perfil.rostro?.ideal} />}
            <p className="muted small" style={{ margin: 0 }}>Copiá los valores de la receta tal cual (con el signo). Quedan solo en tu celular.</p>
          </div>

          {qr && (
            <div className="card">
              <QRProfesional url={qr} titulo="Tu perfil para la óptica"
                texto={`Mostrale este código: ve ${[rostro && 'tu rostro', calces?.length && 'los armazones que mediste', vision && `tu chequeo ${vision.code}`].filter(Boolean).join(', ')}. Sin foto ni nombre.`} />
            </div>
          )}

          <div className="card">
            <div className="rs-h"><h3>Tu camino a los anteojos</h3><small className="muted">Te acompañamos hasta el final</small></div>
            <ol className="lab-camino">
              <li className={n ? 'ok' : ''}><span><ScanFace size={16} /></span><div><b>Tu perfil visual</b><small>Rostro, calce y chequeo: sabés qué te queda y llegás a la consulta con un informe.</small></div></li>
              <li><span><Stethoscope size={16} /></span><div><b>Oftalmólogo de la red Orbital</b><small>Te recomendamos uno cerca tuyo que atienda tu obra social o prepaga. Él te hace la receta.</small></div>
                <a className="btn sm" href={`/lab/buscar?oftalmo${mejor && mejor.modelo !== 'Tu talle ideal' ? '&m=' + encodeURIComponent(mejor.modelo) : ''}`}>Buscar oftalmólogo</a></li>
              <li><span><Store size={16} /></span><div><b>Óptica Orbital con tu modelo</b><small>{mejor && mejor.modelo !== 'Tu talle ideal' ? <>Te mostramos las ópticas que tienen el <b>{mejor.modelo}</b>, para hacer tus anteojos con receta.</> : 'Te mostramos las ópticas que tienen el armazón que elegiste, para hacer tus anteojos con receta.'}</small></div>
                <a className="btn sm ghost" href={`/lab/buscar${mejor && mejor.modelo !== 'Tu talle ideal' ? '?m=' + encodeURIComponent(mejor.modelo) : ''}`}><MapPin size={14} />Ver ópticas</a></li>
            </ol>
          </div>
          <div className="disclaimer"><ShieldCheck size={16} /><span>Las imágenes de la cámara se procesan en tu celular y no se guardan ni se envían; tu perfil (solo medidas) queda en este celular. El chequeo visual es una guía previa a la consulta: no es un examen ni un diagnóstico, que solo puede hacer un médico oftalmólogo.</span></div>
        </section>
      </div>
      {calce && <Calce onCerrar={() => { setCalce(false); setPerfil(leerPerfil()) }} />}
    </div>
  )
}

/** /lab/calce: la medición sola (link directo, QR en la vidriera, botón "Medir calce" del informe con ?m=MODELO). */
export function CalcePagina({ enSuite = false }: { enSuite?: boolean }) {
  const m = new URLSearchParams(window.location.search).get('m')
  return (
    <div className="ovl rs">
      <Calce inicial={m} onCerrar={() => { window.location.href = enSuite ? '/vision-lab/perfil' : '/lab' }} />
    </div>
  )
}
