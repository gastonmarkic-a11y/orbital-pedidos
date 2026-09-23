import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'
import { formatPrecio } from '../../lib/format'

// Escaneo en la óptica: el vendedor apunta la cámara al código de barras del anteojo (= SKU),
// la Suite dice si hay stock libre y, si no, ofrece alternativas. Al terminar genera una
// precarga (catalogo_precarga) que se cierra en Nuevo Pedido como las del catálogo web.

type Art = { codigo: string; modelo: string; descripcion: string | null; precio: number; libre: number; mismo_modelo?: boolean }
type Linea = Art & { cantidad: number }
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

const FORMATOS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'qr_code', 'data_matrix']

// Chrome/Android trae BarcodeDetector nativo; en iPhone se usa el lector en wasm.
async function crearDetector(): Promise<Detector> {
  const Nativo = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Nativo) {
    const sop = await Nativo.getSupportedFormats()
    const f = FORMATOS.filter((x) => sop.includes(x))
    if (f.includes('code_128')) return new Nativo({ formats: f })
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill')
  return new BarcodeDetector({ formats: FORMATOS as never }) as unknown as Detector
}

// Un QR puede traer una URL: se queda con el último tramo.
const limpiarCodigo = (raw: string) => raw.trim().split(/[/?#=]/).filter(Boolean).pop()?.toUpperCase() ?? ''

function pitido(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    o.frequency.value = ok ? 1200 : 300
    o.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35))
    navigator.vibrate?.(ok ? 60 : [80, 60, 80])
  } catch { /* sin audio */ }
}

