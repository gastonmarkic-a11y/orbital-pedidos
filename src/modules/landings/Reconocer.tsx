// Reconocer un anteojo con la cámara — ver.orbitaleyewear.com.ar/reconocer
// Lee en vivo (sin sacar foto): cada cuadro pasa por DINOv2 en el navegador y se compara con la
// "huella" de cada foto del catálogo (public/ar/embeddings.json, scripts/ar-embeddings.mjs).
// Cuando un modelo se sostiene varios cuadros, la IA (edge reconocer-anteojo) confirma con un
// collage cámara + candidatos. Importa el MODELO, no el color.
// Confirmado → landing del modelo (/modelo/<nombre>). Sin match o sin stock → "No lo encontré en el catálogo".
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { linkFicha } from '../colab/colabUtil'
import { BotonCopiar } from '../colab/ColabAnteojos'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const INTERVALO = 350          // ms mínimos entre lecturas
const ESTABLE = 3              // cuadros seguidos con el mismo modelo arriba para consultar a la IA
const SIM_MIN = 0.3            // parecido mínimo para considerar que hay un anteojo del catálogo
const MAX_INTENTOS = 3         // consultas a la IA sin match antes de decir "no lo encontré"
const TIEMPO_MAX = 20000       // ms leyendo sin ningún candidato firme

interface Huellas { model: string; dim: number; items: { m: string; u: string; l: number }[]; data: string }
type Estado = 'cargando' | 'leyendo' | 'verificando' | 'elegir' | 'no-encontrado' | 'ficha' | 'error'
// ?colab=<clave>: abierto desde el panel del influencer. Solo reconoce SUS anteojos y, en vez de
// abrir la ficha, le arma su link (ficha con su código) para copiar y publicar.
type Suyo = { modelo_stock: string; modelo: string; handle: string; sku: string }

// Mismo preprocesado que scripts/ar-embeddings.mjs: gris + centrado en cuadrado blanco
function prep(rgba: Uint8ClampedArray, w: number, h: number) {
  const S = Math.max(w, h), o = new Uint8ClampedArray(S * S * 3).fill(255), ox = (S - w) >> 1, oy = (S - h) >> 1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, g = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2], j = ((y + oy) * S + x + ox) * 3
    o[j] = o[j + 1] = o[j + 2] = g
  }
  return { data: o, size: S }
}

function cargarImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous'
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url
  })
}
function dibujarContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

// Collage igual al de scripts/ar-test.mjs: cámara 600x600 + hasta 6 referencias 300x200 numeradas
async function armarCollage(cam: HTMLCanvasElement, refs: string[]): Promise<string> {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 600
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 600)
  dibujarContain(ctx, cam, cam.width, cam.height, 0, 0, 600, 600)
  const imgs = await Promise.all(refs.map(cargarImg))
  imgs.forEach((im, k) => {
    const x = 602 + (k % 2) * 300, y = 2 + Math.floor(k / 2) * 200
    if (im) dibujarContain(ctx, im, im.naturalWidth, im.naturalHeight, x + 2, y + 2, 296, 196)
    ctx.strokeStyle = '#999'; ctx.strokeRect(x, y, 298, 198)
    ctx.fillStyle = '#d00'; ctx.fillRect(x, y, 44, 44)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 32px Arial'; ctx.fillText(String(k + 1), x + 12, y + 34)
  })
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 150, 44)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial'; ctx.fillText('CÁMARA', 10, 32)
  ctx.fillStyle = '#000'; ctx.fillRect(598, 0, 4, 600)
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]
}

