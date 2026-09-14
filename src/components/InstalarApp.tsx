// ── Instalar como app: ícono en el teléfono o la compu ──────────────────────────
// El manifest propio (con la clave/token) lo arma index.html; acá solo el botón y la ayuda.
// Lo usan el catálogo B2B (/catalogo) y el panel de colaboradores (/colab).
import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

function esStandalone(): boolean {
  try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true } catch { return false }
}

type Props = {
  nombre: string          // nombre de la app, p.ej. "Catálogo Orbital"
  que: string             // "el catálogo", "tu panel"
  bajada: string          // qué hace el ícono instalado
  // iPhone guarda la URL que está en la barra, no la del manifest: si la página sacó
  // la clave de la barra, se vuelve a poner antes de "Agregar a inicio".
  urlParaInstalar?: string
  mono?: boolean
}

export default function InstalarApp({ nombre, que, bajada, urlParaInstalar, mono }: Props) {
  const [evento, setEvento] = useState<any>(() => (window as any).__orbitalInstall ?? null)
  const [instalada, setInstalada] = useState(esStandalone)
  const [ayuda, setAyuda] = useState(false)
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); (window as any).__orbitalInstall = e; setEvento(e) }
    const onInstalada = () => { setInstalada(true); setEvento(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalada)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalada) }
  }, [])
  if (instalada) return null

  const ua = navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /android/i.test(ua)
  const enWhatsApp = /WhatsApp|FBAN|FBAV|Instagram/i.test(ua)

  async function instalar() {
    if (evento) {
      evento.prompt()
      const r = await evento.userChoice.catch(() => null)
      if (r?.outcome === 'accepted') setInstalada(true)
      ;(window as any).__orbitalInstall = null; setEvento(null)
      return
    }
    if (urlParaInstalar) window.history.replaceState(null, '', urlParaInstalar)
    setAyuda(true)
  }

  return (
    <>
      <button onClick={instalar} title={`Guardar ${que} con ícono en tu teléfono o compu`}
        className="flex items-center gap-1.5 text-sm border border-black/15 rounded-full px-3 py-2 font-medium text-neutral-700 hover:border-[#0004FF]/40">
        <Download size={15} /> <span className="hidden sm:inline">Instalar</span>
      </button>
      {ayuda && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={() => setAyuda(false)}>
          <div className={`bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 ${mono ? 'font-mono' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide">Guardá {que} en tu {ios || android ? 'teléfono' : 'compu'}</h3>
              <button onClick={() => setAyuda(false)} className="p-1 rounded-full hover:bg-black/5"><X size={18} /></button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">{bajada}</p>
            {enWhatsApp && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 mb-3">
                Lo abriste desde WhatsApp: primero abrilo en {ios ? 'Safari (ícono de brújula o "Abrir en Safari")' : 'Chrome (menú ⋮ → "Abrir en Chrome")'}.
              </p>
            )}
            <ol className="text-sm space-y-2 list-decimal pl-5">
              {ios ? (
                <>
                  <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha ⬆️).</li>
                  <li>Elegí <b>“Agregar a inicio”</b>.</li>
                  <li>Tocá <b>Agregar</b>.</li>
                </>
              ) : android ? (
                <>
                  <li>Abrí el menú <b>⋮</b> del navegador (arriba a la derecha).</li>
                  <li>Elegí <b>“Instalar app”</b> o <b>“Agregar a pantalla de inicio”</b>.</li>
                  <li>Confirmá con <b>Instalar</b>.</li>
                </>
              ) : (
                <>
                  <li>En <b>Chrome o Edge</b>: tocá el ícono de instalar en la barra de direcciones, o menú <b>⋮</b> → <b>“Instalar {nombre}”</b>.</li>
                  <li>En <b>Safari (Mac)</b>: menú <b>Archivo → Agregar al Dock</b>.</li>
                </>
              )}
            </ol>
          </div>
        </div>
      )}
    </>
  )
}
