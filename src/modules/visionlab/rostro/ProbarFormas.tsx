// Probador de formas: la cámara frontal con un armazón dibujado (7 estilos, 6 colores) del ancho que te
// corresponde según la medición. Escala real con el iris en cada cuadro, sigue el giro de la cabeza.
// Se pueden sacar fotos (quedan solo en el celular) y compararlas lado a lado.
import { useEffect, useRef, useState } from 'react'
import { Camera, Columns2, Loader2, Star, X } from 'lucide-react'
import { ESTILOS, Estilo, IRIS_MM, P3, postura } from './medidas'
import { COLORES, Color, dibujar, geometria } from './armazon'
import { altoDe, anchoDe, useCaraEnVivo } from './camara'

interface Foto { url: string; estilo: Estilo; color: string; talle: string }

export function IconoArmazon({ e, color = 'currentColor', w = 64 }: { e: Estilo; color?: string; w?: number }) {
  const g = geometria(e, 140)
  const vb = `${-74} ${-g.b / 2 - 8} 148 ${g.b + 16}`
  return (
    <svg viewBox={vb} width={w} height={(w * (g.b + 16)) / 148} aria-hidden fill="none" stroke={color} strokeLinejoin="round" strokeLinecap="round">
      {g.lentes.map((d) => <path key={d} d={d} strokeWidth={4} />)}
      {g.barra?.map((d) => <path key={d} d={d} strokeWidth={8} />)}
      <path d={g.puente} strokeWidth={4} />
      {g.puente2 && <path d={g.puente2} strokeWidth={3} />}
      {g.bisagras.map((d) => <path key={d} d={d} fill={color} stroke="none" />)}
    </svg>
  )
}

