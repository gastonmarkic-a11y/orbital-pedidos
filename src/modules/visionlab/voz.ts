// Orbital Vision Lab: guía de voz para la prueba de lejos (3 m). El celular habla (speechSynthesis), escucha la
// respuesta (SpeechRecognition: "arriba", "derecha", "no la veo"…) y pasa solo a la letra siguiente.
// Mientras habla no escucha, para no oírse a sí mismo.
import { useEffect, useRef, useState } from 'react'
import type { Dir } from './logic'

// ---------- hablar ----------
let vozEs: SpeechSynthesisVoice | null | undefined
let hablandoHasta = 0
export const estaHablando = () => (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) || performance.now() < hablandoHasta

export function hablar(t: string, alTerminar?: () => void) {
  if (typeof speechSynthesis === 'undefined') { alTerminar?.(); return }
  if (vozEs === undefined) {
    const vs = speechSynthesis.getVoices()
    vozEs = vs.find((v) => v.lang === 'es-AR') ?? vs.find((v) => v.lang.startsWith('es-4') || v.lang === 'es-US' || v.lang === 'es-MX') ?? vs.find((v) => v.lang.startsWith('es')) ?? null
    if (!vs.length) vozEs = undefined // todavía no cargaron: reintentar la próxima
  }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(t)
  u.lang = vozEs?.lang ?? 'es-AR'
  if (vozEs) u.voice = vozEs
  u.rate = 1.02
  // margen por si el evento de fin llega tarde (o no llega, en algunos Android)
  hablandoHasta = performance.now() + 700 + t.length * 75
  u.onend = () => { hablandoHasta = performance.now() + 350; alTerminar?.() }
  speechSynthesis.speak(u)
}

// ---------- tono corto de "anotado" ----------
let audio: AudioContext | null = null
/** Llamar dentro de un toque: el navegador solo habilita el audio y el micrófono desde un gesto. */
export function prepararVoz() {
  try { audio ??= new AudioContext(); void audio.resume() } catch { /* sin audio */ }
  if (puedeEscuchar()) navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {})
}
export function tono() {
  if (!audio) return
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime
  o.frequency.value = 880
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  o.connect(g).connect(audio.destination)
  o.start(t); o.stop(t + 0.2)
}

// ---------- escuchar ----------
type Reconocedor = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null
  start: () => void; abort: () => void
}
const Clase = () => (window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor })
const ctor = () => Clase().SpeechRecognition ?? Clase().webkitSpeechRecognition
export const puedeEscuchar = () => typeof window !== 'undefined' && !!ctor()

export type Oido = Dir | 'none' | 'repetir'
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Interpreta lo que dijo: la última dirección nombrada, "no la veo", o "repetí". */
export function interpretar(texto: string): Oido | null {
  const t = norm(texto)
  if (/\bno (la )?veo\b|\bno se\b|\bnose\b|\bpaso\b|\bnada\b|\bni idea\b/.test(t)) return 'none'
  if (/\brepet/.test(t)) return 'repetir'
  const pals: [RegExp, Dir][] = [[/arriba/g, 'up'], [/abajo/g, 'down'], [/derech/g, 'right'], [/izquierd/g, 'left']]
  let mejor: { i: number; d: Dir } | null = null
  for (const [re, d] of pals) for (const m of t.matchAll(re)) if (!mejor || m.index! > mejor.i) mejor = { i: m.index!, d }
  return mejor?.d ?? null
}

export type EstadoEscucha = 'apagado' | 'escuchando' | 'sin-permiso' | 'no-soportado'

/**
 * Escucha mientras `activo` y llama a `onOido` con cada respuesta reconocida (una por frase).
 * Se reinicia sola cuando el navegador corta por silencio.
 */
export function useEscucha(activo: boolean, onOido: (o: Oido, texto: string) => void): { estado: EstadoEscucha; ultimo: string } {
  const [estado, setEstado] = useState<EstadoEscucha>('apagado')
  const [ultimo, setUltimo] = useState('')
  const cb = useRef(onOido)
  cb.current = onOido

  useEffect(() => {
    if (!activo) { setEstado('apagado'); return }
    const C = ctor()
    if (!C) { setEstado('no-soportado'); return }
    let vivo = true, r: Reconocedor | null = null, atendido = -1, pausaHasta = 0
    const arrancar = () => {
      if (!vivo) return
      r = new C()
      r.lang = 'es-AR'
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 1
      atendido = -1
      r.onresult = (e) => {
        if (estaHablando() || performance.now() < pausaHasta) return
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (i <= atendido) continue
          const texto = e.results[i][0].transcript
          const o = interpretar(texto)
          if (!o) continue
          atendido = i
          pausaHasta = performance.now() + 600
          setUltimo(texto.trim())
          cb.current(o, texto)
          // cortar y volver a escuchar limpio, para que la frase siguiente no arrastre la anterior
          r?.abort()
          return
        }
      }
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { vivo = false; setEstado('sin-permiso') }
      }
      r.onend = () => { if (vivo) setTimeout(arrancar, 250) }
      try { r.start(); setEstado('escuchando') } catch { setTimeout(arrancar, 500) }
    }
    arrancar()
    return () => { vivo = false; r?.abort() }
  }, [activo])

  return { estado, ultimo }
}
