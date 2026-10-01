// Orbital Vision Lab: guía de voz para la prueba de lejos (3 m). El celular habla (speechSynthesis), escucha la
// respuesta (SpeechRecognition: "arriba", "derecha", "no la veo"…) y pasa solo a la letra siguiente.
// Mientras habla no escucha, para no oírse a sí mismo.
import { useEffect, useRef, useState } from 'react'
import type { Dir } from './logic'

// ---------- hablar ----------
// Voz latina neutra: primero español de Latinoamérica / EE. UU. (la "Google español de Estados Unidos" de Android y
// Chrome es la más neutra), después México y el resto de Latinoamérica, Argentina, y España solo si no hay otra.
const PREFERIDAS = ['es-US', 'es-419', 'es-MX', 'es-CO', 'es-CL', 'es-PE', 'es-AR', 'es-UY', 'es-VE']
function elegirVoz(vs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const es = vs.filter((v) => /^es[-_]/i.test(v.lang) || v.lang === 'es')
  if (!es.length) return null
  const lang = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-')
  // dentro de cada idioma, mejor las voces de red / "natural" / Google (suenan menos robóticas)
  const calidad = (v: SpeechSynthesisVoice) => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0)
  for (const l of PREFERIDAS) {
    const c = es.filter((v) => lang(v) === l).sort((a, b) => calidad(b) - calidad(a))
    if (c.length) return c[0]
  }
  return es.find((v) => !/^es-ES/i.test(lang(v))) ?? es[0]
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { vozEs = undefined }
let vozEs: SpeechSynthesisVoice | null | undefined
let hablandoHasta = 0
// Solo el reloj propio: en algunos Android speechSynthesis.speaking queda en true para siempre y no se escucharía más.
export const estaHablando = () => performance.now() < hablandoHasta

export function hablar(t: string, alTerminar?: () => void) {
  if (typeof speechSynthesis === 'undefined') { alTerminar?.(); return }
  if (vozEs === undefined) {
    const vs = speechSynthesis.getVoices()
    vozEs = elegirVoz(vs)
    if (!vs.length) vozEs = undefined // todavía no cargaron: reintentar la próxima
  }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(t)
  u.lang = vozEs?.lang ?? 'es-US'
  if (vozEs) u.voice = vozEs
  u.rate = 1.02
  // margen por si el evento de fin llega tarde (o no llega, en algunos Android)
  hablandoHasta = performance.now() + 700 + t.length * 75
  u.onend = () => { hablandoHasta = Math.min(hablandoHasta, performance.now() + 350); alTerminar?.() }
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

// ---------- intérpretes de cada prueba ----------
const repetir = (t: string) => /\brepet/.test(t)
/** Reloj astigmático: true = todas iguales, false = algunas más oscuras. */
export function entenderReloj(texto: string): boolean | 'repetir' | null {
  const t = norm(texto)
  if (repetir(t)) return 'repetir'
  if (/distint|diferent|oscur|grues|marcad|nitid|algunas/.test(t)) return false
  if (/igual|parej|todas/.test(t)) return true
  return null
}
/** Rejilla de Amsler: true = rectas y completas, false = onduladas o con faltantes. */
export function entenderRejilla(texto: string): boolean | 'repetir' | null {
  const t = norm(texto)
  if (repetir(t)) return 'repetir'
  if (/ondul|torcid|curv|borros|falt|manch|deform|raras?\b/.test(t)) return false
  if (/rect|complet|bien|normal|derech/.test(t)) return true
  return null
}
const NUMEROS: Record<string, string> = { uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' }
/** Láminas de color: el número dicho, o '' si no ve ninguno. */
export function entenderNumero(texto: string): string | 'repetir' | null {
  const t = norm(texto)
  if (repetir(t)) return 'repetir'
  if (/ningun|no veo|nada|no hay|no se\b/.test(t)) return ''
  const m = t.match(/\b([1-9])\b|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g)
  if (!m) return null
  const u = m[m.length - 1]
  return NUMEROS[u] ?? u
}
/**
 * Lectura: la persona lee en voz alta el renglón más chico que puede. Se elige el renglón más chico cuyas palabras
 * (de 4 letras o más) aparecen al menos en un 50 %. "Listo" pasa al informe; "ninguno" marca que no lee ninguno.
 */
export function entenderLectura(texto: string, renglones: { id: string; t: string }[]): { id: string } | 'listo' | 'ninguno' | 'repetir' | null {
  const t = norm(texto)
  if (repetir(t)) return 'repetir'
  if (/\b(listo|termine|informe|ya esta)\b/.test(t)) return 'listo'
  if (/ningun|no (puedo|leo)|no veo/.test(t)) return 'ninguno'
  const dichas = new Set(t.split(/[^a-z0-9ñ]+/))
  let mejor: string | null = null
  for (const r of renglones) { // de más grande a más chico: queda el más chico que coincide
    const pals = norm(r.t).split(/[^a-z0-9ñ]+/).filter((p) => p.length >= 4)
    const ok = pals.filter((p) => dichas.has(p)).length
    if (pals.length && ok / pals.length >= 0.5) mejor = r.id
  }
  return mejor ? { id: mejor } : null
}

export type EstadoEscucha = 'apagado' | 'preparando' | 'escuchando' | 'sin-permiso' | 'no-soportado' | 'error'

/**
 * Escucha mientras `activo` y llama a `onOido` con cada respuesta reconocida (una por frase).
 * Se reinicia sola cuando el navegador corta por silencio.
 */
export function useEscucha<T>(activo: boolean, entender: (texto: string) => T | null, onOido: (o: T, texto: string) => void): { estado: EstadoEscucha; ultimo: string; crudo: string } {
  const [estado, setEstado] = useState<EstadoEscucha>('apagado')
  const [ultimo, setUltimo] = useState('')
  // lo último que oyó aunque no lo haya entendido (para que la persona vea que el micrófono anda)
  const [crudo, setCrudo] = useState('')
  const cb = useRef(onOido)
  cb.current = onOido
  const ent = useRef(entender)
  ent.current = entender

  useEffect(() => {
    if (!activo) { setEstado('apagado'); return }
    const C = ctor()
    if (!C) { setEstado('no-soportado'); return }
    let vivo = true, r: Reconocedor | null = null, atendido = -1, pausaHasta = 0, oyoAudio = false
    setEstado('preparando')
    // "Escuchando" recién cuando el micrófono entrega audio; si en 5 s no arrancó, se vuelve a las flechas.
    const vigia = setTimeout(() => { if (vivo && !oyoAudio) { vivo = false; r?.abort(); setEstado('error') } }, 5000)
    const arrancar = () => {
      if (!vivo) return
      r = new C()
      ;(r as unknown as { onaudiostart: () => void }).onaudiostart = () => { oyoAudio = true; if (vivo) setEstado('escuchando') }
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
          const o = ent.current(texto)
          if (o === null) { if (e.results[i].isFinal) setCrudo(texto.trim()); continue }
          setCrudo('')
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
        else if (e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') { vivo = false; setEstado('error') }
      }
      r.onend = () => { if (vivo) setTimeout(arrancar, 250) }
      try { r.start() } catch { setTimeout(arrancar, 500) }
    }
    arrancar()
    return () => { vivo = false; clearTimeout(vigia); r?.abort() }
  }, [activo])

  return { estado, ultimo, crudo }
}
