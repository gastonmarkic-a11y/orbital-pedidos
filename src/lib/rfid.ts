import { useEffect, useRef, useState } from 'react'

// Lectura de etiquetas RFID del muestrario con el teléfono como receptor. Dos caminos:
//  · NFC del propio teléfono (Web NFC, Chrome en Android): se apoya la pieza en el dorso.
//    Si la etiqueta trae un registro de texto (el SKU grabado) se usa ese; si no, el UID.
//  · Lector RFID Bluetooth (UHF, modo teclado/HID): funciona en Android y iPhone. El lector
//    "tipea" el EPC muy rápido y termina con Enter; se distingue de una persona por la velocidad.
// La cámara (código de barras de la etiqueta = SKU) queda como respaldo con LectorCamara.

export type Lectura = { tag: string; texto: string | null; via: 'nfc' | 'bluetooth' | 'camara' | 'manual' }

export const normalizarTag = (s: string) => s.trim().replace(/[:\s]/g, '').toUpperCase()

type NdefRecord = { recordType: string; data?: DataView; encoding?: string }
type NdefEvent = Event & { serialNumber: string; message: { records: NdefRecord[] } }
type NdefReader = EventTarget & { scan: (o?: { signal?: AbortSignal }) => Promise<void> }

export const nfcDisponible = () => typeof window !== 'undefined' && 'NDEFReader' in window

function textoDe(ev: NdefEvent): string | null {
  for (const r of ev.message?.records ?? []) {
    if (r.recordType === 'text' && r.data) {
      try { return new TextDecoder(r.encoding || 'utf-8').decode(r.data).trim() || null } catch { /* sigue */ }
    }
    if (r.recordType === 'url' && r.data) {
      try { return new TextDecoder().decode(r.data).trim().split(/[/?#=]/).filter(Boolean).pop() ?? null } catch { /* sigue */ }
    }
  }
  return null
}

/** Escucha NFC (cuando se activa con un toque: el navegador lo exige) y el lector Bluetooth
 *  (siempre que `activo`). La misma etiqueta repetida dentro de `repetirMs` se ignora. */
export function useLectorRfid(onLectura: (l: Lectura) => void, activo = true, repetirMs = 1500) {
  const cb = useRef(onLectura)
  cb.current = onLectura
  const ultimo = useRef<{ tag: string; t: number }>({ tag: '', t: 0 })
  const [nfc, setNfc] = useState<'apagado' | 'escuchando' | 'error'>('apagado')
  const [errorNfc, setErrorNfc] = useState('')
  const abort = useRef<AbortController | null>(null)
  const activoRef = useRef(activo)
  activoRef.current = activo

  function emitir(l: Lectura) {
    if (!activoRef.current || !l.tag) return
    const ahora = Date.now()
    if (l.tag === ultimo.current.tag && ahora - ultimo.current.t < repetirMs) return
    ultimo.current = { tag: l.tag, t: ahora }
    cb.current(l)
  }

  async function activarNfc() {
    if (!nfcDisponible()) { setNfc('error'); setErrorNfc('Este teléfono/navegador no lee NFC. Usá Chrome en Android o un lector Bluetooth.'); return }
    try {
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      const Ctor = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader
      const r = new Ctor()
      await r.scan({ signal: ctrl.signal })
      r.addEventListener('reading', (e) => {
        const ev = e as NdefEvent
        const texto = textoDe(ev)
        emitir({ tag: normalizarTag(ev.serialNumber || texto || ''), texto: texto ? texto.toUpperCase() : null, via: 'nfc' })
      })
      r.addEventListener('readingerror', () => setErrorNfc('No pude leer esa etiqueta, acercala de nuevo.'))
      setNfc('escuchando'); setErrorNfc('')
    } catch (e) {
      setNfc('error')
      setErrorNfc((e as Error).name === 'NotAllowedError' ? 'Diste permiso NFC denegado: habilitalo en el candado de la barra.' : 'No se pudo activar NFC (¿está prendido en el teléfono?).')
    }
  }

  useEffect(() => () => abort.current?.abort(), [])

  // Lector Bluetooth en modo teclado: ráfaga de teclas (< 50 ms entre cada una) + Enter.
  useEffect(() => {
    let buf = ''
    let t = 0
    const onKey = (e: KeyboardEvent) => {
      const ahora = performance.now()
      const rapido = ahora - t < 50
      t = ahora
      if (e.key === 'Enter') {
        if (buf.length >= 6) {
          const tag = normalizarTag(buf)
          // Si se tipeó dentro de un campo, se saca lo que el lector escribió ahí.
          const el = e.target as HTMLInputElement | null
          if (el && 'value' in el && typeof el.value === 'string' && el.value.endsWith(buf)) {
            el.value = el.value.slice(0, -buf.length)
            e.preventDefault()
          }
          emitir({ tag, texto: tag, via: 'bluetooth' })
        }
        buf = ''
        return
      }
      if (e.key.length !== 1) return
      buf = rapido || !buf ? buf + e.key : e.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return { nfc, errorNfc, activarNfc, nfcSoportado: nfcDisponible(), emitir }
}
