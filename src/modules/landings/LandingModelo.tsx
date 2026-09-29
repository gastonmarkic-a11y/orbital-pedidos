// Landing pública de un modelo para el cliente final — ver.orbitaleyewear.com.ar/modelo/<MODELO>
// Se llega desde /reconocer (cámara) o por link directo. Muestra fotos, colores disponibles
// (solo los que tienen stock), precio público de Shopify (precios_publicos), compra online
// y las ópticas más cercanas que trabajan el modelo (donde_probar, respeta bajas).
// Si el modelo no está en el catálogo: "No lo encontré en el catálogo".
// Probador virtual (Probador.tsx): la cámara frontal con el anteojo del color elegido sobre la cara.
// Destacados con 3D (public/ar/3d): "Ver en 3D y en tu mesa" (Visor3D) y probador 3D (Probador3D).
// ?v=3d abre el visor directo (QR del exhibidor, /ar-qr).
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Probador from './Probador'
const Probador3D = lazy(() => import('./Probador3D')) // three.js solo si se abre
const Visor3D = lazy(() => import('./Visor3D'))
import { indice3D, type Indice3D } from './ar3d'

interface Color { codigo: string; color: string; tratamiento: string | null; tipo: string | null; precio: number | null; fotos: string[] }
interface Modelo { modelo: string; tratamientos: string[] | null; tipos: string[] | null; precio_desde: number | null; colores: Color[]; lifestyle: string[] }
interface Optica { nombre: string; direccion: string; localidad: string; provincia: string; lat: number; lon: number; km: number }

const TIENDA = 'https://orbitaleyewear.com.ar'
const pesos = (n: number) => '$ ' + Math.round(n).toLocaleString('es-AR')
const TRAT: Record<string, string> = {
  'Infrarrojo + Blue cut': 'Triple Protección: UV400 + infrarrojo + luz azul',
  uv400: 'Protección UV400',
}

