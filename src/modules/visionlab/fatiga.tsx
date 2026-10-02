// Orbital Vision Lab: chequeo de cansancio por pantallas. Mientras la persona lee 60 segundos, la cámara cuenta los
// parpadeos (blendshapes de MediaPipe); frente a una pantalla se parpadea mucho menos que en reposo (~15-20 por minuto)
// y eso reseca y cansa la vista. Se suman 3 preguntas de síntomas. Orientativo: no evalúa ojo seco ni ninguna
// enfermedad. Todo dentro del celular; las imágenes no se guardan ni se envían.
import { useEffect, useRef, useState } from 'react'
import { Check, Monitor } from 'lucide-react'
import { abrirCamara, cargarDetector } from './distancia'

export interface Fatiga { parpadeos: number; sintomas: number }

const SEGUNDOS = 60
const TEXTO = `Los ojos están hechos para mirar lejos. Cuando pasamos horas frente a una pantalla, los músculos que enfocan trabajan sin descanso y parpadeamos menos: la lágrima se evapora y aparece el ardor, la vista borrosa al final del día y, a veces, el dolor de cabeza. Por eso los especialistas recomiendan la regla 20-20-20: cada 20 minutos, mirar durante 20 segundos algo que esté a unos 6 metros. También ayuda tener la pantalla un poco por debajo de la altura de los ojos, a un brazo de distancia, con un brillo parecido al del ambiente y sin reflejos de ventanas. Unos cristales con antirreflejo y filtro de luz azul reducen el esfuerzo, y si ya usás anteojos, conviene que la graduación esté al día: un pequeño error que no molesta para caminar se nota mucho después de ocho horas de computadora. Tomarse pausas, tomar agua y dormir bien también cuida la superficie del ojo. Si el ardor o la sequedad siguen aunque descanses, consultá con un oftalmólogo: hay tratamientos simples que alivian mucho.`
const PREGUNTAS = [
  '¿Sentís ardor, arenilla o sequedad en los ojos al final del día?',
  '¿Se te nubla la vista después de un rato largo de pantalla?',
  '¿Te duele la cabeza o la frente después de usar la compu o el celular?',
]

