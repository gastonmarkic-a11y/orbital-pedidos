import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Cartel de "Actualizar versión": cuando hay un build más nuevo publicado, todos los que
// están en uno viejo ven el cartel y con un toque limpian caché/SW y recargan.
// La detección es automática: el primer usuario que carga el build nuevo sube app_version,
// y el resto (con build_ts menor) lo detecta al hacer polling.

export default function ActualizarBanner() {
  const [hayNueva, setHayNueva] = useState(false)
  const [actualizando, setActualizando] = useState(false)

  useEffect(() => {
    let cancel = false
    let timer: ReturnType<typeof setInterval>

    async function chequear() {
      const { data } = await supabase.from('app_version').select('build_ts').eq('id', 1).maybeSingle()
      const stored = Number((data as { build_ts: number } | null)?.build_ts ?? 0)
      // Soy más nuevo → publico mi versión como la vigente.
      if (__APP_BUILD_TS__ > stored) {
        await supabase.from('app_version').upsert({ id: 1, build_ts: __APP_BUILD_TS__, build: __APP_BUILD__, updated_at: new Date().toISOString() })
        if (!cancel) setHayNueva(false)
        return
      }
      // Hay uno más nuevo que el mío → mostrar cartel.
      if (!cancel && stored > __APP_BUILD_TS__) setHayNueva(true)
    }

    chequear()
    timer = setInterval(chequear, 60000)
    return () => { cancel = true; clearInterval(timer) }
  }, [])

  async function actualizar() {
    setActualizando(true)
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        for (const r of regs) await r.unregister()
      }
      if (window.caches) {
        const keys = await caches.keys()
        for (const k of keys) await caches.delete(k)
      }
    } catch { /* seguir igual */ }
    // recarga forzada
    location.reload()
  }

  if (!hayNueva) return null

  return (
    <div className="fixed top-0 inset-x-0 z-[200] bg-brand text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">🔄 Hay una versión nueva de la app.</span>
        <button
          onClick={actualizar}
          disabled={actualizando}
          className="bg-white text-brandDark rounded-lg px-4 py-1.5 text-sm font-bold shrink-0 disabled:opacity-60"
        >
          {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      </div>
    </div>
  )
}