export default function LandingModelo() {
  const nombre = decodeURIComponent(window.location.pathname.replace(/^\/modelo\/?/, '').replace(/\/$/, ''))
  const qs = new URLSearchParams(window.location.search)
  const desdeCamara = qs.get('desde') === 'reconocer'
  const sku = qs.get('sku')
  // Link de un influencer (?r=<codigo>): Comprar pasa por /r/<codigo> → su código y la venta atribuida
  const ref = qs.get('r')
  const [m, setM] = useState<Modelo | null | undefined>(undefined)
  const [sel, setSel] = useState(0)
  const [foto, setFoto] = useState(0)
  const [opticas, setOpticas] = useState<Optica[] | null>(null)
  const [geo, setGeo] = useState<'' | 'buscando' | 'sin-permiso'>('')
  const [probando, setProbando] = useState(false)
  const [viendo3D, setViendo3D] = useState(qs.get('v') === '3d')
  const [idx3D, setIdx3D] = useState<Indice3D>({})
  useEffect(() => { indice3D().then(setIdx3D) }, [])

  useEffect(() => {
    document.title = `${nombre} · Orbital Eyewear`
    supabase.rpc('modelo_landing', { p_modelo: nombre, p_sku: sku }).then(({ data }) => {
      const d = (data as Modelo | null) ?? null
      setM(d)
      const i = d && sku ? d.colores.findIndex((c) => c.codigo === sku) : -1
      if (i > 0) setSel(i)
    })
  }, [nombre, sku])

  const color = m?.colores[sel]
  const fotos = useMemo(() => (color?.fotos?.length ? color.fotos : m?.colores.find((c) => c.fotos.length)?.fotos ?? []), [m, color])

  const buscarOpticas = () => {
    if (!navigator.geolocation) { setGeo('sin-permiso'); return }
    setGeo('buscando')
    navigator.geolocation.getCurrentPosition(async (p) => {
      const { data } = await supabase.rpc('donde_probar', { p_modelo: nombre, p_lat: p.coords.latitude, p_lon: p.coords.longitude })
      setOpticas((data as Optica[]) ?? []); setGeo('')
    }, () => setGeo('sin-permiso'), { timeout: 12000 })
  }

  if (m === undefined) return <div className="min-h-screen grid place-items-center text-neutral-400 text-sm">Cargando…</div>

  if (m === null) return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6 text-center">
      <img src="/logo-orbital.png" alt="Orbital" className="h-8 mb-8" />
      <p className="text-xl font-bold">No lo encontré en el catálogo</p>
      <p className="text-sm text-neutral-500 mt-2 max-w-xs">Este modelo no está disponible en este momento. Mirá toda la colección en la tienda.</p>
      <div className="flex flex-col gap-2 mt-6 w-full max-w-xs">
        <a href="/reconocer" className="rounded-xl bg-neutral-900 text-white font-bold py-3">📷 Escanear otro anteojo</a>
        <a href={TIENDA} className="rounded-xl border border-neutral-300 font-semibold py-3">Ir a la tienda</a>
      </div>
    </div>
  )

  const glb = idx3D[m.modelo] ?? {}
  const colores3D = m.colores.filter((c) => glb[c.codigo]).map((c) => ({ codigo: c.codigo, color: c.color, foto: c.fotos[0], archivo: glb[c.codigo] }))
  const i3D = Math.max(0, colores3D.findIndex((c) => c.codigo === color?.codigo))
  const precio = color?.precio ?? m.precio_desde
  const trat = color?.tratamiento ?? m.tratamientos?.[0] ?? null

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-neutral-100">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 h-14">
          <a href={TIENDA}><img src="/logo-orbital.png" alt="Orbital Eyewear" className="h-7" /></a>
          <a href="/reconocer" className="text-sm font-semibold rounded-full border border-neutral-300 px-3 py-1.5">📷 Escanear otro</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-16">
        {desdeCamara && <p className="mt-4 inline-block text-xs font-bold tracking-wide uppercase bg-emerald-50 text-emerald-700 rounded-full px-3 py-1">✓ Lo encontramos</p>}

        <div className="grid md:grid-cols-2 gap-8 mt-4">
          {/* Galería del color elegido */}
          <section>
            <div className="aspect-[4/3] rounded-3xl bg-neutral-50 grid place-items-center overflow-hidden">
              {fotos[foto] ? <img src={fotos[foto]} alt={`${m.modelo} ${color?.color ?? ''}`} className="w-full h-full object-contain" />
                : <span className="text-neutral-300 text-sm">Sin foto</span>}
            </div>
            {fotos.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {fotos.map((u, i) => (
                  <button key={u} onClick={() => setFoto(i)} className={`shrink-0 w-20 aspect-[4/3] rounded-xl bg-neutral-50 border-2 ${i === foto ? 'border-neutral-900' : 'border-transparent'}`}>
                    <img src={u} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Datos, colores y compra */}
          <section>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{m.modelo}</h1>
            {trat && <p className="mt-2 text-sm font-semibold text-blue-700">{TRAT[trat] ?? trat}</p>}
            {precio ? <p className="mt-4 text-2xl font-bold">{pesos(precio)}</p> : null}

            <p className="mt-6 text-xs font-bold uppercase tracking-wide text-neutral-500">
              Colores disponibles · {m.colores.length}
            </p>
            <p className="text-sm font-semibold mt-1">{color?.color}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {m.colores.map((c, i) => (
                <button key={c.codigo} onClick={() => { setSel(i); setFoto(0) }} title={c.color}
                  className={`w-20 aspect-[4/3] rounded-xl bg-neutral-50 border-2 overflow-hidden ${i === sel ? 'border-neutral-900' : 'border-neutral-100'}`}>
                  {c.fotos[0] ? <img src={c.fotos[0]} alt={c.color} className="w-full h-full object-contain" />
                    : <span className="text-[10px] leading-tight px-1 text-neutral-500">{c.color}</span>}
                </button>
              ))}
            </div>

            <a href={ref ? `/r/${encodeURIComponent(ref)}` : `${TIENDA}/search?q=${encodeURIComponent(m.modelo)}`} target={ref ? undefined : "_blank"} rel="noreferrer"
              className="mt-8 flex items-center justify-center w-full rounded-2xl bg-neutral-900 text-white font-bold py-4">
              Comprar online
            </a>
            <button onClick={buscarOpticas} disabled={geo === 'buscando'}
              className="mt-2 flex items-center justify-center w-full rounded-2xl border-2 border-neutral-900 font-bold py-4">
              {geo === 'buscando' ? 'Buscando ópticas cerca…' : '📍 Probátelo en una óptica cerca'}
            </button>
            {geo === 'sin-permiso' && <p className="text-xs text-neutral-500 mt-2">Necesito tu ubicación para mostrarte las ópticas más cercanas.</p>}

            {opticas && (
              <div className="mt-4 space-y-2">
                {opticas.length === 0 && <p className="text-sm text-neutral-500">Todavía no tenemos ópticas cerca con este modelo. Podés comprarlo online.</p>}
                {opticas.map((o) => (
                  <a key={o.nombre + o.direccion} target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 p-3 hover:border-neutral-900">
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{o.nombre}</span>
                      <span className="block text-xs text-neutral-500 truncate">{o.direccion} · {o.localidad}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold">{o.km} km</span>
                  </a>
                ))}
                {opticas.length > 0 && <p className="text-[11px] text-neutral-400">Ópticas que trabajan este modelo. Consultá disponibilidad del color antes de ir.</p>}
              </div>
            )}

            {colores3D.length > 0 && (
              <button onClick={() => setViendo3D(true)} className="mt-6 w-full rounded-2xl bg-neutral-50 p-4 flex items-center gap-3 text-left hover:bg-neutral-100">
                <span className="text-2xl">📦</span>
                <span className="text-sm"><b>Ver en 3D y en tu mesa</b><span className="block text-neutral-500">Giralo y apoyalo donde estés con la cámara del celular.</span></span>
              </button>
            )}
            {m.colores.some((c) => c.fotos.length) && (
              <button onClick={() => setProbando(true)} className="mt-2 w-full rounded-2xl bg-neutral-50 p-4 flex items-center gap-3 text-left hover:bg-neutral-100">
                <span className="text-2xl">🪞</span>
                <span className="text-sm"><b>Probátelo con la cámara</b><span className="block text-neutral-500">Probador virtual: mirá cómo te queda cada color.</span></span>
              </button>
            )}
          </section>
        </div>

        {m.lifestyle.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold mb-3">Inspiración</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {m.lifestyle.map((u) => <img key={u} src={u} alt={m.modelo} className="w-full aspect-square object-cover rounded-2xl" loading="lazy" />)}
            </div>
          </section>
        )}
      </main>
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/80 grid place-items-center text-white text-sm">Cargando 3D…</div>}>
      {probando && (colores3D.length
        ? <Probador3D modelo={m.modelo} colores={colores3D} inicial={i3D} onCerrar={() => setProbando(false)} />
        : <Probador modelo={m.modelo} colores={m.colores} inicial={sel} onCerrar={() => setProbando(false)} />)}
      {viendo3D && colores3D.length > 0 && !probando && (
        <Visor3D modelo={m.modelo} colores={colores3D} inicial={i3D} onCerrar={() => setViendo3D(false)}
          onProbar={(codigo) => { const i = m.colores.findIndex((c) => c.codigo === codigo); if (i >= 0) setSel(i); setViendo3D(false); setProbando(true) }} />
      )}
      </Suspense>
    </div>
  )
}