export default function ProbarFormas({ ideal, recomendados, inicial, onCerrar }: {
  ideal: number; recomendados: Estilo[]; inicial: Estilo; onCerrar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLImageElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const suave = useRef<{ x: number; y: number; giro: number; px: number; yaw: number } | null>(null)
  const [estilo, setEstilo] = useState<Estilo>(inicial)
  const [color, setColor] = useState<Color>(COLORES[0])
  const [talle, setTalle] = useState<0 | 1 | 2>(1)
  const [hayCara, setHayCara] = useState(true)
  const [fotos, setFotos] = useState<Foto[]>([])
  const [comparar, setComparar] = useState(false)
  const [flash, setFlash] = useState(false)
  const T = ideal + (talle - 1) * 6
  const sel = useRef({ estilo, color, T })
  sel.current = { estilo, color, T }

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const estado = useCaraEnVivo(video, foto, (r, fuente) => {
    const cv = lienzo.current
    if (!cv) return
    const W = anchoDe(fuente), H = altoDe(fuente)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    const lm = r.faceLandmarks?.[0] as P3[] | undefined
    setHayCara((h) => (h === !!lm ? h : !!lm))
    if (!lm) { suave.current = null; return }
    const p = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H })
    const iD = p(468), iI = p(473)
    const iris = (Math.hypot(p(469).x - p(471).x, p(469).y - p(471).y) + Math.hypot(p(474).x - p(476).x, p(474).y - p(476).y)) / 2
    const pos = postura(lm, W, H, r.facialTransformationMatrixes?.[0]?.data as number[] | undefined)
    const obj = { x: (iD.x + iI.x) / 2, y: (iD.y + iI.y) / 2, giro: Math.atan2(iI.y - iD.y, iI.x - iD.x), px: iris / IRIS_MM, yaw: (pos.yaw * Math.PI) / 180 }
    const s = suave.current
    const k = 0.55
    suave.current = s ? {
      x: s.x + (obj.x - s.x) * k, y: s.y + (obj.y - s.y) * k, giro: s.giro + (obj.giro - s.giro) * k,
      px: s.px + (obj.px - s.px) * 0.15, yaw: s.yaw + (obj.yaw - s.yaw) * k,
    } : obj
    const { x, y, giro, px, yaw } = suave.current
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(giro)
    ctx.scale(Math.max(0.6, Math.cos(yaw)), 1)
    ctx.translate(0, 2.5 * px)
    dibujar(ctx, sel.current.estilo, sel.current.T, sel.current.color, px)
    ctx.restore()
  })

  function sacarFoto() {
    const v = new URLSearchParams(window.location.search).get('cara') ? foto.current! : video.current!
    const cv = lienzo.current
    if (!cv || !cv.width) return
    const c = document.createElement('canvas')
    const esc = Math.min(1, 720 / cv.width)
    c.width = cv.width * esc; c.height = cv.height * esc
    const x = c.getContext('2d')!
    x.translate(c.width, 0); x.scale(-1, 1) // espejo, como se ve en pantalla
    x.drawImage(v, 0, 0, c.width, c.height)
    x.drawImage(cv, 0, 0, c.width, c.height)
    setFotos((f) => [{ url: c.toDataURL('image/jpeg', 0.85), estilo, color: color.nombre, talle: `${T} mm` }, ...f].slice(0, 8))
    setFlash(true); setTimeout(() => setFlash(false), 180)
  }

  const orden = [...ESTILOS].sort((a, b) => Number(recomendados.includes(b.id)) - Number(recomendados.includes(a.id)))

  return (
    <div className="rs-try" role="dialog" aria-label="Probador de formas">
      <div className="rs-try-top">
        <div><b>Probador de formas</b><span>{ESTILOS.find((e) => e.id === estilo)!.nombre} · {color.nombre} · <span className="num">{T} mm</span></span></div>
        <button onClick={onCerrar} aria-label="Cerrar"><X size={20} /></button>
      </div>
      <div className="rs-try-stage">
        <div className="rs-mirror">
          <video ref={video} playsInline muted />
          <img ref={foto} alt="" />
          <canvas ref={lienzo} />
        </div>
        {flash && <div className="rs-flash" />}
        {(estado !== 'listo' || !hayCara) && (
          <p className="rs-try-msg">
            {estado === 'cargando' ? <><Loader2 size={16} className="spin" />Preparando el probador…</>
              : estado === 'denegada' ? 'Necesitamos permiso para usar la cámara.'
              : estado === 'error' ? 'No pudimos abrir la cámara.'
              : 'Mirá a la cámara, de frente'}
          </p>
        )}
        {fotos.length > 0 && (
          <button className="rs-try-galeria" onClick={() => setComparar(true)}>
            <img src={fotos[0].url} alt="" /><span><Columns2 size={14} />Comparar <b className="num">{fotos.length}</b></span>
          </button>
        )}
      </div>
      <div className="rs-try-panel">
        <div className="rs-try-estilos" role="radiogroup" aria-label="Forma">
          {orden.map((e) => (
            <button key={e.id} role="radio" aria-checked={estilo === e.id} className={estilo === e.id ? 'sel' : ''} onClick={() => setEstilo(e.id)}>
              <IconoArmazon e={e.id} w={56} />
              <span>{e.nombre}</span>
              {recomendados.includes(e.id) && <i title="Recomendado para tu rostro"><Star size={10} fill="currentColor" /></i>}
            </button>
          ))}
        </div>
        <div className="rs-try-fila">
          <div className="rs-try-colores" role="radiogroup" aria-label="Color">
            {COLORES.map((c) => (
              <button key={c.id} role="radio" aria-checked={color.id === c.id} aria-label={c.nombre} title={c.nombre}
                className={(color.id === c.id ? 'sel ' : '') + c.id} onClick={() => setColor(c)} style={{ background: c.aro }} />
            ))}
          </div>
          <button className="rs-shot" onClick={sacarFoto} aria-label="Sacar foto" disabled={estado !== 'listo' || !hayCara}><Camera size={22} /></button>
        </div>
        <div className="rs-try-talle" role="radiogroup" aria-label="Tamaño">
          {(['Más chico', 'A tu medida', 'Más grande'] as const).map((t, i) => (
            <button key={t} role="radio" aria-checked={talle === i} className={talle === i ? 'sel' : ''} onClick={() => setTalle(i as 0 | 1 | 2)}>
              {t}<small className="num">{ideal + (i - 1) * 6} mm</small>
            </button>
          ))}
        </div>
      </div>
      {comparar && (
        <div className="rs-comp" role="dialog" aria-label="Comparar fotos">
          <div className="rs-try-top">
            <div><b>Comparar</b><span>Las fotos quedan solo en este celular</span></div>
            <button onClick={() => setComparar(false)} aria-label="Volver"><X size={20} /></button>
          </div>
          <div className="rs-comp-grid">
            {fotos.map((f, i) => (
              <figure key={i}>
                <img src={f.url} alt={`${f.estilo} ${f.color}`} />
                <figcaption><b>{ESTILOS.find((e) => e.id === f.estilo)!.nombre}</b>{f.color} · <span className="num">{f.talle}</span></figcaption>
                <button onClick={() => setFotos((x) => x.filter((_, j) => j !== i))} aria-label="Quitar foto"><X size={14} /></button>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
