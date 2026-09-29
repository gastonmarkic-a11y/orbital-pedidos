// Probador facial en 3D (modelos destacados con GLB): cámara frontal + MediaPipe Face Landmarker + three.js.
// El anteojo 3D sigue la cabeza (gira, se inclina, se escala) y las patillas se esconden detrás de la cara
// con una cabeza invisible que solo tapa (oclusor). Nada sale del celular.
// Posición: los landmarks 3D en pixeles del video (x, y, z≈x) con cámara ortográfica del mismo tamaño.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { url3D } from './ar3d'

const MP_VERSION = '1.0.1'
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODELO_MP = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const OJO_IZQ = 33, OJO_DER = 263, SIEN_IZQ = 234, SIEN_DER = 454, PUENTE = 168, FRENTE = 10, MENTON = 152
const ANCHO_GLB = 0.142 // ancho del frente en scripts/ar-3d.mjs

interface Color3D { codigo: string; color: string; foto?: string; archivo: string }

export default function Probador3D({ modelo, colores, inicial = 0, onCerrar }: {
  modelo: string; colores: Color3D[]; inicial?: number; onCerrar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLImageElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const grupo = useRef<THREE.Group | null>(null)
  const [sel, setSel] = useState(Math.min(Math.max(inicial, 0), colores.length - 1))
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin-cara' | 'error'>('cargando')

  // Anteojo del color elegido; si la escena todavía no existe, se engancha al crearla
  const anteojo = useRef<THREE.Object3D | null>(null)
  const colocar = () => {
    const destino = grupo.current, a = anteojo.current
    if (!destino || !a) return
    destino.children.filter((o) => o.name === 'anteojo' && o !== a).forEach((o) => destino.remove(o))
    if (a.parent !== destino) destino.add(a)
  }
  useEffect(() => {
    let vivo = true
    new GLTFLoader().load(url3D(colores[sel].archivo), (g) => {
      if (!vivo) return
      g.scene.name = 'anteojo'
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.renderOrder = 1
        // El frente es una foto: que se vea con su color real y no oscurecido por las luces
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat.map) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.85; mat.color = new THREE.Color(0x262626) }
      })
      anteojo.current = g.scene
      colocar()
    })
    return () => { vivo = false }
  }, [sel, colores])

  useEffect(() => {
    let vivo = true, stream: MediaStream | null = null, raf = 0
    let renderer: THREE.WebGLRenderer | null = null
    ;(async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const fs = await FilesetResolver.forVisionTasks(WASM)
        const det = await FaceLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: MODELO_MP, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1,
        })
        // ?cara=<url de una foto>: prueba sin cámara (desarrollo)
        if (!vivo) return
        const cara = new URLSearchParams(window.location.search).get('cara')
        const v = video.current!
        let fuente: HTMLVideoElement | HTMLImageElement = v
        if (cara) {
          const im = foto.current!
          im.crossOrigin = 'anonymous'; im.src = cara; await im.decode()
          if (!vivo) return
          fuente = im
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
          if (!vivo) return
          v.srcObject = stream
          await v.play()
        }
        const W = fuente instanceof HTMLVideoElement ? fuente.videoWidth : fuente.naturalWidth
        const H = fuente instanceof HTMLVideoElement ? fuente.videoHeight : fuente.naturalHeight

        const cv = lienzo.current!
        cv.width = W; cv.height = H
        renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true })
        renderer.setPixelRatio(1); renderer.setSize(W, H, false)
        renderer.setClearColor(0x000000, 0) // transparente: se ve la cámara debajo
        renderer.outputColorSpace = THREE.SRGBColorSpace
        const escena = new THREE.Scene()
        const cam = new THREE.OrthographicCamera(0, W, 0, -H, -5000, 5000)
        escena.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.6))
        const sol = new THREE.DirectionalLight(0xffffff, 1.2); sol.position.set(0.3, 1, 1); escena.add(sol)
        const g = new THREE.Group(); g.visible = false; escena.add(g); grupo.current = g
        // Oclusor: cabeza invisible (elipsoide) que escribe profundidad y tapa las patillas detrás de la cara
        const cabeza = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ colorWrite: false }))
        cabeza.renderOrder = 0
        cabeza.scale.set(0.074, 0.1, 0.095); cabeza.position.set(0, -0.01, -0.1)
        g.add(cabeza)
        colocar()
        setEstado('listo')

        const P = (lm: { x: number; y: number; z: number }) => new THREE.Vector3(lm.x * W, -lm.y * H, -lm.z * W)
        const pos = new THREE.Vector3(), rot = new THREE.Quaternion(); let esc = 0, primero = true
        const cuadro = () => {
          if (!vivo) return
          const lm = det.detectForVideo(fuente, performance.now()).faceLandmarks?.[0]
          if (lm) {
            const iz = P(lm[OJO_IZQ]), de = P(lm[OJO_DER]), pu = P(lm[PUENTE]), si = P(lm[SIEN_IZQ]), sd = P(lm[SIEN_DER])
            const x = de.clone().sub(iz).normalize()
            const y = P(lm[FRENTE]).sub(P(lm[MENTON]))
            y.sub(x.clone().multiplyScalar(y.dot(x))).normalize()
            const z = new THREE.Vector3().crossVectors(x, y)
            const qObj = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
            const eObj = si.distanceTo(sd) / ANCHO_GLB
            // el frente apoya un poco delante y debajo del puente de la nariz
            const pObj = pu.clone().add(z.clone().multiplyScalar(0.012 * eObj)).add(y.clone().multiplyScalar(-0.004 * eObj))
            if (primero) { pos.copy(pObj); rot.copy(qObj); esc = eObj; primero = false }
            else { pos.lerp(pObj, 0.6); rot.slerp(qObj, 0.5); esc += (eObj - esc) * 0.5 }
            g.position.copy(pos); g.quaternion.copy(rot); g.scale.setScalar(esc); g.visible = true
          } else g.visible = false
          renderer!.render(escena, cam)
          setEstado((e) => (e === 'error' ? e : lm ? 'listo' : 'sin-cara'))
          raf = requestAnimationFrame(cuadro)
        }
        cuadro()
      } catch (e) {
        console.error(e)
        if (vivo) setEstado('error')
      }
    })()
    return () => { vivo = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); renderer?.dispose() }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 text-white">
        <span className="font-bold truncate">{modelo} · {colores[sel]?.color} <span className="ml-1 text-[10px] font-bold rounded bg-white/20 px-1.5 py-0.5 align-middle">3D</span></span>
        <button onClick={onCerrar} className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">Cerrar</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 -scale-x-100">
          <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <img ref={foto} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={lienzo} className="absolute inset-0 w-full h-full object-cover" />
        </div>
        {estado !== 'listo' && (
          <p className="absolute bottom-4 inset-x-4 text-center text-sm text-white bg-black/60 rounded-xl py-2">
            {estado === 'cargando' ? 'Preparando el probador…'
              : estado === 'sin-cara' ? 'Mirá a la cámara, de frente'
              : 'No pude abrir la cámara. Revisá el permiso del navegador.'}
          </p>
        )}
      </div>
      {colores.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3 bg-black">
          {colores.map((c, i) => (
            <button key={c.codigo} onClick={() => setSel(i)} title={c.color}
              className={`shrink-0 w-20 aspect-[4/3] rounded-xl bg-white border-2 overflow-hidden ${i === sel ? 'border-white' : 'border-transparent opacity-70'}`}>
              {c.foto ? <img src={c.foto} alt={c.color} className="w-full h-full object-contain" /> : <span className="text-[10px] px-1">{c.color}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