export default function Escanear() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const location = useLocation()

  const [cliente, setCliente] = useState<Cliente | null>(location.state?.cliente ?? null)
  const [busqueda, setBusqueda] = useState('')
  const [sugerencias, setSugerencias] = useState<Cliente[]>([])

  const [lineas, setLineas] = useState<Linea[]>([])
  const lineasRef = useRef<Linea[]>([])
  lineasRef.current = lineas

  const [camara, setCamara] = useState(false)
  const [errorCam, setErrorCam] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const ultimo = useRef<{ cod: string; t: number }>({ cod: '', t: 0 })
  const ocupado = useRef(false)

  const [manual, setManual] = useState('')
  // Último leído sin stock suficiente: se muestran alternativas para tocar.
  const [sinStock, setSinStock] = useState<{ item: Art | null; leido: string; alternativas: Art[] } | null>(null)
  // Código que no existe (o modelo escrito a mano): colores de ese modelo para elegir.
  const [opciones, setOpciones] = useState<Art[] | null>(null)
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecha, setHecha] = useState<{ id: number; unidades: number; importe: number; faltantes: { modelo: string; descripcion: string; pedido: number; libre: number }[] } | null>(null)

  // Búsqueda de cliente
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2 || cliente) { setSugerencias([]); return }
    const t = setTimeout(async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('clientes').select('*').ilike('cod', `${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('razon', `%${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('nomcomerc', `%${q}%`).limit(5),
      ])
      const vistos = new Set<string>()
      setSugerencias(([...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])] as Cliente[])
        .filter((x) => x && !vistos.has(x.cod) && vistos.add(x.cod)).slice(0, 8))
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda, cliente])

  function agregar(a: Art, cant = 1) {
    const actual = lineasRef.current.find((l) => l.codigo === a.codigo)?.cantidad ?? 0
    const nueva = Math.min(actual + cant, a.libre)
    if (nueva <= actual) return false
    setLineas((prev) => {
      const sin = prev.filter((l) => l.codigo !== a.codigo)
      const previo = prev.find((l) => l.codigo === a.codigo)
      return previo ? prev.map((l) => (l.codigo === a.codigo ? { ...l, cantidad: nueva, libre: a.libre } : l)) : [{ ...a, cantidad: nueva }, ...sin]
    })
    return true
  }

  async function procesar(raw: string) {
    const cod = limpiarCodigo(raw)
    if (!cod || ocupado.current) return
    ocupado.current = true
    try {
      const { data, error } = await supabase.rpc('escaneo_buscar', { p_codigo: cod, p_cod_cliente: cliente?.cod ?? null })
      if (error) { toast('No pude consultar el stock: ' + error.message, 'error'); return }
      const r = data as { ok: boolean; error?: string; item?: Art; alternativas?: Art[]; opciones?: Art[] }
      if (!r.ok) {
        pitido(false)
        if (r.opciones?.length) { setOpciones(r.opciones); setSinStock(null) }
        else toast(`❓ "${cod}" no está en el stock. Probá de nuevo o escribí el modelo.`, 'error')
        return
      }
      const it = r.item!
      setOpciones(null)
      const yaTengo = lineasRef.current.find((l) => l.codigo === it.codigo)?.cantidad ?? 0
      if (it.libre > yaTengo && agregar(it)) {
        pitido(true)
        setSinStock(null)
        toast(`✅ ${it.modelo} ${it.descripcion ?? ''} · quedan ${it.libre - yaTengo - 1} libres`, 'success')
      } else {
        pitido(false)
        setSinStock({ item: it, leido: cod, alternativas: r.alternativas ?? [] })
      }
    } finally {
      ocupado.current = false
    }
  }

  // Cámara + lectura continua
  useEffect(() => {
    if (!camara) return
    let stream: MediaStream | null = null
    let vivo = true
    let timer: number | undefined
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
        if (!vivo) return
        const v = videoRef.current!
        v.srcObject = stream
        await v.play()
        const det = await crearDetector()
        const leer = async () => {
          if (!vivo) return
          try {
            if (v.readyState >= 2 && !ocupado.current) {
              const cods = await det.detect(v)
              const raw = cods[0]?.rawValue
              if (raw) {
                const c = limpiarCodigo(raw)
                const ahora = Date.now()
                // El mismo código pegado a la cámara no suma de más: 2,5 s entre lecturas iguales.
                if (c !== ultimo.current.cod || ahora - ultimo.current.t > 2500) {
                  ultimo.current = { cod: c, t: ahora }
                  await procesar(c)
                }
              }
            }
          } catch { /* cuadro sin lectura */ }
          timer = window.setTimeout(leer, 250)
        }
        leer()
      } catch (e) {
        setErrorCam('No pude abrir la cámara. Dale permiso en el navegador o escribí el código abajo.')
        setCamara(false)
      }
    })()
    return () => {
      vivo = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // procesar usa refs y el cliente: se reabre si cambia el cliente
  }, [camara, cliente?.cod])

  async function precargar() {
    if (!cliente || !lineas.length) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('escaneo_precarga_crear', {
      p_cod: cliente.cod,
      p_items: lineas.map((l) => ({ codigo: l.codigo, cantidad: l.cantidad })),
      p_vendedor: codigoEfectivo || null,
      p_obs: obs || null,
    })
    setEnviando(false)
    if (error) { toast('No se pudo precargar: ' + error.message, 'error'); return }
    const r = data as { ok: boolean; error?: string; precarga_id?: number; total_units?: number; importe?: number; faltantes?: { modelo: string; descripcion: string; pedido: number; libre: number }[] }
    if (!r.ok) {
      toast(r.error === 'sin_stock' ? 'Se quedó sin stock todo lo que escaneaste. Revisá la lista.' : 'No se pudo precargar: ' + r.error, 'error')
      return
    }
    setCamara(false)
    setHecha({ id: r.precarga_id!, unidades: r.total_units!, importe: Number(r.importe), faltantes: r.faltantes ?? [] })
  }

  function reiniciar() {
    setHecha(null); setLineas([]); setObs(''); setSinStock(null); setOpciones(null)
  }

  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0)
  const importe = lineas.reduce((a, l) => a + l.cantidad * l.precio, 0)

  if (hecha) {
    return (
      <div className="max-w-md mx-auto space-y-3 text-ink">
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-50 p-4 space-y-1">
          <p className="text-lg font-semibold text-emerald-800">✅ Precarga #P{hecha.id} lista</p>
          <p className="text-sm">{cliente?.razon} · {hecha.unidades} u. · {formatPrecio(hecha.importe)}</p>
          <p className="text-xs text-muted">Quedó reservada. Se cierra en Nuevo Pedido (condiciones y confirmar).</p>
        </div>
        {hecha.faltantes.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-xs space-y-1">
            <p className="font-semibold">Se ajustó por stock mientras escaneabas:</p>
            {hecha.faltantes.map((f, i) => <p key={i}>• {f.modelo} {f.descripcion}: pediste {f.pedido}, había {f.libre}</p>)}
          </div>
        )}
        <div className="flex gap-2">
          <Link to="/pedidos/nuevo" className="flex-1 text-center rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold">Cerrar pedido ahora</Link>
          <button onClick={reiniciar} className="flex-1 rounded-lg border border-black/10 py-2.5 text-sm">Escanear otra óptica</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-3 text-ink pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">📷 Escanear en la óptica</h2>
        <Link to="/pedidos/nuevo" className="text-xs text-muted underline">Nuevo pedido</Link>
      </div>

      {/* 1. Óptica */}
      {cliente ? (
        <div className="flex items-center justify-between rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
          <span><b>{cliente.cod}</b> · {cliente.razon}</span>
          <button onClick={() => { setCliente(null); setCamara(false) }} className="text-xs text-muted underline">cambiar</button>
        </div>
      ) : (
        <div className="space-y-1">
          <input
            autoFocus
            placeholder="¿En qué óptica estás? Código o nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full bg-white border border-black/10 rounded-lg px-3 py-2.5 text-sm placeholder:text-faint focus:outline-none focus:border-brand"
          />
          {sugerencias.map((c) => (
            <button key={c.cod} onClick={() => { setCliente(c); setBusqueda('') }}
              className="w-full text-left rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-brand/40">
              <b>{c.cod}</b> · {c.razon} <span className="text-faint">({c.localidad || ''})</span>
            </button>
          ))}
          <p className="text-[11px] text-faint">¿Óptica nueva? Dala de alta como provisoria en Nuevo Pedido y volvé.</p>
        </div>
      )}

      {cliente && (
        <>
          {/* 2. Cámara */}
          {camara ? (
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} playsInline muted className="w-full aspect-[4/3] object-cover" />
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-20 border-2 border-white/80 rounded-lg pointer-events-none" />
              <button onClick={() => setCamara(false)} className="absolute top-2 right-2 text-xs bg-black/60 text-white rounded-full px-3 py-1">Pausar</button>
            </div>
          ) : (
            <button onClick={() => { setErrorCam(''); setCamara(true) }}
              className="w-full rounded-xl bg-ink text-white py-4 text-base font-semibold">
              📷 {lineas.length ? 'Seguir escaneando' : 'Abrir cámara y escanear'}
            </button>
          )}
          {errorCam && <p className="text-xs text-red-700">{errorCam}</p>}

          <form onSubmit={(e) => { e.preventDefault(); procesar(manual); setManual('') }} className="flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…o escribí el código o el modelo"
              className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
            <button className="rounded-lg border border-black/10 px-3 text-sm">Buscar</button>
          </form>

          {/* Sin stock → alternativas */}
          {sinStock && (
            <div className="rounded-xl border border-red-600/30 bg-red-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm">
                  ❌ <b>{sinStock.item ? `${sinStock.item.modelo} ${sinStock.item.descripcion ?? ''}` : sinStock.leido}</b>
                  {sinStock.item && (sinStock.item.libre > 0 ? ` · solo hay ${sinStock.item.libre} y ya los sumaste` : ' · sin stock')}
                </p>
                <button onClick={() => setSinStock(null)} className="text-xs text-muted">✕</button>
              </div>
              {sinStock.alternativas.length ? (
                <>
                  <p className="text-xs text-muted">Alternativas con stock (tocá para sumar):</p>
                  {sinStock.alternativas.map((a) => (
                    <button key={a.codigo} onClick={() => { if (agregar(a)) { pitido(true); toast(`✅ ${a.modelo} ${a.descripcion ?? ''} sumado`, 'success') } }}
                      className="w-full text-left rounded-lg bg-white border border-black/10 px-3 py-2 text-sm flex justify-between gap-2">
                      <span><b>{a.modelo}</b> {a.descripcion}{a.mismo_modelo ? <span className="ml-1 text-[10px] text-emerald-700">otro color</span> : null}</span>
                      <span className="text-xs text-muted whitespace-nowrap">{a.libre} u. · {formatPrecio(a.precio)}</span>
                    </button>
                  ))}
                </>
              ) : <p className="text-xs text-muted">No encontré alternativas parecidas con stock.</p>}
            </div>
          )}

          {/* Código desconocido / modelo escrito → colores */}
          {opciones && (
            <div className="rounded-xl border border-black/10 bg-[#F8F6F0] p-3 space-y-2">
              <div className="flex justify-between"><p className="text-xs text-muted">Elegí el color:</p><button onClick={() => setOpciones(null)} className="text-xs text-muted">✕</button></div>
              {opciones.map((a) => (
                <button key={a.codigo} disabled={a.libre <= 0}
                  onClick={() => { if (agregar(a)) { pitido(true); setOpciones(null) } }}
                  className="w-full text-left rounded-lg bg-white border border-black/10 px-3 py-2 text-sm flex justify-between gap-2 disabled:opacity-40">
                  <span><b>{a.modelo}</b> {a.descripcion}</span>
                  <span className="text-xs text-muted whitespace-nowrap">{a.libre > 0 ? `${a.libre} u.` : 'sin stock'}</span>
                </button>
              ))}
            </div>
          )}

          {/* 3. Lista */}
          {lineas.length > 0 && (
            <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
              {lineas.map((l) => (
                <div key={l.codigo} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate"><b>{l.modelo}</b> {l.descripcion}</p>
                    <p className="text-[11px] text-faint">{l.codigo} · {formatPrecio(l.precio)} · {l.libre} libres</p>
                  </div>
                  <button onClick={() => setLineas((p) => p.flatMap((x) => x.codigo !== l.codigo ? [x] : x.cantidad > 1 ? [{ ...x, cantidad: x.cantidad - 1 }] : []))}
                    className="w-8 h-8 rounded-full border border-black/10">−</button>
                  <span className="w-6 text-center text-sm font-semibold">{l.cantidad}</span>
                  <button onClick={() => { if (!agregar(l)) toast(`No hay más de ${l.libre}`, 'error') }}
                    className="w-8 h-8 rounded-full border border-black/10">+</button>
                </div>
              ))}
            </div>
          )}

          {lineas.length > 0 && (
            <>
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observación (opcional)"
                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
              <div className="fixed bottom-16 inset-x-0 px-3 z-20">
                <button onClick={precargar} disabled={enviando}
                  className="w-full max-w-md mx-auto block rounded-xl bg-emerald-600 text-white py-3.5 text-base font-semibold shadow-lg disabled:opacity-60">
                  {enviando ? 'Precargando…' : `Precargar · ${unidades} u. · ${formatPrecio(importe)}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