export function TestFatiga({ valor, onListo }: { valor: Fatiga | null; onListo: (f: Fatiga) => void }) {
  const [fase, setFase] = useState<'instr' | 'leyendo' | 'preguntas' | 'listo' | 'error'>(valor ? 'listo' : 'instr')
  const [seg, setSeg] = useState(0)
  const [cara, setCara] = useState(false)
  const [resp, setResp] = useState<(boolean | null)[]>([null, null, null])
  const conteo = useRef(0)
  const [parpadeos, setParpadeos] = useState(valor?.parpadeos ?? 0)

  useEffect(() => {
    if (fase !== 'leyendo') return
    let vivo = true, raf = 0, st: MediaStream | null = null
    conteo.current = 0
    setSeg(0)
    ;(async () => {
      try {
        const cam = await abrirCamara()
        st = cam.st
        const det = await cargarDetector(true)
        if (!vivo) { det.close(); st.getTracks().forEach((t) => t.stop()); return }
        const v = cam.v
        let cerrado = false, ultimoTs = 0, cuadro = 0
        const t0 = performance.now()
        const loop = () => {
          if (!vivo) return
          raf = requestAnimationFrame(loop)
          const ahora = performance.now()
          const s = (ahora - t0) / 1000
          if (s >= SEGUNDOS) {
            vivo = false
            det.close()
            st?.getTracks().forEach((t) => t.stop())
            setParpadeos(conteo.current)
            setFase('preguntas')
            return
          }
          if (++cuadro % 10 === 0) setSeg(Math.floor(s))
          if (v.readyState < 2) return
          const ts = ahora <= ultimoTs ? ultimoTs + 1 : ahora
          ultimoTs = ts
          const r = det.detectForVideo(v, ts)
          const bs = r.faceBlendshapes?.[0]?.categories
          setCara(!!bs)
          if (!bs) return
          const val = (n: string) => bs.find((c) => c.categoryName === n)?.score ?? 0
          const b = (val('eyeBlinkLeft') + val('eyeBlinkRight')) / 2
          // histéresis: cierra por encima de 0,5 y vuelve a abrir por debajo de 0,3
          if (!cerrado && b > 0.5) { cerrado = true; conteo.current++ }
          else if (cerrado && b < 0.3) cerrado = false
        }
        loop()
      } catch {
        if (vivo) setFase('error')
      }
    })()
    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      st?.getTracks().forEach((t) => t.stop())
    }
  }, [fase])

  const terminar = () => {
    const f = { parpadeos, sintomas: resp.filter(Boolean).length }
    onListo(f)
    setFase('listo')
  }
  const res = valor ?? { parpadeos, sintomas: resp.filter(Boolean).length }
  const pocos = res.parpadeos < 8

  return (
    <div className="card flat extra">
      <div className="hd"><b><Monitor size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Cansancio por pantallas</b><span className="tag">1 minuto</span></div>
      {fase === 'instr' && (
        <>
          <p className="small" style={{ margin: 0 }}>Vas a leer un texto durante 1 minuto, como lo hacés todos los días. Mientras, la cámara cuenta cuántas veces parpadeás: frente a las pantallas parpadeamos menos y eso cansa y reseca la vista.</p>
          <button className="btn ghost" onClick={() => setFase('leyendo')}>Empezar</button>
        </>
      )}
      {fase === 'leyendo' && (
        <>
          <div className="bar"><i style={{ width: `${(seg / SEGUNDOS) * 100}%` }} /></div>
          <p className="muted small" style={{ margin: 0 }}>{cara ? `Leé tranquilo… ${SEGUNDOS - seg} s` : 'Poné la cara frente a la cámara y leé'}</p>
          <div className="lectura-fatiga">{TEXTO}</div>
        </>
      )}
      {fase === 'preguntas' && (
        <>
          {PREGUNTAS.map((p, i) => (
            <div key={p}>
              <p className="small" style={{ margin: '0 0 6px' }}>{p}</p>
              <div className="chips2">
                {[true, false].map((v) => (
                  <button key={String(v)} className={resp[i] === v ? 'sel' : ''} aria-pressed={resp[i] === v} onClick={() => setResp(resp.map((x, j) => (j === i ? v : x)))}>{v ? 'Sí, seguido' : 'No o casi nunca'}</button>
                ))}
              </div>
            </div>
          ))}
          <button className="btn" disabled={resp.includes(null)} onClick={terminar}><Check size={16} />Ver resultado</button>
        </>
      )}
      {fase === 'listo' && (
        <>
          <div className="dp-res" style={{ textAlign: 'left' }}>
            <span className="num big">{res.parpadeos} parpadeos por minuto</span>
            <span className="muted small">En reposo lo habitual es 15 a 20; leyendo en pantalla suele bajar.</span>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {pocos && res.sintomas >= 2 ? 'Parpadeás poco y tenés síntomas de cansancio visual. Probá la regla 20-20-20 y pausas, y comentáselo al oftalmólogo.'
              : pocos ? 'Parpadeás poco mientras leés en pantalla. Pausas cada 20 minutos y parpadear a conciencia ayudan a que no se reseque la vista.'
              : res.sintomas >= 2 ? 'Tu parpadeo está bien, pero tenés síntomas de cansancio visual. Comentáselo al oftalmólogo.'
              : 'Sin señales de cansancio visual por pantallas. Igual, las pausas cada 20 minutos cuidan la vista.'}
          </p>
          <p className="muted small" style={{ margin: 0 }}>Orientativo: no evalúa ojo seco ni ninguna enfermedad.</p>
        </>
      )}
      {fase === 'error' && <p className="small" style={{ margin: 0 }}>No pudimos usar la cámara en este celular. <button className="inline-link" onClick={() => setFase('instr')}>Probar de nuevo</button></p>}
    </div>
  )
}
