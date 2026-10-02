// Orbital Vision Lab: guía de voz para la prueba de lejos (3 m). El celular habla (speechSynthesis), escucha la
// respuesta (SpeechRecognition: "arriba", "derecha", "no la veo"…) y pasa solo a la letra siguiente.
// Mientras habla no escucha (corta el micrófono y lo vuelve a abrir al terminar), para no oírse a sí mismo.
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
// Avisa a quien esté escuchando que el celular empieza a hablar: corta el micrófono para no oírse a sí mismo
// (si no, "decí arriba, abajo… o no la veo" se tomaba como respuesta y pasaba solo a la letra siguiente).
const alHablar = new Set<() => void>()
// margen después de hablar: eco del parlante y resultados que el reconocedor entrega tarde
const COLA_MS = 700

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
  u.onend = () => { hablandoHasta = Math.min(hablandoHasta, performance.now() + COLA_MS); alTerminar?.() }
  alHablar.forEach((f) => f())
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
type Eje = 'v' | 'h'
// Incluye lo que el reconocedor suele escribir mal: "a bajo", "bajo", "arriva", "riba", "isquierda", "derecho".
const PALABRAS: [RegExp, 'up' | 'down' | 'left' | 'right', Eje][] = [
  [/a ?rr?i[bv]a|\brr?iba\b|subiendo|\bsube\b|\barrib/g, 'up', 'v'], [/a ?bajo|\bbajo\b|debajo|bajando|\bbaja\b/g, 'down', 'v'],
  [/derech/g, 'right', 'h'], [/[iy][sz](qu|k)ier?d|\bizq/g, 'left', 'h'],
]
const DIAG: Record<string, Dir> = { 'up-right': 'ur', 'up-left': 'ul', 'down-right': 'dr', 'down-left': 'dl' }
/**
 * Interpreta lo que dijo: la última posición nombrada, "no la veo", o "repetí". Las diagonales se dicen con las dos
 * palabras juntas en cualquier orden: "arriba a la derecha", "derecha arriba", "abajo izquierda".
 */
export function interpretar(texto: string): Oido | null {
  const t = norm(texto)
  if (/\bno (la )?veo\b|\bno se\b|\bnose\b|\bpaso\b|\bnada\b|\bni idea\b/.test(t)) return 'none'
  if (/\brepet/.test(t)) return 'repetir'
  const hits: { i: number; fin: number; d: 'up' | 'down' | 'left' | 'right'; eje: Eje }[] = []
  for (const [re, d, eje] of PALABRAS) for (const m of t.matchAll(re)) hits.push({ i: m.index!, fin: m.index! + m[0].length, d, eje })
  if (!hits.length) return null
  hits.sort((a, b) => a.i - b.i)
  const ult = hits[hits.length - 1]
  const prev = hits[hits.length - 2]
  // la palabra del otro eje justo antes (con "a la", "hacia la", "y" en el medio) forma la diagonal
  if (prev && prev.eje !== ult.eje && /^[\s,]*(y\s+)?((a|hacia|para)\s+)?(la\s+|el\s+)?(costado\s+)?$/.test(t.slice(prev.fin, ult.i).replace(/^[a-z]*/, ''))) {
    const v = prev.eje === 'v' ? prev.d : ult.d
    const h = prev.eje === 'h' ? prev.d : ult.d
    return DIAG[v + '-' + h]
  }
  return ult.d
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
/** Duocromo: de qué lado se ven más nítidos los anillos (lo último que nombró). */
export function entenderDuo(texto: string): 'rojo' | 'verde' | 'iguales' | 'repetir' | null {
  const t = norm(texto)
  if (repetir(t)) return 'repetir'
  const m = [...t.matchAll(/roj|verd|igual|parej|mism|los dos|ambos/g)]
  if (!m.length) return null
  const u = m[m.length - 1][0]
  return u === 'roj' ? 'rojo' : u === 'verd' ? 'verde' : 'iguales'
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
    // Una frase por sesión (continuous = false): en Android Chrome el modo continuo repite resultados y una
    // respuesta contaba dos veces. Cada sesión tiene número: lo que llegue de una sesión cortada se descarta.
    let vivo = true, r: Reconocedor | null = null, sesion = 0, pausaHasta = 0, oyoAudio = false
    let vigia: ReturnType<typeof setTimeout> | null = null, espera: ReturnType<typeof setTimeout> | null = null
    setEstado('preparando')
    const programar = (ms: number) => { if (espera) clearTimeout(espera); espera = setTimeout(arrancar, ms) }
    const cortar = () => { sesion++; try { r?.abort() } catch { /* ya cortado */ } r = null }
    const arrancar = () => {
      espera = null
      if (!vivo) return
      // mientras habla (o justo después), esperar: se vuelve a escuchar cuando termina
      const falta = Math.max(hablandoHasta, pausaHasta) - performance.now()
      if (falta > 0) return programar(falta + 50)
      const mia = ++sesion
      const rec = new C()
      r = rec
      ;(rec as unknown as { onaudiostart: () => void }).onaudiostart = () => { if (mia !== sesion) return; oyoAudio = true; if (vivo) setEstado('escuchando') }
      rec.lang = 'es-AR'
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 1
      let respondida = false
      let pendiente: ReturnType<typeof setTimeout> | null = null
      const aceptar = (o: T, texto: string) => {
        if (pendiente) clearTimeout(pendiente)
        pendiente = null
        if (mia !== sesion || respondida || !vivo) return
        respondida = true
        setCrudo('')
        setUltimo(texto.trim())
        pausaHasta = performance.now() + 500
        cortar()
        cb.current(o, texto)
      }
      rec.onresult = (e) => {
        if (mia !== sesion || respondida || estaHablando() || performance.now() < pausaHasta) return
        // Toda la frase dicha hasta ahora (en algunos Android llega partida en varios resultados).
        let texto = '', final = true
        for (let i = 0; i < e.results.length; i++) { texto += ' ' + e.results[i][0].transcript; final = e.results[i].isFinal }
        const o = ent.current(texto)
        if (o === null) { if (final) setCrudo(texto.trim()); return }
        // Un resultado parcial puede estar incompleto ("abajo…" antes de "…a la derecha"): se espera un instante
        // por si sigue la frase; el resultado final se toma en el acto.
        if (final) return aceptar(o, texto)
        if (pendiente) clearTimeout(pendiente)
        pendiente = setTimeout(() => aceptar(o, texto), 650)
      }
      rec.onerror = (e) => {
        if (mia !== sesion) return
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { vivo = false; setEstado('sin-permiso') }
        else if (e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') { vivo = false; setEstado('error') }
      }
      // termina por silencio, por una respuesta o porque se cortó al hablar: volver a escuchar
      rec.onend = () => { if (vivo && (mia === sesion || !r)) programar(250) }
      try {
        rec.start()
        // "Escuchando" recién cuando el micrófono entrega audio; si en 5 s no arrancó, se vuelve a las flechas.
        vigia ??= setTimeout(() => { if (vivo && !oyoAudio) { vivo = false; cortar(); setEstado('error') } }, 5000)
      } catch { programar(500) }
    }
    const silenciar = () => { if (!vivo) return; cortar(); programar(300) }
    alHablar.add(silenciar)
    arrancar()
    return () => {
      vivo = false
      alHablar.delete(silenciar)
      if (vigia) clearTimeout(vigia)
      if (espera) clearTimeout(espera)
      cortar()
    }
  }, [activo])

  return { estado, ultimo, crudo }
}