export default function Reconocer() {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<Estado>('cargando')
  const [aviso, setAviso] = useState('Preparando la cámara…')
  const [opciones, setOpciones] = useState<{ m: string; u: string }[]>([])
  const [ronda, setRonda] = useState(0)
  const enCatalogo = useRef<Set<string>>(new Set())
  const colab = new URLSearchParams(window.location.search).get('colab')
  const suyos = useRef<Record<string, Suyo>>({})
  const [ficha, setFicha] = useState<{ modelo: string; link: string } | null>(null)

  const irA = (modelo: string) => { window.location.href = `/modelo/${encodeURIComponent(modelo)}?desde=reconocer` }
  const elegido = async (modelo: string) => {
    if (!enCatalogo.current.has(modelo)) { setEstado('no-encontrado'); return }
    if (!colab) { irA(modelo); return }
    const s = suyos.current[modelo]
    setEstado('verificando'); setAviso(`Es ${s.modelo}. Armando tu link…`)
    const { data, error } = await supabase.rpc('colab_crear_link', { p_clave: colab, p_handle: s.handle, p_red: 'otra', p_formato: 'otro' })
    if (error) { setEstado('error'); setAviso('No pude crear tu link. Probá de nuevo.'); return }
    setFicha({ modelo: s.modelo, link: linkFicha(s.modelo, s.sku, (data as { codigo: string }).codigo) })
    setEstado('ficha')
  }

  useEffect(() => {
    let vivo = true, stream: MediaStream | null = null, tick = 0
    ;(async () => {
      try {
        // ?prueba=<url de foto>: usa esa imagen como si fuera la cámara (para probar en la compu)
        const prueba = new URLSearchParams(window.location.search).get('prueba')
        if (prueba) {
          const im = await cargarImg(prueba)
          const c = document.createElement('canvas'); c.width = 1280; c.height = 720
          const ctx = c.getContext('2d')!
          const pinta = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1280, 720); if (im) dibujarContain(ctx, im, im.naturalWidth, im.naturalHeight, 140, 110, 1000, 500) }
          pinta(); tick = window.setInterval(pinta, 200)
          stream = c.captureStream(5)
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        }
        if (!vivo) return
        const v = video.current!; v.srcObject = stream; await v.play()

        setAviso('Cargando el reconocimiento (la primera vez tarda unos segundos)…')
        const [tf, huellas, cat] = await Promise.all([
          import('@huggingface/transformers'),
          fetch('/ar/embeddings.json').then((r) => r.json() as Promise<Huellas>),
          colab ? supabase.rpc('colab_modelos_stock', { p_clave: colab }) : supabase.rpc('ar_modelos_catalogo'),
        ])
        if (colab) {
          const filas = (cat.data as Suyo[] | null) ?? []
          suyos.current = Object.fromEntries(filas.map((f) => [f.modelo_stock, f]))
          enCatalogo.current = new Set(Object.keys(suyos.current))
        } else enCatalogo.current = new Set((cat.data as string[] | null) ?? [])
        const proc = await tf.AutoProcessor.from_pretrained(huellas.model)
        // igual que al generar las huellas: sin recorte central, 224x224
        const ip = (proc as unknown as { image_processor: { do_center_crop: boolean; size: unknown } }).image_processor
        ip.do_center_crop = false; ip.size = { height: 224, width: 224 }
        const modelo = await tf.AutoModel.from_pretrained(huellas.model, { dtype: 'q8' })
        if (!vivo) return

        const D = huellas.dim, Q = Int8Array.from(atob(huellas.data), (c) => (c.charCodeAt(0) << 24) >> 24)
        const normas = huellas.items.map((_, k) => { let s = 0; for (let j = 0; j < D; j++) s += Q[k * D + j] ** 2; return Math.sqrt(s) || 1 })

        const cuadro = document.createElement('canvas')
        const ema: Record<string, number> = {}
        let arriba = '', seguidos = 0, intentos = 0, desde = Date.now(), ocupado = false
        setEstado('leyendo'); setAviso('Apuntá al anteojo, de frente y dentro del recuadro')

        const leer = async () => {
          if (!vivo) return
          if (ocupado || v.readyState < 2) { setTimeout(leer, INTERVALO); return }
          ocupado = true
          const t0 = performance.now()
          try {
            // recorte del recuadro guía (centro, 86% del ancho, proporción 2:1 como un anteojo de frente)
            const vw = v.videoWidth, vh = v.videoHeight
            const cw = Math.round(Math.min(vw * 0.86, vh * 1.7)), ch = Math.round(cw / 2)
            cuadro.width = cw; cuadro.height = ch
            const cx = cuadro.getContext('2d', { willReadFrequently: true })!
            cx.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch)
            const px = prep(cx.getImageData(0, 0, cw, ch).data, cw, ch)
            const img = new tf.RawImage(px.data, px.size, px.size, 3)
            const out = await modelo(await proc(img))
            const hs = out.last_hidden_state
            const vec = hs.data.slice(0, D) as Float32Array
            let nv = 0; for (let j = 0; j < D; j++) nv += vec[j] ** 2; nv = Math.sqrt(nv) || 1

            const mejor: Record<string, number> = {}, mejorU: Record<string, string> = {}
            huellas.items.forEach((it, k) => {
              if (colab && !enCatalogo.current.has(it.m)) return   // influencer: solo sus anteojos
              let s = 0; for (let j = 0; j < D; j++) s += Q[k * D + j] * vec[j]
              s /= normas[k] * nv
              if (!(it.m in mejor) || s > mejor[it.m]) { mejor[it.m] = s; if (!it.l) mejorU[it.m] = it.u }
            })
            for (const m in mejor) ema[m] = ema[m] === undefined ? mejor[m] : ema[m] * 0.5 + mejor[m] * 0.5
            const rank = Object.keys(ema).filter((m) => mejorU[m]).sort((a, b) => ema[b] - ema[a])
            const top = rank[0]

            if (ema[top] >= SIM_MIN) {
              seguidos = top === arriba ? seguidos + 1 : 1; arriba = top
              setAviso('Te estoy mirando… quedate quieto un segundo')
            } else { seguidos = 0; arriba = ''; setAviso('Apuntá al anteojo, de frente y dentro del recuadro') }

            if (seguidos >= ESTABLE) {
              setEstado('verificando'); setAviso('¡Lo tengo! Confirmando el modelo…')
              const cands = rank.slice(0, 6)
              const collage = await armarCollage(cuadro, cands.map((m) => mejorU[m]))
              const r = await fetch(`${SB}/functions/v1/reconocer-anteojo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collage, modelos: cands }) })
                .then((x) => x.json()).catch(() => ({ error: 'red' }))
              if (!vivo) return
              if (r.modelo) { elegido(r.modelo); return }
              if (r.error) {
                // sin IA: que la persona elija entre los más parecidos
                setOpciones(cands.slice(0, 6).map((m) => ({ m, u: mejorU[m] }))); setEstado('elegir'); return
              }
              intentos++
              if (intentos >= MAX_INTENTOS) { setEstado('no-encontrado'); return }
              seguidos = 0; for (const m in ema) delete ema[m]
              setEstado('leyendo'); setAviso('No coincide con el catálogo. Probá de frente y más cerca')
            }
            if (Date.now() - desde > TIEMPO_MAX && seguidos === 0) { setEstado('no-encontrado'); return }
            if (ema[top] >= SIM_MIN) desde = Date.now()
          } catch (e) { console.error(e) }
          ocupado = false
          setTimeout(leer, Math.max(0, INTERVALO - (performance.now() - t0)))
        }
        leer()
      } catch (e) {
        console.error(e)
        if (vivo) { setEstado('error'); setAviso('No pude abrir la cámara. Revisá el permiso del navegador.') }
      }
    })()
    return () => { vivo = false; clearInterval(tick); stream?.getTracks().forEach((t) => t.stop()) }
  }, [ronda])

  const reintentar = () => { setOpciones([]); setEstado('cargando'); setAviso('Preparando la cámara…'); setRonda((r) => r + 1) }

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      {/* recuadro guía 2:1 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={`w-[86%] max-w-[560px] aspect-[2/1] rounded-3xl border-4 transition-colors ${estado === 'verificando' ? 'border-emerald-400' : 'border-white/80'}`}
          style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,.45)' }} />
      </div>

      <header className="relative z-10 flex items-center justify-between px-4 pt-4">
        <img src="/logo-orbital.png" alt="Orbital" className="h-7 invert" />
        <button onClick={() => history.back()} className="text-sm bg-white/15 rounded-full px-3 py-1.5">Cerrar</button>
      </header>

      <div className="relative z-10 mt-auto p-4 pb-8">
        {(estado === 'cargando' || estado === 'leyendo' || estado === 'verificando' || estado === 'error') && (
          <p className="text-center text-[15px] font-semibold bg-black/60 rounded-2xl px-4 py-3">
            {estado !== 'error' && <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse align-middle" />}
            {aviso}
          </p>
        )}

        {estado === 'elegir' && (
          <div className="bg-white text-neutral-900 rounded-3xl p-4">
            <p className="font-bold text-center mb-3">¿Es alguno de estos?</p>
            <div className="grid grid-cols-3 gap-2">
              {opciones.map((o) => (
                <button key={o.m} onClick={() => elegido(o.m)} className="rounded-xl border border-neutral-200 p-2 hover:border-neutral-900">
                  <img src={o.u} alt={o.m} className="w-full aspect-[3/2] object-contain" />
                  <span className="block text-xs font-semibold mt-1 truncate">{suyos.current[o.m]?.modelo ?? o.m}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setEstado('no-encontrado')} className="w-full mt-3 text-sm text-neutral-500 py-2">Ninguno</button>
          </div>
        )}

        {estado === 'ficha' && ficha && (
          <div className="bg-white text-neutral-900 rounded-3xl p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">✓ Lo encontré</p>
            <p className="text-2xl font-black mt-1">{ficha.modelo}</p>
            <p className="text-sm text-neutral-500 mt-1">Tu link de la ficha, listo para publicar:</p>
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2">
              <span className="flex-1 truncate font-mono text-xs font-bold">{ficha.link.replace('https://', '')}</span>
              <BotonCopiar texto={ficha.link} label="Copiar" grande />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <a href={ficha.link} target="_blank" rel="noreferrer" className="rounded-xl border border-neutral-300 font-semibold py-3 text-center text-sm">Ver la ficha</a>
              <button onClick={() => { setFicha(null); reintentar() }} className="rounded-xl bg-neutral-900 text-white font-bold py-3 text-sm">📷 Otro anteojo</button>
            </div>
          </div>
        )}

        {estado === 'no-encontrado' && (
          <div className="bg-white text-neutral-900 rounded-3xl p-5 text-center">
            <p className="text-lg font-bold">{colab ? 'No está entre tus anteojos' : 'No lo encontré en el catálogo'}</p>
            <p className="text-sm text-neutral-500 mt-1">Probá con el anteojo de frente, con buena luz y ocupando el recuadro.</p>
            <button onClick={reintentar} className="w-full mt-4 rounded-xl bg-neutral-900 text-white font-bold py-3">Intentar de nuevo</button>
          </div>
        )}
      </div>
    </div>
  )
}
