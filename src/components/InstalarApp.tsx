// ── Instalar como app: ícono en el teléfono o la compu ──────────────────────────
// El manifest propio (con la clave/token) lo arma index.html; acá solo el botón y la ayuda.
// Lo usan el catálogo B2B (/catalogo) y el panel de colaboradores (/colab).
import { useEffect, useState } from 'react'
import { Download, X, ExternalLink, Copy, Check, Share, SquarePlus, ArrowDown, ArrowUp } from 'lucide-react'

// Flecha que rebota señalando el botón Compartir del navegador.
function FlechaCompartir({ arriba }: { arriba?: boolean }) {
  const Icono = arriba ? ArrowUp : ArrowDown
  return (
    <div className={`fixed ${arriba ? 'top-3 right-4' : 'bottom-4 left-1/2 -translate-x-1/2'} text-white flex flex-col items-center pointer-events-none`}>
      {!arriba && <span className="text-xs font-semibold mb-1">Compartir</span>}
      <Icono size={40} strokeWidth={2.5} className="animate-bounce" />
      {arriba && <span className="text-xs font-semibold mt-1">Compartir</span>}
    </div>
  )
}

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
  const [copiado, setCopiado] = useState(false)
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
  // Navegador interno de otra app (WhatsApp, Instagram, Facebook, Telegram…): ahí no se
  // puede instalar nada, hay que saltar al navegador de verdad antes de ofrecer instalar.
  const enOtraApp = /WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/i.test(ua)

  // La URL que hay que abrir afuera: la de instalar (con clave) si la hay, si no la actual.
  const urlCompleta = urlParaInstalar ? new URL(urlParaInstalar, location.href).href : location.href

  // Android: un solo toque salta de WhatsApp a Chrome con la misma URL y el token.
  function abrirEnChrome() {
    const u = new URL(urlCompleta)
    const destino = `${u.host}${u.pathname}${u.search}`
    const fallback = encodeURIComponent(urlCompleta)
    location.href = `intent://${destino}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${fallback};end`
  }

  // iPhone: no hay salto garantizado; se intenta Safari y queda el copiar de un toque.
  function abrirEnSafari() {
    location.href = urlCompleta.replace(/^https:/, 'x-safari-https:')
    setTimeout(() => setAyuda(true), 700)
  }

  async function copiarLink() {
    try { await navigator.clipboard.writeText(urlCompleta) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = urlCompleta; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch {}
      ta.remove()
    }
    setCopiado(true); setTimeout(() => setCopiado(false), 2500)
  }

  async function instalar() {
    // Adentro de WhatsApp/Instagram no existe "instalar": primero se sale al navegador.
    if (enOtraApp) {
      if (android) return abrirEnChrome()
      if (ios) return abrirEnSafari()
    }
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

  const saliendo = enOtraApp && (android || ios)
  // Dónde queda Compartir: Safari de iPhone lo tiene abajo; iPad y Chrome (CriOS), arriba.
  const ipad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const abajo = ios && !ipad && !/CriOS|FxiOS|EdgiOS/i.test(ua)

  return (
    <>
      <button onClick={instalar}
        title={saliendo ? `Abrir ${que} en ${android ? 'Chrome' : 'Safari'} para poder instalarlo`
                        : `Guardar ${que} con ícono en tu teléfono o compu`}
        className="flex items-center gap-1.5 text-sm border border-black/15 rounded-full px-3 py-2 font-medium text-neutral-700 hover:border-[#0004FF]/40">
        {saliendo ? <ExternalLink size={15} /> : <Download size={15} />}
        <span className="hidden sm:inline">{saliendo ? (android ? 'Abrir en Chrome' : 'Abrir en Safari') : 'Instalar'}</span>
      </button>
      {ayuda && ios && !enOtraApp && (
        // iPhone/iPad: Apple no deja instalar con un botón. Se marca con una flecha dónde
        // está Compartir: abajo al centro en Safari de iPhone, arriba a la derecha en iPad y Chrome.
        <div className={`fixed inset-0 z-50 bg-black/70 flex flex-col px-5 ${abajo ? 'justify-end pb-24' : 'justify-start pt-24'} ${mono ? 'font-mono' : ''}`}
          onClick={() => setAyuda(false)}>
          {!abajo && <FlechaCompartir arriba />}
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full mx-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold uppercase tracking-wide">Instalá {que} en 2 toques</h3>
              <button onClick={() => setAyuda(false)} className="p-1 rounded-full hover:bg-black/5"><X size={18} /></button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">{bajada}</p>
            <ol className="text-sm space-y-2.5">
              <li className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-[#0004FF] text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <span>Tocá <b>Compartir</b> <Share size={15} className="inline -mt-1 text-[#0004FF]" /> {abajo ? 'abajo' : 'arriba'}
                  {abajo && <span className="text-neutral-500"> (si no lo ves, tocá <b>⋯</b>)</span>}</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-[#0004FF] text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <span>Bajá y elegí <b>“Agregar a inicio”</b> <SquarePlus size={15} className="inline -mt-1" />, después <b>Agregar</b>.</span>
              </li>
            </ol>
          </div>
          {abajo && <FlechaCompartir />}
        </div>
      )}
      {ayuda && !(ios && !enOtraApp) && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={() => setAyuda(false)}>
          <div className={`bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 ${mono ? 'font-mono' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide">Guardá {que} en tu {ios || android ? 'teléfono' : 'compu'}</h3>
              <button onClick={() => setAyuda(false)} className="p-1 rounded-full hover:bg-black/5"><X size={18} /></button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">{bajada}</p>
            {enOtraApp && (
              <div className="mb-3">
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 mb-2">
                  Lo abriste desde otra app (WhatsApp, Instagram…) y ahí no se puede instalar.
                  {ios ? ' Abrilo en Safari: tocá el ícono de compás abajo a la derecha, o pegá el link copiado.' : ' Abrilo en Chrome.'}
                </p>
                <div className="flex gap-2">
                  {android && (
                    <button onClick={abrirEnChrome}
                      className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-[#0004FF] text-white rounded-lg px-3 py-2.5 font-medium">
                      <ExternalLink size={15} /> Abrir en Chrome
                    </button>
                  )}
                  <button onClick={copiarLink}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm border border-black/15 rounded-lg px-3 py-2.5 font-medium text-neutral-700">
                    {copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar link</>}
                  </button>
                </div>
              </div>
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
