// Orbital Vision Lab: chequeo visual con el celular → informe orientativo con código ORB-XXXX-MMDD
// + buscador de ópticas Orbital y oftalmólogos cercanos. Portado de pretest-orbital.html v1.1.
// Público sin login en /lab/pretest (tienda: ?src=tienda · QR de óptica: ?o=<cod>), solo el buscador en
// /lab/buscar, y dentro de la Suite. Diseño de herramienta clínica (ref.: Zeiss Online Vision Screening,
// Warby Parker Virtual Vision Test): pasos con progreso, instrucciones con íconos, informe imprimible.
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Check, Mic, ChevronLeft, Clock, Copy, CreditCard, Eye, EyeOff, Glasses,
  Info, LocateFixed, MapPin, Navigation, Phone, Printer, Ruler, ScanFace, Search, Share2, ShieldCheck, Stethoscope, Store, Sun, Upload,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { telefonosCliente } from '../../lib/telefono'
import {
  CAL_DEFAULT, CARD_H_MM, CARD_MM, CLEVELS, DIST_CERCA_MM, DIST_LEJOS_MM, DIST_MM, Dir, Duo, Eye as Ojo, Habitos, Informe, LEVELS, NEAR, NearId, PLATES, Resultados, Usa,
  acuityLabel, armarTicket, codigoLocal, drawPlate, evaluar, habitosVacios, letterMm, rndDir, sugerenciasHabitos,
} from './logic'
import { ComoSeHace } from './ayuda'
import { AvisoLuz, Indicador, Ubicarse, useDistancia } from './distancia'
import {
  entenderDuo, entenderLectura, entenderNumero, entenderRejilla, entenderReloj, hablar, interpretar, prepararVoz, puedeEscuchar,
  tono as tonoAnotado, useEscucha,
} from './voz'
import { DP, MedirDP } from './dp'
import { TestFatiga, Fatiga } from './fatiga'
import {
  compactar, CuestionarioHabitos, Duocromo, Evolucion, guardarEnHistorial, leerHistorial, OjoDominante, QRProfesional,
  Recordatorio, Registro, urlProfesional,
} from './extras'
import { Marco, Receta, recetaVacia, recomendar } from './marcos'
import { OBRAS, ObraSocial, PRINCIPALES } from './obras'
import './pretest.css'

type Origen = 'web' | 'tienda' | 'qr' | 'suite'

interface Optica {
  cod: string
  nombre: string
  direccion: string | null
  localidad: string | null
  provincia: string | null
  barrio: string | null
  telefono: string | null
  whatsapp: string | null
  coincide: 'barrio' | 'localidad' | 'provincia'
}

// Zona detectada con el GPS: solo barrio / ciudad / provincia, nunca se guardan coordenadas.
// `partido`: en el conurbano la localidad (Banfield) no suele tener óptica y el partido (Lomas de Zamora) sí.
interface Zona { barrio: string | null; partido: string | null; provincia: string | null }

const PASOS = ['Calibración', 'Visión de lejos', 'Contraste', 'Astigmatismo', 'Visión de color', 'Visión central', 'Visión de cerca', 'Lectura', 'Rojo y verde']
const N_PASOS = PASOS.length
const PASO_INFORME = N_PASOS + 1
const CAL_MIN = 150
// Guía de voz: consigna de cada prueba (se dice al entrar y con "repetí") y la pista corta que queda en pantalla.
const RENGLONES = [...NEAR].reverse().filter((n) => n.id !== 'J14')
const CONSIGNAS: Record<number, string> = {
  2: 'Decí dónde está la abertura del anillo: arriba, abajo, derecha, izquierda, o en diagonal, por ejemplo arriba a la derecha. Si no la ves, decí no la veo.',
  3: 'Contraste. Con los dos ojos y el celular a 50 centímetros. El anillo se va aclarando: decí dónde está la abertura. Cuando ya no lo distingas, decí no la veo.',
  4: 'Reloj de astigmatismo. Celular a 50 centímetros. Tapate el ojo izquierdo y mirá el centro. Si todas las líneas se ven iguales, decí iguales. Si algunas se ven más oscuras o marcadas, decí distintas.',
  5: 'Visión de color. Con los dos ojos. Decí qué número ves dentro del círculo. Si no ves ninguno, decí ninguno.',
  6: 'Rejilla. Celular a 30 centímetros. Tapate el ojo izquierdo y mirá fijo el punto del centro. Si las líneas se ven rectas y completas, decí rectas. Si se ven onduladas o falta alguna parte, decí onduladas.',
  7: 'Visión de cerca. Celular a 40 centímetros. Tapate el ojo izquierdo y decí dónde está la abertura del anillo, por ejemplo abajo a la izquierda.',
  8: 'Lectura. Con los dos ojos, a 40 centímetros. Leé en voz alta el renglón más chico que puedas leer sin esfuerzo. Si no podés leer ninguno, decí ninguno.',
  9: 'Rojo y verde. Celular a 40 centímetros. Tapate el ojo izquierdo. ¿Los anillos se ven más nítidos y negros sobre el rojo, sobre el verde, o iguales? Decí rojo, verde o iguales.',
}
const PISTAS: Record<number, string> = {
  2: 'decí dónde está la abertura: “arriba”, “abajo a la derecha”… o “no la veo”',
  3: 'decí dónde está la abertura: “arriba”, “abajo a la derecha”… o “no la veo”',
  4: 'decí “iguales” o “distintas”',
  5: 'decí el número que ves o “ninguno”',
  6: 'decí “rectas” u “onduladas”',
  7: 'decí dónde está la abertura: “arriba”, “abajo a la derecha”… o “no la veo”',
  8: 'leé en voz alta el renglón más chico que puedas; después decí “listo”',
  9: 'decí “rojo”, “verde” o “iguales”',
}
const instrVoz = (espejo: boolean) => (espejo
  ? 'Listo, quedate ahí. Ahora tapate el ojo izquierdo con el celular, con la pantalla mirando al espejo, y mirá su reflejo con el ojo derecho. '
  : 'Listo, quedate ahí. Tapate el ojo izquierdo con la palma. ') + INSTR_ANILLOS
const INSTR_ANILLOS = 'Te voy a mostrar anillos con una abertura: decí en voz alta dónde está, arriba, abajo, derecha, izquierda, o en diagonal, como arriba a la derecha. Si no la ves, decí no la veo.'
const PRUEBAS: [string, string][] = [
  ['Visión de lejos', 'A 3 m, ojo por ojo'],
  ['Sensibilidad al contraste', 'Binocular'],
  ['Astigmatismo', 'Reloj astigmático'],
  ['Visión de color', 'Láminas rojo-verde'],
  ['Visión central', 'Rejilla de Amsler'],
  ['Visión de cerca', 'A 40 cm, ojo por ojo'],
  ['Lectura', 'Texto de lectura (Jaeger)'],
  ['Rojo y verde', 'Duocromo a 40 cm, ojo por ojo'],
]
const PASO_BUSCAR = PASO_INFORME + 1
const PASO_LEGAL = PASO_INFORME + 2

// Aviso legal (2026-09-30, pedido de Gastón: "siempre aclarar que es una guía previa para ir al oftalmólogo").
// Pendiente: revisión de un abogado. Los pedidos de la Ley 25.326 se derivan a IRIS (WhatsApp de Orbital).
const WA_IRIS = '5491178548316'
const LEGALES: [string, ReactNode][] = [
  ['Qué es esta herramienta', 'Orbital Vision Lab es una guía previa a la consulta oftalmológica: un conjunto de pruebas de autoevaluación visual que te ayuda a llegar a la consulta con información y a saber qué contarle al profesional. Es gratuita y la ofrece Orbital Eyewear con fines informativos.'],
  ['Qué no es', 'No es un examen oftalmológico ni un dispositivo médico: no está destinada al diagnóstico de enfermedades ni a su cura, mitigación, tratamiento o prevención, y no reemplaza la consulta con un médico oftalmólogo. No sirve para obtener, renovar ni modificar una receta de anteojos o lentes de contacto. Un resultado "normal" no descarta enfermedades oculares: muchas no dan síntomas y solo se detectan en un control profesional.'],
  ['Cómo leer los resultados', 'Los valores son estimaciones orientativas. Dependen de la calibración de tu pantalla, el brillo, la iluminación, la distancia a la que sostengas el celular y tus respuestas. Pueden no coincidir con los de un examen profesional.'],
  ['Cuándo ir a una guardia', 'Si tenés pérdida de visión repentina, dolor ocular, ojo rojo con dolor, destellos de luz, una "cortina" o manchas nuevas en la visión, visión doble repentina o un golpe en el ojo, no hagas esta guía: consultá de inmediato en una guardia oftalmológica.'],
  ['Menores de edad', 'Las personas menores de 18 años deben hacer la guía acompañadas por un adulto responsable. Los chicos necesitan controles oftalmológicos periódicos aunque no tengan síntomas.'],
  ['Armazones y ópticas sugeridos', 'Las sugerencias de armazones son recomendaciones comerciales generales de Orbital Eyewear según criterios ópticos habituales, no una indicación médica. Los anteojos recetados se confeccionan únicamente con la receta de un profesional matriculado; el óptico confirma medidas y calce. Los oftalmólogos del buscador provienen de Google Maps: Orbital Eyewear no tiene relación con ellos ni responde por su atención.'],
  ['Tus datos', <>La cámara (medición de distancia, distancia entre pupilas con la tarjeta y conteo de parpadeos) se usa solo dentro de tu celular: las imágenes y la foto no se guardan ni se envían. El código QR del informe lleva tus resultados sin tu nombre, y solo los ve quien lo escanee. Si respondés por voz, el reconocimiento lo hace el servicio de voz de tu celular o navegador; Orbital no graba ni guarda el audio. Guardamos las respuestas de la guía, el nombre y la edad si los ingresás, y tu zona aproximada (barrio o ciudad; nunca tu ubicación exacta) para generar tu código, que la óptica que elijas pueda identificar tu informe y para mejorar el servicio. No vendemos tus datos. Podés pedir acceder, corregir o borrar tus datos en cualquier momento escribiéndole a IRIS, la asistente de Orbital Eyewear, por <a href={`https://wa.me/${WA_IRIS}?text=${encodeURIComponent('Hola IRIS, quiero hacer una consulta sobre mis datos del Vision Lab')}`} target="_blank" rel="noopener">WhatsApp al +54 9 11 7854-8316</a> (Ley 25.326 de Protección de los Datos Personales). La Agencia de Acceso a la Información Pública es el órgano de control de esa ley.</>],
  ['Responsabilidad', 'Al usar la guía aceptás que es informativa y que las decisiones sobre tu salud visual las tomás con un profesional. Orbital Eyewear no se responsabiliza por decisiones tomadas solo en base a estos resultados.'],
]

/** Traduce la posición del GPS a barrio, ciudad y provincia (OpenStreetMap; las coordenadas no salen de acá). */
async function zonaDesdeGps(lat: number, lng: number): Promise<Zona & { ciudad: string | null }> {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=es&lat=${lat}&lon=${lng}`)
  if (!r.ok) throw new Error('reverse ' + r.status)
  const a = ((await r.json()).address ?? {}) as Record<string, string>
  const provincia = a.state ?? null
  const esCaba = /aut[oó]noma|^capital federal$/i.test(provincia ?? '')
  const ciudad = esCaba ? 'CABA' : (a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? '').replace(/^Partido de /i, '') || null
  const barrio = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null
  const partido = esCaba ? null : (a.county ?? a.state_district ?? '').replace(/^(Partido|Departamento) de(l)? /i, '') || null
  return {
    barrio: barrio && barrio !== ciudad ? barrio : null,
    partido: partido && partido !== ciudad ? partido : null,
    ciudad,
    provincia: esCaba ? 'CABA' : provincia,
  }
}

/** Mapa de Google embebido (sin API key) con una búsqueda o una dirección. */
const mapaEmbed = (q: string) => `https://maps.google.com/maps?q=${encodeURIComponent(q)}&hl=es&z=13&output=embed`
const mapaAbrir = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

const resultadosIniciales = (pxPerMm: number, dp: DP | null = null): Resultados => ({
  pxPerMm, distMm: DIST_LEJOS_MM, espejo: false, acuity: { R: null, L: null }, acuityNear: { R: null, L: null }, contrast: null, astig: { R: null, L: null },
  colorHits: 0, amsler: { R: null, L: null }, near: null, duo: { R: null, L: null }, dp,
})

/** Datos que no tienen columna propia (DP, duocromo, hábitos, fatiga…): se suman al lead en `pretests.extras`. */
const guardarExtras = (code: string | null, extras: Record<string, unknown>) => {
  if (code) supabase.rpc('pretest_extras', { p_code: code, p: extras }).then(() => {})
}
/** Lo que se ve en un espejo está invertido de izquierda a derecha. */
const ESPEJADA: Record<Dir, Dir> = { up: 'up', down: 'down', left: 'right', right: 'left', ur: 'ul', ul: 'ur', dr: 'dl', dl: 'dr' }

// Escalera de hasta 3 intentos por nivel (agudeza y contraste): con 2 aciertos sube, con 2 errores termina.
// Así un error suelto (o la voz que entendió mal) no corta la prueba; con 8 posiciones, acertar 2 de 3 de
// casualidad pasa menos de 1 vez en 20.
interface Escalera { lvl: number; trial: number; hits: number; best: number; dir: Dir }
const escaleraNueva = (): Escalera => ({ lvl: 0, trial: 0, hits: 0, best: -1, dir: rndDir() })
/** Un paso de la escalera: el estado siguiente, o el índice del mejor nivel aprobado (-1 = ninguno) si terminó. */
function pasoEscalera(e: Escalera, a: Dir | 'none', niveles: number): { sig: Escalera } | { fin: number } {
  const hits = e.hits + (a === e.dir ? 1 : 0)
  const trial = e.trial + 1
  const errores = trial - hits
  if (hits >= 2) {
    const lvl = e.lvl + 1
    return lvl < niveles ? { sig: { lvl, trial: 0, hits: 0, best: e.lvl, dir: rndDir(e.dir) } } : { fin: e.lvl }
  }
  if (errores >= 2) return { fin: e.best }
  return { sig: { ...e, trial, hits, dir: rndDir(e.dir) } }
}

/**
 * Anillo de Landolt (ISO 8596): diámetro 5, trazo 1 y abertura 1 de bordes paralelos. Se dibuja con la abertura a la
 * derecha y se gira hacia una de las 8 posiciones.
 */
const ROT: Record<Dir, number> = { right: 0, dr: 45, down: 90, dl: 135, left: 180, ul: 225, up: 270, ur: 315 }
const ANILLO = `M${2.5 + Math.sqrt(6)} 3 A2.5 2.5 0 1 1 ${2.5 + Math.sqrt(6)} 2 L${2.5 + Math.SQRT2} 2 A1.5 1.5 0 1 0 ${2.5 + Math.SQRT2} 3 Z`
// Recuadro de apiñamiento (Peek Acuity): barra del grosor del trazo, separada medio anillo. Imita el efecto de las
// letras vecinas en una cartilla real; si no entra en la pantalla (anillos grandes a 3 m) se dibuja sin recuadro.
const CAJA = 'M-3.5 -3.5 H8.5 V8.5 H-3.5 Z M-2.5 -2.5 V7.5 H7.5 V-2.5 Z'
function Anillo({ dir, px, color = '#000', caja = false }: { dir: Dir; px: number; color?: string; caja?: boolean }) {
  const conCaja = caja && px * 2.4 <= Math.min(320, window.innerWidth - 60)
  return (
    <svg width={conCaja ? px * 2.4 : px} height={conCaja ? px * 2.4 : px} viewBox={conCaja ? '-3.5 -3.5 12 12' : '0 0 5 5'} aria-hidden="true">
      {conCaja && <path d={CAJA} fill={color} fillRule="evenodd" />}
      <path d={ANILLO} fill={color} transform={`rotate(${ROT[dir]} 2.5 2.5)`} />
    </svg>
  )
}

function Dial() {
  const lineas = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180
    const x = Math.cos(a) * 90
    const y = Math.sin(a) * 90
    return <line key={i} x1={(100 - x).toFixed(1)} y1={(100 - y).toFixed(1)} x2={(100 + x).toFixed(1)} y2={(100 + y).toFixed(1)} stroke="#000" strokeWidth="2.2" />
  })
  return (
    <svg width="230" height="230" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="#fff" />
      {lineas}
      <circle cx="100" cy="100" r="14" fill="#fff" />
    </svg>
  )
}

function Amsler() {
  const g = Array.from({ length: 21 }, (_, i) => {
    const p = i * 10
    return (
      <g key={i}>
        <line x1={p} y1="0" x2={p} y2="200" stroke="#000" strokeWidth="0.8" />
        <line x1="0" y1={p} x2="200" y2={p} stroke="#000" strokeWidth="0.8" />
      </g>
    )
  })
  return (
    <svg width="230" height="230" viewBox="0 0 200 200" aria-hidden="true">
      <rect width="200" height="200" fill="#fff" />
      {g}
      <circle cx="100" cy="100" r="4" fill="#000" />
    </svg>
  )
}

/** Lámina blanca del test con leyenda técnica abajo. */
function Stage({ izq, der, children }: { izq: string; der?: string; children: ReactNode }) {
  return (
    <div className="stage">
      {children}
      <div className="cap"><span>{izq}</span>{der && <span className="num">{der}</span>}</div>
    </div>
  )
}

/** Instrucciones de la prueba como chips con ícono (distancia, anteojos, luz…). */
function Guia({ items }: { items: [ReactNode, string][] }) {
  return <div className="guide">{items.map(([ic, t]) => <span className="chip" key={t}>{ic}{t}</span>)}</div>
}

/** Qué ojo se evalúa y cuál se tapa. */
function Ojos({ eye, espejo = false }: { eye: Ojo; espejo?: boolean }) {
  const card = (o: Ojo) => {
    const on = o === eye
    return (
      <div className={on ? 'on' : 'off'}>
        <span className="ic">{on ? <Eye size={18} /> : <EyeOff size={18} />}</span>
        <span><b>Ojo {o === 'R' ? 'derecho' : 'izquierdo'}</b><small>{on ? 'Evaluando' : espejo ? 'Tapalo con el celular' : 'Tapalo con la palma'}</small></span>
      </div>
    )
  }
  return <div className="eyes">{card('R')}{card('L')}</div>
}

function DPad({ onAnswer }: { onAnswer: (d: Dir | 'none') => void }) {
  return (
    <div className="dpad">
      <button onClick={() => onAnswer('ul')} aria-label="Arriba a la izquierda"><ArrowUpLeft size={24} /></button>
      <button onClick={() => onAnswer('up')} aria-label="Arriba"><ArrowUp size={26} /></button>
      <button onClick={() => onAnswer('ur')} aria-label="Arriba a la derecha"><ArrowUpRight size={24} /></button>
      <button onClick={() => onAnswer('left')} aria-label="Izquierda"><ArrowLeft size={26} /></button>
      <button className="none" onClick={() => onAnswer('none')}>No la veo</button>
      <button onClick={() => onAnswer('right')} aria-label="Derecha"><ArrowRight size={26} /></button>
      <button onClick={() => onAnswer('dl')} aria-label="Abajo a la izquierda"><ArrowDownLeft size={24} /></button>
      <button onClick={() => onAnswer('down')} aria-label="Abajo"><ArrowDown size={26} /></button>
      <button onClick={() => onAnswer('dr')} aria-label="Abajo a la derecha"><ArrowDownRight size={24} /></button>
    </div>
  )
}

/** Intentos del nivel actual (hasta 3 por nivel). */
const Intentos = ({ n }: { n: number }) => <div className="dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={n >= i ? 'on' : ''} />)}</div>

// ────────────────────────────────────────────────────────────────────────────────────────────
// "Así ves vos" (idea de Peek Vision: ver la imagen borrosa al lado de la nítida duplicó la gente que va al control).
// La misma escena nítida y desenfocada según la agudeza medida en cada ojo. Es una aproximación visual, no una medida.
/** Desenfoque (en unidades de la escena de 320 de ancho) para una agudeza decimal: 0 con 1.0, máximo 11. */
const desenfoque = (v: number | null) => Math.min(11, 1.4 * (1 / Math.max(0.08, v ?? 0.08) - 1))

function EscenaLejos() {
  return (
    <>
      <rect width="320" height="200" fill="#cfe3f2" />
      <rect y="150" width="320" height="50" fill="#9a9a9a" />
      <rect y="146" width="320" height="6" fill="#d8d4cc" />
      <rect x="12" y="40" width="96" height="110" fill="#e9dccb" />
      <rect x="22" y="52" width="22" height="26" fill="#7da3c0" /><rect x="58" y="52" width="22" height="26" fill="#7da3c0" />
      <rect x="22" y="92" width="22" height="26" fill="#7da3c0" /><rect x="58" y="92" width="22" height="26" fill="#7da3c0" />
      <rect x="214" y="20" width="96" height="130" fill="#d9c7b0" />
      <rect x="224" y="34" width="76" height="20" rx="2" fill="#1f5f3a" />
      <text x="262" y="48" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial,sans-serif">FARMACIA</text>
      <text x="262" y="72" textAnchor="middle" fontSize="7" fill="#3a3a42" fontFamily="Arial,sans-serif">Abierto de 8 a 22 h</text>
      <rect x="128" y="34" width="4" height="116" fill="#555" />
      <rect x="104" y="22" width="88" height="16" fill="#0d6b3c" />
      <text x="148" y="33.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff" fontFamily="Arial,sans-serif">AV. CORRIENTES</text>
      <text x="158" y="47" fontSize="6" fill="#17171c" fontFamily="Arial,sans-serif">1200 - 1300</text>
      <rect x="138" y="70" width="58" height="40" rx="4" fill="#f2c200" />
      <text x="167" y="88" textAnchor="middle" fontSize="15" fontWeight="800" fill="#17171c" fontFamily="Arial,sans-serif">152</text>
      <text x="167" y="101" textAnchor="middle" fontSize="7" fill="#17171c" fontFamily="Arial,sans-serif">Retiro · Olivos</text>
      <rect x="40" y="160" width="84" height="30" rx="8" fill="#b23a3a" />
      <rect x="60" y="179" width="42" height="9" rx="1" fill="#fff" />
      <text x="81" y="186.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#17171c" fontFamily="Arial,sans-serif">AB 123 CD</text>
    </>
  )
}
function EscenaCerca() {
  return (
    <>
      <rect width="320" height="200" fill="#f4efe6" />
      <rect x="18" y="14" width="150" height="172" rx="6" fill="#fff" stroke="#e0d9cc" />
      <text x="30" y="36" fontSize="11" fontWeight="800" fill="#17171c" fontFamily="Georgia,serif">Menú del día</text>
      {[['Milanesa con puré', '$ 9.800'], ['Ravioles de verdura', '$ 8.500'], ['Ensalada completa', '$ 7.200'], ['Flan con dulce', '$ 3.900']].map(([p, $], i) => (
        <g key={p} fontFamily="Georgia,serif" fill="#3a3a42">
          <text x="30" y={60 + i * 22} fontSize="8">{p}</text>
          <text x="156" y={60 + i * 22} fontSize="8" textAnchor="end">{$}</text>
        </g>
      ))}
      <text x="30" y="160" fontSize="5.5" fill="#6e6a61" fontFamily="Georgia,serif">Incluye bebida y postre. Consultá</text>
      <text x="30" y="168" fontSize="5.5" fill="#6e6a61" fontFamily="Georgia,serif">opciones sin TACC.</text>
      <rect x="184" y="24" width="120" height="152" rx="14" fill="#17171c" />
      <rect x="190" y="34" width="108" height="132" rx="8" fill="#e8f1e4" />
      <rect x="196" y="44" width="86" height="30" rx="6" fill="#fff" />
      <text x="201" y="56" fontSize="7" fill="#17171c" fontFamily="Arial,sans-serif">¿Llegás a las 8?</text>
      <text x="201" y="66" fontSize="5.5" fill="#6e6a61" fontFamily="Arial,sans-serif">Te espero en la puerta</text>
      <rect x="208" y="84" width="84" height="22" rx="6" fill="#cdeec0" />
      <text x="213" y="98" fontSize="7" fill="#17171c" fontFamily="Arial,sans-serif">Sí, salgo ahora</text>
      <rect x="196" y="116" width="86" height="22" rx="6" fill="#fff" />
      <text x="201" y="130" fontSize="7" fill="#17171c" fontFamily="Arial,sans-serif">Dale, beso 😊</text>
    </>
  )
}

function AsiVes({ S, usa }: { S: Resultados; usa: Usa }) {
  const [cerca, setCerca] = useState(false)
  const [ojo, setOjo] = useState<Ojo>(() => ((S.acuity.L ?? 0) < (S.acuity.R ?? 0) ? 'L' : 'R'))
  const id = useId().replace(/:/g, '')
  const v = cerca ? S.acuityNear[ojo] : S.acuity[ojo]
  const sd = desenfoque(v)
  // con umbral de contraste alto, la imagen también pierde contraste
  const lav = S.contrast === null ? 0.55 : S.contrast >= 25 ? 0.7 : S.contrast >= 12 ? 0.85 : 1
  const escena = cerca ? <EscenaCerca /> : <EscenaLejos />
  const nitido = sd < 0.3 && lav === 1
  return (
    <div className="asives">
      <div className="asives-hd">
        <div>
          <h3>Así ves vos</h3>
          <p className="muted small">Con el ojo {ojo === 'R' ? 'derecho' : 'izquierdo'}, {cerca ? 'de cerca' : 'de lejos'}{usa === 'si' ? ', con tus anteojos actuales' : ''}: agudeza {acuityLabel(v)}.</p>
        </div>
        <div className="asives-ctl no-print">
          <div className="seg2" role="radiogroup" aria-label="Distancia">
            <button role="radio" aria-checked={!cerca} className={!cerca ? 'sel' : ''} onClick={() => setCerca(false)}>De lejos</button>
            <button role="radio" aria-checked={cerca} className={cerca ? 'sel' : ''} onClick={() => setCerca(true)}>De cerca</button>
          </div>
          <div className="seg2" role="radiogroup" aria-label="Ojo">
            <button role="radio" aria-checked={ojo === 'R'} className={ojo === 'R' ? 'sel' : ''} onClick={() => setOjo('R')}>OD</button>
            <button role="radio" aria-checked={ojo === 'L'} className={ojo === 'L' ? 'sel' : ''} onClick={() => setOjo('L')}>OI</button>
          </div>
        </div>
      </div>
      <div className="asives-par">
        <figure>
          <svg viewBox="0 0 320 200" role="img" aria-label="Escena nítida">{escena}</svg>
          <figcaption>Con buena visión (10/10)</figcaption>
        </figure>
        <figure>
          <svg viewBox="0 0 320 200" role="img" aria-label="Escena simulada según tu resultado">
            <defs>
              <filter id={'av' + id} x="-5%" y="-5%" width="110%" height="110%">
                <feGaussianBlur stdDeviation={sd.toFixed(2)} />
                <feComponentTransfer>
                  {['R', 'G', 'B'].map((c) => {
                    const F = { R: 'feFuncR', G: 'feFuncG', B: 'feFuncB' }[c] as 'feFuncR'
                    return <F key={c} type="linear" slope={lav} intercept={((1 - lav) * 0.75).toFixed(3)} />
                  })}
                </feComponentTransfer>
              </filter>
              <clipPath id={'ac' + id}><rect width="320" height="200" /></clipPath>
            </defs>
            {/* el fondo se extiende fuera del cuadro para que el desenfoque no aclare los bordes */}
            <g clipPath={`url(#ac${id})`}><g filter={`url(#av${id})`}>
              {cerca
                ? <rect x="-30" y="-30" width="380" height="260" fill="#f4efe6" />
                : <><rect x="-30" y="-30" width="380" height="180" fill="#cfe3f2" /><rect x="-30" y="150" width="380" height="80" fill="#9a9a9a" /></>}
              {escena}
            </g></g>
          </svg>
          <figcaption>{nitido ? 'Así ves vos: nítido' : 'Así ves vos (aproximado)'}</figcaption>
        </figure>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {nitido
          ? 'Con este ojo no encontramos pérdida de nitidez. '
          : 'Un oftalmólogo puede decirte a qué se debe y cómo mejorarlo. '}
        Simulación aproximada a partir de tu resultado: sirve para darte una idea, no muestra exactamente cómo ves.
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Buscador de ópticas Orbital y oftalmólogos: al final del informe y solo en /lab/buscar.
function Buscador({ code, inicial = 'opticas', recetaFoto = false }: { code: string | null; inicial?: 'opticas' | 'oftalmo'; recetaFoto?: boolean }) {
  const [tab, setTab] = useState<'opticas' | 'oftalmo'>(inicial)
  const [zona, setZona] = useState<Zona | null>(null)
  const [geo, setGeo] = useState<string | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [loc, setLoc] = useState('')
  const [opticas, setOpticas] = useState<Optica[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [mapaDe, setMapaDe] = useState<string | null>(null)
  // Obra social / prepaga: para mandar a su cartilla de oftalmólogos y buscar en el mapa los que la atienden.
  const [os, setOs] = useState<ObraSocial | null>(null)
  const [verOtras, setVerOtras] = useState(false)
  const [osOtra, setOsOtra] = useState('')

  // Zona en texto: "Palermo, CABA" (barrio del GPS + lo que dice el campo).
  const zonaTexto = [zona?.barrio, loc.trim()].filter(Boolean).join(', ')
  const hayZona = zonaTexto.length >= 3

  function pedirUbicacion() {
    if (!navigator.geolocation) return setGeo('Tu navegador no permite usar la ubicación. Escribí tu localidad.')
    setGeo('Buscando tu zona…')
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const z = await zonaDesdeGps(pos.coords.latitude, pos.coords.longitude)
          if (!z.ciudad && !z.provincia) throw new Error('sin zona')
          setLoc(z.ciudad ?? z.provincia ?? '')
          setZona({ barrio: z.barrio, partido: z.partido, provincia: z.provincia })
          setGeo('Zona detectada: ' + [z.barrio, z.ciudad ?? z.provincia].filter(Boolean).join(', '))
        } catch {
          setGeo('No pudimos ubicar tu zona. Escribí tu localidad.')
        }
        setGeoBusy(false)
      },
      (err) => {
        setGeo(err.code === 1 ? 'No diste permiso de ubicación. Escribí tu localidad.' : 'No pudimos obtener tu ubicación. Escribí tu localidad.')
        setGeoBusy(false)
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }

  // Escribir a mano reemplaza la zona detectada.
  function escribirLoc(v: string) {
    setLoc(v)
    if (zona) {
      setZona(null)
      setGeo(null)
    }
  }

  // Busca ópticas por barrio / ciudad / provincia (con un respiro al tipear).
  useEffect(() => {
    const q = loc.trim()
    if (q.length < 3 && !zona) {
      setOpticas(null)
      return
    }
    let vivo = true
    setBuscando(true)
    const t = setTimeout(async () => {
      const buscar = async (texto: string | null) =>
        ((await supabase.rpc('opticas_cercanas', {
          p_q: texto, p_barrio: zona?.barrio ?? null, p_provincia: zona?.provincia ?? null, p_limite: 6,
        })).data as Optica[] | null) ?? []
      let rows = await buscar(q || null)
      // Nada en la ciudad → probar con el partido antes de mostrar las de la provincia.
      if (zona?.partido && (!rows.length || rows.every((o) => o.coincide === 'provincia'))) {
        const porPartido = await buscar(zona.partido)
        if (porPartido.some((o) => o.coincide !== 'provincia')) rows = porPartido
      }
      if (vivo) {
        setOpticas(rows)
        setBuscando(false)
      }
    }, zona ? 0 : 400)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [zona, loc])

  // Guarda la zona en el lead (una vez que dejó de tipear).
  useEffect(() => {
    if (!code || zonaTexto.length < 3) return
    const t = setTimeout(() => supabase.rpc('pretest_actualizar', { p_code: code, p_localidad: zonaTexto }).then(() => {}), 1500)
    return () => clearTimeout(t)
  }, [code, zonaTexto])

  const elegirOs = (o: ObraSocial | null) => {
    setOs(o)
    if (code && o) supabase.rpc('pretest_obra_social', { p_code: code, p_os: o.id === 'otra' ? 'otra: ' + osOtra.trim() : o.id }).then(() => {})
  }
  // "Otra" escrita a mano: se guarda cuando deja de tipear.
  useEffect(() => {
    if (!code || os?.id !== 'otra' || osOtra.trim().length < 3) return
    const t = setTimeout(() => supabase.rpc('pretest_obra_social', { p_code: code, p_os: 'otra: ' + osOtra.trim() }).then(() => {}), 1500)
    return () => clearTimeout(t)
  }, [code, os, osOtra])

  const elegirOptica = (o: Optica) => {
    if (code) supabase.rpc('pretest_actualizar', { p_code: code, p_optica_cod: o.cod }).then(() => {})
  }

  // Si no hay ninguna en su ciudad, la RPC devuelve las de la provincia: avisarlo.
  const soloProvincia = !!opticas?.length && opticas.every((o) => o.coincide === 'provincia')
  const qOftalmo = (que: string) => que + (hayZona ? ' en ' + zonaTexto : ' cerca de mí')

  return (
    <div className="finder">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'opticas'} className={tab === 'opticas' ? 'sel' : ''} onClick={() => setTab('opticas')}><Store size={16} />Ópticas Orbital</button>
        <button role="tab" aria-selected={tab === 'oftalmo'} className={tab === 'oftalmo' ? 'sel' : ''} onClick={() => setTab('oftalmo')}><Stethoscope size={16} />Oftalmólogos</button>
      </div>

      <div>
        <div className="search">
          <Search size={18} />
          <input type="search" placeholder="Barrio, ciudad o provincia" aria-label="Tu localidad" value={loc} onChange={(e) => escribirLoc(e.target.value)} />
          <button className="gps" onClick={pedirUbicacion} disabled={geoBusy}><LocateFixed size={15} />{geoBusy ? 'Ubicando…' : 'Mi ubicación'}</button>
        </div>
        <div className="geo" style={{ marginTop: 6 }}>{geo ?? 'Usamos solo tu zona aproximada; no guardamos tu ubicación exacta.'}</div>
      </div>

      {tab === 'opticas' && (
        <div className="opts">
          {opticas === null && !buscando && (
            <div className="empty"><MapPin size={28} />Escribí tu localidad o usá tu ubicación para ver las ópticas Orbital más cercanas.</div>
          )}
          {buscando && opticas === null && <div className="empty">Buscando ópticas…</div>}
          {opticas !== null && opticas.length === 0 && (
            <div className="empty"><Store size={28} />Todavía no hay ópticas Orbital para esa búsqueda. Probá con tu provincia.</div>
          )}
          {soloProvincia && <div className="note">Todavía no hay ópticas Orbital en {loc.trim() || 'tu zona'}. Estas son las más cercanas de tu provincia.</div>}
          {opticas?.map((o) => {
            const wa = telefonosCliente(o.whatsapp, null).find((n) => n.tipo === 'celular')
            const tel = o.telefono || o.whatsapp
            const msg = code
              ? `Hola, hice el chequeo visual Orbital (código ${code})${recetaFoto ? ', ya subí mi receta' : ''} y quiero pedir turno para hacer mis anteojos`
              : 'Hola, los encontré en Orbital Vision Lab y quiero consultar por anteojos'
            const dir = [o.nombre, o.direccion, o.localidad, o.provincia].filter(Boolean).join(', ')
            const verMapa = mapaDe === o.cod
            return (
              <div className="opt" key={o.cod}>
                <div className="hd"><b>{o.nombre}</b>{o.barrio && <span className="tag">{o.barrio}</span>}</div>
                <div className="ln"><MapPin size={16} /><span>{[o.direccion, [o.localidad, o.provincia].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span></div>
                {tel && <div className="ln"><Phone size={16} /><a href={`tel:${tel.replace(/[^\d+]/g, '')}`}>{tel}</a></div>}
                {verMapa && <iframe className="map sm" title={'Mapa de ' + o.nombre} src={mapaEmbed(dir)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
                <div className="row">
                  {wa && <a className="btn sm wa" target="_blank" rel="noopener" href={`${wa.waHref}?text=${encodeURIComponent(msg)}`} onClick={() => elegirOptica(o)}>Pedir turno</a>}
                  <a className="btn sm ghost" target="_blank" rel="noopener" href={mapaAbrir(dir)} onClick={() => elegirOptica(o)}><Navigation size={15} />Cómo llegar</a>
                  <button className="btn sm ghost" onClick={() => setMapaDe(verMapa ? null : o.cod)}><MapPin size={15} />{verMapa ? 'Ocultar' : 'Mapa'}</button>
                </div>
                {code && <div className="muted small">Mencioná el código <b className="num">{code}</b> al pedir turno.</div>}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'oftalmo' && (
        <div className="opts">
          <div className="opt">
            <div className="hd"><b>¿Tenés obra social o prepaga?</b></div>
            <div className="muted small">Te llevamos a su cartilla de oftalmólogos y te mostramos los que la atienden {hayZona ? 'en ' + zonaTexto : 'cerca tuyo'}.</div>
            <div className="oschips" role="radiogroup" aria-label="Obra social o prepaga">
              {PRINCIPALES.map((o) => (
                <button key={o.id} role="radio" aria-checked={os?.id === o.id} className={os?.id === o.id ? 'sel' : ''} onClick={() => { setVerOtras(false); elegirOs(o) }}>{o.corto ?? o.nombre}</button>
              ))}
              <button role="radio" aria-checked={verOtras} className={verOtras ? 'sel' : ''} onClick={() => { setVerOtras(true); setOs(null) }}>Otra</button>
              <button role="radio" aria-checked={os?.id === 'particular'} className={os?.id === 'particular' ? 'sel' : ''} onClick={() => { setVerOtras(false); elegirOs(OBRAS.find((o) => o.id === 'particular')!) }}>No tengo</button>
            </div>
            {verOtras && (
              <select value={os?.id ?? ''} onChange={(e) => { const o = OBRAS.find((x) => x.id === e.target.value) ?? null; elegirOs(o) }} aria-label="Elegí tu obra social">
                <option value="" disabled>Elegí tu obra social o prepaga…</option>
                {OBRAS.filter((o) => !o.principal && o.id !== 'particular').map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            )}
            {os?.id === 'otra' && (
              <input type="text" value={osOtra} onChange={(e) => setOsOtra(e.target.value)} placeholder="¿Cuál? (ej.: OSPJN)" aria-label="Nombre de tu obra social" />
            )}
            {os && os.id !== 'particular' && (
              <div className="oscard">
                {os.cartilla && (
                  <a className="btn" target="_blank" rel="noopener" href={os.cartilla}><Stethoscope size={16} />Cartilla de oftalmólogos de {os.corto ?? os.nombre}</a>
                )}
                {os.cartilla && <div className="muted small">{os.ayuda ?? 'En la cartilla elegí la especialidad Oftalmología y tu localidad.'}{os.login ? ' Te va a pedir tu número de afiliado.' : ''}</div>}
                <a className={os.cartilla ? 'btn ghost' : 'btn'} target="_blank" rel="noopener" href={mapaAbrir(qOftalmo('oftalmólogo ' + (os.id === 'otra' ? osOtra.trim() : os.busqueda ?? os.nombre)))}>
                  <MapPin size={16} />Oftalmólogos que atienden {os.id === 'otra' ? osOtra.trim() || 'tu obra social' : os.corto ?? os.nombre}
                </a>
              </div>
            )}
          </div>
          {/* El mapa embebido sin API key muestra un solo punto, no la lista: se abre la búsqueda en Google Maps. */}
          <div className="opt">
            <div className="hd"><b>Oftalmólogos {hayZona ? 'en ' + zonaTexto : 'cerca tuyo'}</b></div>
            <div className="muted small">Te mostramos los consultorios en Google Maps con reseñas, horarios y teléfono.</div>
            <a className="btn" target="_blank" rel="noopener" href={mapaAbrir(qOftalmo('oftalmólogo'))}><Stethoscope size={16} />Ver oftalmólogos en el mapa</a>
            <a className="btn ghost" target="_blank" rel="noopener" href={mapaAbrir(qOftalmo('centro oftalmológico'))}>Centros y clínicas oftalmológicas</a>
          </div>
          <div className="note">
            <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Qué llevar a la consulta</b>
            {code && <div>· Este informe (guardalo en PDF o mostralo en el celular).</div>}
            <div>· Tus anteojos o lentes de contacto actuales, si usás.</div>
            <div>· Tu credencial de obra social o prepaga: preguntá si la aceptan al pedir turno.</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Armazones del catálogo mayorista (con precio solo si tienen precio minorista). Sin receta no se deduce nada del
// chequeo; con la receta (valores o foto) se ordenan por las reglas de armazón y la óptica la recibe con el código.
const precioAR = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function Marcos({ code, recetaFoto, onRecetaFoto }: { code: string | null; recetaFoto: boolean; onRecetaFoto: (path: string) => void }) {
  const [marcos, setMarcos] = useState<Marco[] | null>(null)
  const [rec, setRec] = useState<Receta>(recetaVacia)
  const [abrir, setAbrir] = useState(false)
  const [subiendo, setSubiendo] = useState<'no' | 'si' | 'error'>('no')

  useEffect(() => {
    supabase.rpc('pretest_marcos').then(({ data }) => setMarcos((data as Marco[] | null) ?? []))
  }, [])

  // Foto o PDF de la receta → bucket privado `recetas/<código>/…`; queda en el lead para la óptica.
  async function subirReceta(f: File | undefined) {
    if (!f || !code) return
    setSubiendo('si')
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    const path = `${code}/receta-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('recetas').upload(path, f, { contentType: f.type || undefined, upsert: false })
    if (error) { setSubiendo('error'); return }
    guardarExtras(code, { receta: path })
    onRecetaFoto(path)
    setSubiendo('no')
  }

  const r = useMemo(() => (marcos ? recomendar(marcos, rec) : null), [marcos, rec])
  const campo = (k: keyof Receta, lbl: string, ph: string) => (
    <div>
      <label htmlFor={'rx-' + k}>{lbl}</label>
      <input type="text" id={'rx-' + k} inputMode="decimal" placeholder={ph} value={rec[k]} onChange={(e) => setRec({ ...rec, [k]: e.target.value })} />
    </div>
  )
  const link = (m: string) => `https://ver.orbitaleyewear.com.ar/modelo/${encodeURIComponent(m)}?desde=pretest${code ? '&c=' + code : ''}`

  return (
    <div className="frames">
      <div className="card flat rx">
        <button className="rx-toggle" onClick={() => setAbrir(!abrir)} aria-expanded={abrir}>
          <Glasses size={18} />
          <span><b>¿Ya tenés tu receta del oftalmólogo?</b><small>Subila para llevarla a la óptica y te mostramos los armazones que mejor le van.</small></span>
          <span className="chev">{abrir ? '−' : '+'}</span>
        </button>
        {abrir && (
          <div className="rx-body">
            <div className="rx-subir">
              {recetaFoto ? (
                <div className="ok"><Check size={16} /><span><b>Receta subida.</b> La óptica Orbital que elijas la ve con tu código <b className="num">{code}</b>.</span></div>
              ) : (
                <label className={'btn' + (!code || subiendo === 'si' ? ' disabled' : '')}>
                  <Upload size={16} />{subiendo === 'si' ? 'Subiendo…' : 'Subir foto de la receta'}
                  <input type="file" accept="image/*,application/pdf" hidden disabled={!code || subiendo === 'si'} onChange={(e) => subirReceta(e.target.files?.[0])} />
                </label>
              )}
              {subiendo === 'error' && <div className="muted small">No se pudo subir. Probá de nuevo o mandala por WhatsApp cuando pidas turno.</div>}
              <div className="muted small">Se guarda en forma privada: solo la ven Orbital y la óptica que elijas.</div>
            </div>
            <div className="rx-grid">
              <p className="small" style={{ gridColumn: '1/-1', margin: 0 }}><b>Opcional:</b> copiá los valores para ordenar los armazones según tu receta.</p>
              {campo('esfOD', 'Esfera OD', '-2,50')}
              {campo('esfOI', 'Esfera OI', '-2,25')}
              {campo('cil', 'Cilindro (mayor)', '-1,00')}
              {campo('add', 'Adición', '+1,50')}
              <p className="muted small" style={{ gridColumn: '1/-1', margin: 0 }}>Tal cual figuran (con el signo). Si no tiene adición, dejalo vacío.</p>
            </div>
          </div>
        )}
      </div>

      {!r && <div className="empty">Buscando armazones…</div>}
      {r && (
        <>
          {r.fuente === 'receta' && (
            <div className="profile">
              <div className="muted small">Según tu receta</div>
              <div className="lvl">{r.nivel}</div>
              {r.criterios.length > 0 ? (
                <ul className="crit">
                  {r.criterios.map((c) => <li key={c.id}><Check size={16} /><span><b>{c.t}</b><small>{c.por}</small></span></li>)}
                </ul>
              ) : (
                <p className="muted small" style={{ margin: '4px 0 0' }}>Sin restricciones de armazón: elegí el que más te guste.</p>
              )}
            </div>
          )}

          {r.marcos.length === 0 && <div className="empty">No encontramos armazones en stock que cumplan todo. Consultá en tu óptica Orbital.</div>}
          <div className="fgrid">
            {r.marcos.map((m) => (
              <a className="frame" key={m.modelo} href={link(m.modelo)} target="_blank" rel="noopener">
                <div className="ph"><img src={m.foto} alt={'Armazón ' + m.modelo} loading="lazy" /></div>
                <div className="fb">
                  <b>{m.modelo}</b>
                  {(m.formato || m.ancho_mm) && (
                    <span className="dim num">{[m.formato && m.formato.charAt(0).toUpperCase() + m.formato.slice(1), m.ancho_mm && m.alto_mm ? `${m.ancho_mm} × ${m.alto_mm} mm` : null].filter(Boolean).join(' · ')}</span>
                  )}
                  {r.fuente === 'receta' && <span className="why">{m.motivos.slice(0, 2).join(' · ')}</span>}
                  {m.precio_desde ? <span className="price num">Desde {precioAR(m.precio_desde)}</span> : null}
                </div>
              </a>
            ))}
          </div>
          {r.lentes.length > 0 && (
            <div className="note">
              <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Para tus cristales</b>
              {r.lentes.map((l) => <div key={l}>· {l}</div>)}
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>Armazones para receta del catálogo Orbital con stock. Medidas: ancho total del frente × altura del lente. Probátelos en una óptica Orbital antes de decidir.</p>
          <a className="btn ghost block" href="/lab/rostro" target="_blank" rel="noopener"><ScanFace size={16} />¿Qué forma le va a tu cara? Escaneá tu rostro</a>
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────
export default function Pretest({ origen: origenProp }: { origen?: Origen }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const opticaOrigen = params.get('o') || null
  const src = params.get('src')
  const origen: Origen = origenProp ?? (opticaOrigen ? 'qr' : src === 'tienda' || src === 'suite' ? src : 'web')
  const soloBuscar = /\/buscar\/?$/.test(window.location.pathname) || params.has('buscar')

  const [step, setStep] = useState(soloBuscar ? PASO_BUSCAR : 0)
  const [nombre, setNombre] = useState('')
  const [edad, setEdad] = useState('')
  const [usa, setUsa] = useState<Usa>('no')
  const [calW, setCalW] = useState(CAL_DEFAULT)
  const [S, setS] = useState<Resultados>(() => resultadosIniciales(CAL_DEFAULT / CARD_MM))
  const [eye, setEye] = useState<Ojo>('R')
  const [ac, setAc] = useState<Escalera>(escaleraNueva)
  const [ct, setCt] = useState<Escalera>(escaleraNueva)
  const [na, setNa] = useState<Escalera>(escaleraNueva)
  // Distancia elegida para la prueba de lejos: 3 m con ayudante o 50 cm sin ayuda (null = todavía no eligió).
  const [modoLejos, setModoLejos] = useState<number | null>(null)
  // Medición de distancia con la cámara frontal (se puede apagar) y distancia confirmada para la prueba de lejos.
  const [usarCam, setUsarCam] = useState(true)
  const [lock, setLock] = useState<number | null>(null)
  // Guía de voz a 3 m: el celular pregunta, escucha "derecha / arriba / no la veo" y pasa solo a la letra siguiente.
  const [usarVoz, setUsarVoz] = useState(puedeEscuchar)
  const [cvI, setCvI] = useState(0)
  const [near, setNear] = useState<NearId | null>(null)
  const [informe, setInforme] = useState<Informe | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<'no' | 'si' | 'sel'>('no')
  const [scrolled, setScrolled] = useState(false)
  const [acepta, setAcepta] = useState(false)
  const [volverA, setVolverA] = useState(0)
  // Inicio: hábitos para sugerir cristales.
  const [habitos, setHabitos] = useState<Habitos>(habitosVacios)
  // Calibración en dos partes: la pantalla (tarjeta sobre el dibujo) y, opcional, la DP (tarjeta en la frente).
  const [faseCal, setFaseCal] = useState<'pantalla' | 'frente'>('pantalla')
  const hayCamara = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  // Modo espejo (Essilor): parado a 1,5 m de un espejo, mirando el reflejo de la pantalla = 3 m.
  const [espejo, setEspejo] = useState(false)
  // Extras del informe
  const [dom, setDom] = useState<Ojo | null>(null)
  const [fatiga, setFatiga] = useState<Fatiga | null>(null)
  const [previos, setPrevios] = useState<Registro[]>([])
  const [recetaFoto, setRecetaFoto] = useState<string | null>(null)
  const verLegales = () => { setVolverA(step); go(PASO_LEGAL) }

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const calibRef = useRef<HTMLDivElement>(null)
  // Calibración: con el celular vertical la tarjeta se dibuja parada (acostada no entra a lo ancho) y acostada si está
  // horizontal. calW es siempre el largo de la tarjeta en px, así girar el celular no pierde la medida.
  const [vista, setVista] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const f = () => setVista({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', f)
    window.addEventListener('orientationchange', f)
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f) }
  }, [])
  const vertical = vista.h > vista.w
  const calMax = Math.max(CAL_MIN + 50, Math.floor(vertical ? vista.h - 24 : vista.w - 40))
  const arrastre = useRef<{ x: number; y: number; w: number; lado: number } | null>(null)
  useEffect(() => {
    if (step === 1) calibRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [step, vertical])
  const ticketRef = useRef<HTMLDivElement>(null)

  const pxPerMm = calW / CARD_MM
  const edadNum = +edad || null
  const nombreT = nombre.trim()
  const enTest = step >= 1 && step <= N_PASOS
  const dist = useDistancia(usarCam && step >= 2 && step <= N_PASOS && (step !== 2 || modoLejos !== null), S.dp?.lejos ?? null)

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])

  function go(n: number) {
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------- calibración ----------
  function calibrado() {
    setS((s) => ({ ...s, pxPerMm }))
    // Si ya midió la DP (repite el chequeo) o no hay cámara, directo a las pruebas.
    if (hayCamara && !S.dp) { setFaseCal('frente'); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    empezarPruebas()
  }
  function empezarPruebas() {
    setFaseCal('pantalla')
    setEye('R')
    setAc(escaleraNueva())
    setModoLejos(null)
    setEspejo(false)
    setLock(null)
    go(2)
  }
  function dpMedida(dp: DP) {
    setS((s) => ({ ...s, dp }))
    empezarPruebas()
  }

  /** Escalera de agudeza con el anillo: devuelve la agudeza final o null si sigue la prueba. */
  function escalera(e: Escalera, set: (e: Escalera) => void, a: Dir | 'none'): number | null {
    const r = pasoEscalera(e, a, LEVELS.length)
    if ('sig' in r) { set(r.sig); return null }
    return r.fin >= 0 ? LEVELS[r.fin] : 0
  }

  // ---------- agudeza de lejos (3 m con ayudante o 50 cm) ----------
  function elegirLejos(dist: number, conEspejo = false) {
    setModoLejos(dist)
    setEspejo(conEspejo)
    setLock(null)
    setS((s) => ({ ...s, distMm: dist, espejo: conEspejo }))
    // En el espejo no se llega a tocar la pantalla: se responde por voz sí o sí.
    if (conEspejo) setUsarVoz(true)
    // La primera frase se dice dentro del toque: en iPhone la voz solo arranca desde un gesto del usuario.
    if (usarVoz || conEspejo) prepararVoz()
    if (conEspejo) {
      hablar(usarCam
        ? 'Parate frente al espejo con el celular al costado de tu cara y la pantalla mirando al espejo. Alejate despacio: te aviso cuándo frenar.'
        : 'Parate a un metro y medio del espejo, unos 2 pasos largos. ' + instrVoz(true).replace('Listo, quedate ahí. ', ''))
    } else if (usarCam) hablar(dist >= 2000 ? 'Apoyá el celular y alejate despacio. Te aviso cuándo frenar.' : 'Sostené el celular con el brazo estirado.')
    else if (dist >= 2000 && usarVoz) hablar('Apoyá el celular a la altura de tus ojos y alejate 3 metros, unos 4 pasos largos. ' + instrVoz(false).replace('Listo, quedate ahí. ', ''))
  }
  function listoLejos(mm: number) {
    setLock(mm)
    setS((s) => ({ ...s, distMm: mm }))
    if (vozLejos) hablar(instrVoz(espejo))
  }
  const vozLejos = usarVoz && (modoLejos ?? 0) >= 2000
  // Todas las pruebas se pueden responder por voz; en las del anillo las flechas quedan de respaldo.
  const pruebaE = (step === 2 && modoLejos !== null && (lock !== null || !usarCam)) || step === 3 || step === 7
  const vozPaso = pruebaE || (step >= 4 && step <= 9 && step !== 7)
  const escucha = useEscucha<unknown>(usarVoz && vozPaso, (t) => {
    if (step === 4) return entenderReloj(t)
    if (step === 5) return entenderNumero(t)
    if (step === 6) return entenderRejilla(t)
    if (step === 8) return entenderLectura(t, RENGLONES)
    if (step === 9) return entenderDuo(t)
    return interpretar(t)
  }, (o) => {
    if (o === 'repetir') return hablar(step === 2 && espejo ? instrVoz(true) : CONSIGNAS[step] ?? CONSIGNAS[2])
    tonoAnotado()
    if (step === 9) answerDuo(o as Duo)
    else if (step === 2) answerE(o as Dir | 'none')
    else if (step === 3) answerC(o as Dir | 'none')
    else if (step === 7) answerNear(o as Dir | 'none')
    else if (step === 4) answerAstig(o as boolean)
    else if (step === 5) answerColor(o === '' ? null : String(o))
    else if (step === 6) answerAmsler(o as boolean)
    else if (step === 8) {
      if (o === 'listo') {
        if (near) irDuo()
        else hablar('Primero leé en voz alta el renglón más chico que puedas, o decí ninguno.')
      } else if (o === 'ninguno') {
        setNear('J14')
        hablar('Anotado. Decí listo para seguir.')
      } else {
        setNear((o as { id: NearId }).id)
        hablar('Anotado. Si podés leer uno más chico, leelo. Si no, decí listo.')
      }
    }
  })
  const porVoz = usarVoz && pruebaE && escucha.estado === 'escuchando'
  const pista = PISTAS[step] ?? PISTAS[2]
  // Si a 3 m vuelve al celular (la cámara lo ve a menos de 1,2 m), aparecen las flechas para tocar.
  const volvioAlCel = step === 2 && (modoLejos ?? 0) >= 2000 && usarCam && dist.mm !== null && dist.mm < 1200
  const [verFlechas, setVerFlechas] = useState(false)
  useEffect(() => { setVerFlechas(false) }, [step])
  // Al entrar a cada prueba, la consigna también se dice en voz alta (la de lejos se dice al llegar a los 3 m).
  useEffect(() => {
    if (usarVoz && step >= 3 && step <= 9) hablar((step === 3 ? 'Volvé al celular. ' : '') + CONSIGNAS[step])
  }, [step, usarVoz])
  const panelVoz = usarVoz && vozPaso && (
    <div className={'escucha ' + escucha.estado} role="status">
      <Mic size={22} />
      <span>{escucha.estado === 'escuchando'
        ? (escucha.crudo ? <>Escuché “{escucha.crudo}”: {pista}</>
          : escucha.ultimo && step !== 8 ? <>Escuché: <b>“{escucha.ultimo}”</b></> : <>Te escucho: {pista}</>)
        : escucha.estado === 'sin-permiso' ? 'Sin permiso para el micrófono: respondé tocando.'
        : escucha.estado === 'error' ? 'No pude usar el micrófono: respondé tocando.'
        : escucha.estado === 'no-soportado' ? 'Este celular no reconoce la voz: respondé tocando.' : 'Preparando el micrófono…'}</span>
    </div>
  )
  /** Flechas: siempre si no hay voz; con voz, escondidas detrás de un link. */
  // En el modo espejo el anillo se dibuja invertido (para que el reflejo se vea derecho): si toca mirando la pantalla
  // de frente, lo que ve está invertido y la flecha se corrige.
  const flechas = (onAnswer: (d: Dir | 'none') => void) => !porVoz || verFlechas || volvioAlCel
    ? <DPad onAnswer={step === 2 && espejo ? (d) => onAnswer(d === 'none' ? d : ESPEJADA[d]) : onAnswer} />
    : <button className="btn ghost block" onClick={() => setVerFlechas(true)}>Responder tocando</button>
  function answerE(a: Dir | 'none') {
    const val = escalera(ac, setAc, a)
    if (val === null) return
    setS((s) => ({ ...s, acuity: { ...s.acuity, [eye]: val } }))
    if (eye === 'R') {
      setEye('L')
      setAc(escaleraNueva())
      if (vozLejos) hablar(espejo ? 'Muy bien. Ahora pasá el celular al otro ojo: tapate el derecho y mirá el reflejo con el izquierdo. Seguimos.' : 'Muy bien. Ahora destapá el ojo izquierdo y tapate el derecho. Seguimos.')
    } else {
      setCt(escaleraNueva())
      if (vozLejos) hablar(espejo ? 'Terminaste la visión de lejos. Ya podés mirar el celular de frente.' : 'Terminaste la visión de lejos. Ya podés volver al celular.')
      go(3)
    }
  }

  // ---------- agudeza de cerca (40 cm, ojo por ojo) ----------
  function answerNear(a: Dir | 'none') {
    const val = escalera(na, setNa, a)
    if (val === null) return
    setS((s) => ({ ...s, acuityNear: { ...s.acuityNear, [eye]: val } }))
    if (eye === 'R') {
      setEye('L')
      setNa(escaleraNueva())
      if (usarVoz) hablar('Muy bien. Ahora tapate el ojo derecho.')
    } else {
      setNear(null)
      if (usarVoz) hablar('Listo. Ahora elegí en la pantalla el texto más chico que leés.')
      go(8)
    }
  }

  // ---------- rojo y verde (duocromo a 40 cm, ojo por ojo) ----------
  function irDuo() {
    setEye('R')
    if (usarVoz) hablar('Anotado.')
    go(9)
  }
  function answerDuo(d: Duo) {
    setS((s) => ({ ...s, duo: { ...s.duo, [eye]: d } }))
    if (eye === 'R') {
      setEye('L')
      if (usarVoz) hablar('Ahora tapate el ojo derecho. ¿Rojo, verde o iguales?')
      return
    }
    void finish(d)
  }

  // ---------- contraste ----------
  function answerC(a: Dir | 'none') {
    const r = pasoEscalera(ct, a, CLEVELS.length)
    if ('sig' in r) return setCt(r.sig)
    setS((s) => ({ ...s, contrast: r.fin >= 0 ? CLEVELS[r.fin] : null }))
    setEye('R')
    go(4)
  }

  // ---------- astigmatismo / Amsler (ojo por ojo) ----------
  function answerAstig(eq: boolean) {
    setS((s) => ({ ...s, astig: { ...s.astig, [eye]: eq } }))
    if (eye === 'R') {
      if (usarVoz) hablar('Ahora destapá el ojo izquierdo y tapate el derecho. ¿Iguales o distintas?')
      return setEye('L')
    }
    setS((s) => ({ ...s, colorHits: 0 }))
    setCvI(0)
    go(5)
  }
  function answerAmsler(ok: boolean) {
    setS((s) => ({ ...s, amsler: { ...s.amsler, [eye]: ok } }))
    if (eye === 'R') {
      if (usarVoz) hablar('Ahora el otro ojo: tapate el derecho y mirá el punto. ¿Rectas u onduladas?')
      return setEye('L')
    }
    setEye('R')
    setNa(escaleraNueva())
    go(7)
  }

  // ---------- color ----------
  const opcionesColor = useMemo(() => {
    const d = PLATES[cvI]?.d
    if (!d) return []
    const opts = new Set([d])
    while (opts.size < 5) opts.add(String(Math.floor(Math.random() * 9) + 1))
    return [...opts].sort(() => Math.random() - 0.5)
  }, [cvI])
  useEffect(() => {
    if (step === 5 && canvasRef.current && PLATES[cvI]) drawPlate(canvasRef.current, PLATES[cvI])
  }, [step, cvI])
  function answerColor(v: string | null) {
    if (v === PLATES[cvI].d) setS((s) => ({ ...s, colorHits: s.colorHits + 1 }))
    if (cvI + 1 < PLATES.length) return setCvI(cvI + 1)
    setEye('R')
    go(6)
  }

  // ---------- informe ----------
  /** `duoOI`: la última respuesta del duocromo llega antes de que se actualice el estado. */
  async function finish(duoOI?: Duo) {
    const final: Resultados = { ...S, near, duo: duoOI ? { ...S.duo, L: duoOI } : S.duo }
    setS(final)
    const inf = evaluar(final, edadNum, usa, nombreT)
    setInforme(inf)
    setCode(null)
    setPrevios(leerHistorial())
    guardarEnHistorial(final)
    go(PASO_INFORME)
    const ticketProvisorio = armarTicket(final, inf, 'ORB-····-····', nombreT, edadNum, usa)
    const { data, error } = await supabase.rpc('pretest_guardar', {
      p: {
        origen, optica_origen: opticaOrigen, nombre: nombreT, edad: edad.trim(), usa,
        ppi: Math.round(final.pxPerMm * 25.4),
        acuity_r: final.acuity.R, acuity_l: final.acuity.L, contrast: final.contrast,
        dist_cm: Math.round(final.distMm / 10), near_r: final.acuityNear.R, near_l: final.acuityNear.L,
        astig_r: final.astig.R, astig_l: final.astig.L, color_hits: final.colorHits,
        amsler_r: final.amsler.R, amsler_l: final.amsler.L, near: final.near,
        score: inf.score, indice: inf.indice, semaforo: inf.semaforo, ticket: ticketProvisorio,
      },
    })
    const cod = !error && typeof data === 'string' ? data : null
    setCode(cod ?? codigoLocal())
    guardarExtras(cod, {
      espejo: final.espejo, duo: final.duo, dp: final.dp, habitos,
      sugerencias: sugerenciasHabitos(habitos, edadNum).length ? sugerenciasHabitos(habitos, edadNum) : undefined,
    })
  }

  const ticket = informe && code ? armarTicket(S, informe, code, nombreT, edadNum, usa) : ''
  const qrUrl = informe && code ? urlProfesional(compactar(S, code, edadNum, usa, informe.indice, informe.semaforo, dom)) : null
  const consejos = sugerenciasHabitos(habitos, edadNum)

  function copyTicket() {
    const fb = () => {
      if (!ticketRef.current) return
      const r = document.createRange()
      r.selectNodeContents(ticketRef.current)
      const s = getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      setCopiado('sel')
    }
    try {
      navigator.clipboard.writeText(ticket).then(() => {
        setCopiado('si')
        setTimeout(() => setCopiado('no'), 1800)
      }).catch(fb)
    } catch {
      fb()
    }
  }

  async function compartir() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Mi chequeo visual Orbital', text: ticket })
        return
      } catch {
        return
      }
    }
    copyTicket()
  }

  function restart() {
    setS(resultadosIniciales(pxPerMm, S.dp))
    setNear(null)
    setDom(null)
    setFatiga(null)
    setRecetaFoto(null)
    setInforme(null)
    setCode(null)
    setCopiado('no')
    go(0)
  }

  const tono = informe ? (informe.semaforo === 'rojo' ? 'bad' : informe.semaforo === 'amarillo' ? 'warn' : 'ok') : 'ok'
  const ringColor = `var(--${tono})`
  const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

  const lado = step === 0 ? <span className="side"><Clock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />10 min</span>
    : step === PASO_INFORME ? <span className="side">Informe listo</span>
    : step === PASO_BUSCAR ? <span className="side">Buscador</span>
    : step === PASO_LEGAL ? <span className="side">Aviso legal</span>
    : <span className="side num">{step} / {N_PASOS}</span>

  return (
    <div className="ovl">
      <div className="wrap">
        <header className={'top' + (scrolled ? ' scrolled' : '') + (step === 1 ? ' fijo-no' : '')}>
          <div className="brand">
            <div className="logo"><b>ORBITAL</b><span>Vision Lab</span></div>
            {lado}
          </div>
          {enTest && (
            <div className="progress">
              <div className="lbl"><span>Paso <span className="num">{step}</span> de {N_PASOS} · <b>{PASOS[step - 1]}</b></span></div>
              <div className="bar"><i style={{ width: `${(step / N_PASOS) * 100}%` }} /></div>
            </div>
          )}
        </header>

        {step === 0 && (
          <section className="step">
            <div>
              <div className="kicker"><ShieldCheck size={15} />Guía previa a tu consulta oftalmológica</div>
              <h1>Prepará tu visita al oftalmólogo en 10 minutos.</h1>
              <p>Siete pruebas de autoevaluación, de lejos y de cerca, basadas en las que usan los profesionales de la visión, adaptadas a tu pantalla. Al final recibís un informe orientativo para llevar a la consulta y te mostramos dónde atenderte cerca tuyo.</p>
              <div className="trust"><span><Check size={14} />Gratis</span><span><Check size={14} />Sin registrarte</span><span><Check size={14} />Informe en PDF</span></div>
            </div>

            <div className="needs">
              <div><CreditCard size={22} /><b>Una tarjeta</b>Crédito, débito o SUBE, para calibrar la pantalla.</div>
              <div><Ruler size={22} /><b>3 metros y un ayudante</b>Para la visión de lejos. Si estás solo, se puede a 50 cm.</div>
              <div><Sun size={22} /><b>Buena luz</b>Ambiente iluminado y brillo al máximo.</div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Qué vamos a medir</h3>
              <ul className="tests">
                {PRUEBAS.map(([t, d], i) => <li key={t}><span className="n">{i + 1}</span><span>{t}</span><small>{d}</small></li>)}
              </ul>
            </div>

            <div className="card field">
              <div className="field2">
                <div><label htmlFor="ovl-nombre">Nombre <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span></label><input type="text" id="ovl-nombre" placeholder="Ej.: Ana" autoComplete="given-name" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
                <div><label htmlFor="ovl-edad">Edad</label><input type="number" id="ovl-edad" inputMode="numeric" min={6} max={99} placeholder="42" value={edad} onChange={(e) => setEdad(e.target.value)} /></div>
              </div>
              <div>
                <label>¿Usás anteojos o lentes de contacto?</label>
                <div className="seg" role="radiogroup">
                  {([['no', 'No, nunca usé'], ['si', 'Sí, uso anteojos o lentes'], ['viejos', 'Tengo, pero son viejos o no los uso']] as [Usa, string][]).map(([k, t]) => (
                    <button key={k} role="radio" aria-checked={usa === k} className={usa === k ? 'sel' : ''} onClick={() => setUsa(k)}><span className="dot" />{t}</button>
                  ))}
                </div>
              </div>
              {usa === 'si' && <div className="note"><Glasses size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Hacé las pruebas de lejos con tus anteojos puestos.</div>}
            </div>

            <CuestionarioHabitos h={habitos} set={setHabitos} />

            <div className="legal-box">
              <b><Info size={16} />Antes de empezar</b>
              <ul>
                <li>Es una <b>guía previa</b> para ir mejor preparado al oftalmólogo. <b>No es un examen médico</b>, no diagnostica y no sirve como receta.</li>
                <li>Aunque todo te dé bien, hacete un control oftalmológico al menos cada 1 o 2 años.</li>
                <li>Si tenés <b>pérdida repentina de visión, dolor, destellos o manchas nuevas</b>, no hagas la guía: andá a una guardia oftalmológica.</li>
              </ul>
              <label className="check">
                <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
                <span>Entiendo que es una guía orientativa previa a la consulta y acepto el <button type="button" className="inline-link" onClick={verLegales}>aviso legal y de privacidad</button>.</span>
              </label>
            </div>

            <button className="btn block" onClick={() => { setFaseCal('pantalla'); go(1) }} disabled={!acepta}>Comenzar la guía</button>
            <div style={{ textAlign: 'center' }}>
              <button className="link" onClick={() => go(PASO_BUSCAR)}><MapPin size={15} />Solo quiero buscar una óptica u oftalmólogo</button>
            </div>
          </section>
        )}

        {step === 1 && faseCal === 'frente' && (
          <section className="step">
            <div>
              <div className="kicker"><ScanFace size={15} />Opcional · 30 segundos</div>
              <h2>Ahora, la tarjeta en la frente</h2>
              <p>Con la misma tarjeta medimos la <b>distancia entre tus pupilas</b>. Hace más precisa la medición de distancia de las pruebas y es la medida que te piden para hacer anteojos recetados.</p>
            </div>
            <MedirDP onListo={dpMedida} onSaltear={empezarPruebas} />
          </section>
        )}

        {step === 1 && faseCal === 'pantalla' && (
          <section className="step calibstep">
            <div>
              <h2>Calibrá tu pantalla</h2>
              <p className="small">Apoyá una tarjeta {vertical ? <b>parada</b> : <b>acostada</b>} sobre el dibujo y <b>arrastrá el borde dorado</b> con el dedo hasta que coincida <b>exactamente</b> con la tarjeta. Para el ajuste fino usá − y +.</p>
            </div>
            {/* Arrastrando con el dedo: parada crece hacia abajo (1:1); acostada está centrada y crece a los dos lados (×2). */}
            <div className="calib" ref={calibRef}
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                arrastre.current = { x: e.clientX, y: e.clientY, w: calW, lado: e.clientX >= r.left + r.width / 2 ? 1 : -1 }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const a = arrastre.current
                if (!a) return
                const delta = vertical ? e.clientY - a.y : 2 * a.lado * (e.clientX - a.x)
                setCalW(Math.round(Math.min(calMax, Math.max(CAL_MIN, a.w + delta))))
              }}
              onPointerUp={() => { arrastre.current = null }}
              onPointerCancel={() => { arrastre.current = null }}>
              <div className={'ccard' + (vertical ? ' v' : '')} style={vertical
                ? { width: (calW * CARD_H_MM) / CARD_MM, height: calW }
                : { width: calW, height: (calW * CARD_H_MM) / CARD_MM }}>
                <span className="chipc" /><span className="stripe" />
                <span className="w num">85,6 mm</span>
                <span className="manija" aria-hidden="true" />
              </div>
            </div>
            <div className="ajuste">
              <button className="btn ghost sm" onClick={() => setCalW((w) => Math.max(CAL_MIN, w - 1))} aria-label="Más chica">−</button>
              <input type="range" min={CAL_MIN} max={calMax} step={1} value={Math.min(calW, calMax)} onChange={(e) => setCalW(+e.target.value)} aria-label="Tamaño de la tarjeta" />
              <button className="btn ghost sm" onClick={() => setCalW((w) => Math.min(calMax, w + 1))} aria-label="Más grande">+</button>
            </div>
            <Guia items={[[<CreditCard size={14} />, 'Tarjeta de crédito, débito o SUBE'], [<Info size={14} />, 'Sin funda si tapa el borde'], [<Info size={14} />, vertical ? 'Si no entra, girá el celular' : 'Si no entra, poné el celular vertical']]} />
            <div className="answers2">
              <button className="btn ghost" onClick={() => go(0)}><ChevronLeft size={18} />Volver</button>
              <button className="btn" onClick={calibrado}>Coincide, seguir</button>
            </div>
          </section>
        )}

        {step === 2 && modoLejos === null && (
          <section className="step">
            <div>
              <h2>Visión de lejos: ¿cómo la hacés?</h2>
              <p>Para medir bien la visión de lejos, la letra tiene que estar lejos: a <b>3 metros</b>. Como desde ahí no llegás a tocar la pantalla, lo ideal es que alguien te ayude.</p>
            </div>
            <ComoSeHace />
            <button className="mode rec" onClick={() => elegirLejos(DIST_LEJOS_MM)}>
              <span className="badge">Recomendado</span>
              <b>{usarVoz ? 'A 3 metros, con guía de voz' : 'A 3 metros, con ayuda'}</b>
              <span>Apoyá el celular a la altura de tus ojos (contra un libro o una taza) y alejate 3 metros{usarCam ? ': el celular te avisa cuándo frenar' : ', unos 4 pasos largos'}. {usarVoz ? 'Decís en voz alta dónde está la abertura del anillo: el celular te escucha y pasa solo a la siguiente. No hace falta ayudante.' : 'Vos decís en voz alta dónde está la abertura del anillo y la otra persona lo toca en la pantalla.'}</span>
            </button>
            {puedeEscuchar() && (
              <button className="mode" onClick={() => elegirLejos(DIST_LEJOS_MM, true)}>
                <span className="badge">Sin ayudante ni 3 metros</span>
                <b>Frente a un espejo, a 1,5 m</b>
                <span>Te parás frente a un espejo y mirás el reflejo de la pantalla: por el reflejo equivale a 3 metros. Te tapás un ojo con el mismo celular y respondés en voz alta.</span>
              </button>
            )}
            <button className="mode" onClick={() => elegirLejos(DIST_MM)}>
              <b>Sin ayuda, a 50 cm</b>
              <span>Con el brazo estirado. Es menos preciso para la visión de lejos: el informe lo va a marcar como estimado.</span>
            </button>
            <label className="camopt">
              <input type="checkbox" checked={usarCam} onChange={(e) => setUsarCam(e.target.checked)} />
              <span>Medir la distancia con la cámara y avisarme en voz alta cuándo frenar. Las imágenes no salen del celular.</span>
            </label>
            {puedeEscuchar() && (
              <label className="camopt">
                <input type="checkbox" checked={usarVoz} onChange={(e) => setUsarVoz(e.target.checked)} />
                <span>Responder en voz alta a 3 m: el celular me pregunta y me escucha (usa el micrófono).</span>
              </label>
            )}
          </section>
        )}

        {step === 2 && modoLejos !== null && usarCam && lock === null && (
          <Ubicarse d={dist} objetivo={modoLejos} tol={0.1} onListo={listoLejos} espejo={espejo} onManual={() => {
            setUsarCam(false)
            setLock(modoLejos)
            if (espejo) hablar('Parate a un metro y medio del espejo, unos 2 pasos largos. ' + instrVoz(true).replace('Listo, quedate ahí. ', ''))
          }} />
        )}

        {step === 2 && modoLejos !== null && (!usarCam || lock !== null) && (
          <section className="step">
            <div>
              <h2>¿Dónde está la abertura del anillo?</h2>
              <p>{espejo
                ? 'Mirá el reflejo de la pantalla en el espejo y decí en voz alta dónde está la abertura: “arriba”, “derecha”… o en diagonal, como “abajo a la izquierda”. Si no la distinguís, decí “no la veo”.'
                : vozLejos
                ? 'Decí en voz alta dónde está la abertura: “arriba”, “derecha”… o en diagonal, como “abajo a la izquierda”. Si no la distinguís, decí “no la veo”. El celular pasa solo al siguiente.'
                : modoLejos >= 2000
                ? 'Decí en voz alta dónde está la abertura (puede estar en diagonal); tu ayudante toca esa flecha. Si no la distinguís, que toque “No la veo”.'
                : 'Tocá la flecha que apunta a la abertura del anillo (puede estar en diagonal). Si no la distinguís, tocá “No la veo”. Los anillos se achican a medida que acertás.'}</p>
            </div>
            <Ojos eye={eye} espejo={espejo} />
            <Guia items={espejo
              ? [[<Ruler size={14} />, '1,5 m del espejo · unos 2 pasos'], [<Eye size={14} />, 'Mirá el reflejo de la pantalla'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de lejos' : 'Sin anteojos']]
              : modoLejos >= 2000
              ? [[<Ruler size={14} />, '3 m · unos 4 pasos largos'], [<Eye size={14} />, 'Celular a la altura de los ojos'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de lejos' : 'Sin anteojos']]
              : [[<Ruler size={14} />, '50 cm · brazo estirado'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de lejos' : 'Sin anteojos']]} />
            {panelVoz}
            {usarCam && <Indicador d={dist} objetivo={modoLejos} tol={0.15} />}
            {usarCam && <AvisoLuz d={dist} />}
            <Stage izq={`Nivel ${ac.lvl + 1} de 6 · ${espejo ? '3 m por espejo' : S.distMm >= 1000 ? (S.distMm / 1000).toFixed(1).replace('.', ',') + ' m' : Math.round(S.distMm / 10) + ' cm'}`} der={`${letterMm(LEVELS[ac.lvl], S.distMm).toFixed(1)} mm`}>
              {/* en el espejo se dibuja invertido para que el reflejo se vea derecho */}
              <div style={espejo ? { transform: 'scaleX(-1)' } : undefined}>
                <Anillo dir={ac.dir} px={Math.max(6, letterMm(LEVELS[ac.lvl], S.distMm) * S.pxPerMm)} caja />
              </div>
            </Stage>
            <Intentos n={ac.trial} />
            {flechas(answerE)}
            {ac.lvl === 0 && ac.trial === 0 && eye === 'R' && (
              <div style={{ textAlign: 'center' }}><button className="link" onClick={() => { setModoLejos(null); setLock(null) }}>Cambiar la distancia</button></div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="step">
            <div>
              <h2>Contraste: el anillo se va aclarando</h2>
              <p>{usarVoz ? 'Con los dos ojos. Decí dónde está la abertura; cuando ya no distingas el anillo del fondo, decí “no la veo”.' : 'Con los dos ojos. Tocá la flecha que apunta a la abertura; cuando ya no distingas el anillo del fondo, tocá “No la veo”.'}</p>
            </div>
            <Guia items={[[<Eye size={14} />, 'Los dos ojos'], [<Ruler size={14} />, '50 cm'], [<Sun size={14} />, 'Brillo al máximo']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_MM} tol={0.2} />}
            <Stage izq={`Nivel ${ct.lvl + 1} de 6`} der={`Contraste ${CLEVELS[ct.lvl]}%`}>
              {(() => {
                const g = Math.round(255 * (1 - CLEVELS[ct.lvl] / 100))
                return <Anillo dir={ct.dir} px={Math.max(24, letterMm(0.2) * S.pxPerMm)} color={`rgb(${g},${g},${g})`} />
              })()}
            </Stage>
            <Intentos n={ct.trial} />
            {panelVoz}
            {flechas(answerC)}
          </section>
        )}

        {step === 4 && (
          <section className="step">
            <div>
              <h2>¿Todas las líneas se ven iguales?</h2>
              <p>Mirá el centro del reloj y fijate si algunas líneas se ven más oscuras, gruesas o nítidas que otras.</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '50 cm'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos' : 'Sin anteojos']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_MM} tol={0.2} />}
            <Stage izq="Reloj astigmático" der="12 meridianos"><Dial /></Stage>
            {panelVoz}
            <div className="answers2">
              <button className="btn ghost" onClick={() => answerAstig(true)}>Todas iguales</button>
              <button className="btn ghost" onClick={() => answerAstig(false)}>Algunas más oscuras</button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="step">
            <div>
              <h2>¿Qué número ves?</h2>
              <p>Con los dos ojos. Si no ves ningún número dentro del círculo, tocá “No veo ningún número”.</p>
            </div>
            <Stage izq={`Lámina ${cvI + 1} de 3`} der="Rojo-verde">
              <canvas ref={canvasRef} width={300} height={300} style={{ width: 'min(280px,72vw)', height: 'auto', borderRadius: '50%' }} />
            </Stage>
            {panelVoz}
            <div className="choices">
              {opcionesColor.map((v) => <button key={cvI + '-' + v} onClick={() => answerColor(v)}>{v}</button>)}
              <button className="wide" onClick={() => answerColor(null)}>No veo ningún número</button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section className="step">
            <div>
              <h2>Fijá la vista en el punto central</h2>
              <p>Sin dejar de mirar el punto: ¿las líneas se ven rectas y completas, o hay zonas onduladas, borrosas o que faltan?</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '30 cm · más cerca'], [<Glasses size={14} />, 'Con anteojos de lectura si usás']]} />
            {usarCam && <Indicador d={dist} objetivo={300} tol={0.25} />}
            <Stage izq="Rejilla de Amsler" der="Campo central 10°"><Amsler /></Stage>
            {panelVoz}
            <div className="answers2">
              <button className="btn ghost" onClick={() => answerAmsler(true)}>Rectas y completas</button>
              <button className="btn ghost" onClick={() => answerAmsler(false)}>Onduladas o con faltantes</button>
            </div>
          </section>
        )}

        {step === 7 && (
          <section className="step">
            <div>
              <h2>Visión de cerca: ¿dónde está la abertura?</h2>
              <p>Sostené el celular a <b>40 cm</b>, la distancia a la que leés un libro. {usarVoz ? 'Decí dónde está la abertura del anillo; si no la distinguís, decí “no la veo”.' : 'Tocá la flecha que apunta a la abertura del anillo; si no la distinguís, tocá “No la veo”.'}</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '40 cm · distancia de lectura'], [<Glasses size={14} />, usa === 'si' ? 'Con anteojos de lectura si usás' : 'Sin anteojos']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_CERCA_MM} tol={0.2} />}
            <Stage izq={`Nivel ${na.lvl + 1} de 6 · 40 cm`} der={`${letterMm(LEVELS[na.lvl], DIST_CERCA_MM).toFixed(1)} mm`}>
              <Anillo dir={na.dir} px={Math.max(4, letterMm(LEVELS[na.lvl], DIST_CERCA_MM) * S.pxPerMm)} caja />
            </Stage>
            <Intentos n={na.trial} />
            {panelVoz}
            {flechas(answerNear)}
          </section>
        )}

        {step === 8 && (
          <section className="step">
            <div>
              <h2>¿Cuál es el texto más chico que leés?</h2>
              <p>Elegí el último renglón que podés leer <b>sin esfuerzo</b>, sin acercar ni alejar el celular.</p>
            </div>
            <Guia items={[[<Eye size={14} />, 'Los dos ojos'], [<Ruler size={14} />, '40 cm · distancia de lectura'], [<Glasses size={14} />, 'Con anteojos de lectura si usás']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_CERCA_MM} tol={0.2} />}
            <div className="nearbox near">
              {RENGLONES.map((n) => (
                <p key={n.id} style={{ fontSize: `${((n.mm * S.pxPerMm) / 0.45).toFixed(1)}px`, lineHeight: 1.35 }}>
                  <span className="jid">{n.id}</span> {n.t}
                </p>
              ))}
            </div>
            {panelVoz}
            <div className="nearpick" role="radiogroup">
              {NEAR.map((n) => (
                <button key={n.id} role="radio" aria-checked={near === n.id} className={near === n.id ? 'sel' : ''} onClick={() => setNear(n.id)}>{n.id === 'J14' ? 'Ninguno' : n.id}</button>
              ))}
            </div>
            <button className="btn block" onClick={irDuo} disabled={!near}>Seguir</button>
          </section>
        )}

        {step === 9 && (
          <section className="step">
            <div>
              <h2>¿Dónde se ven más nítidos los anillos?</h2>
              <p>Sostené el celular a <b>40 cm</b>. Mirá los anillos negros: ¿se ven más marcados y negros sobre el <b>rojo</b>, sobre el <b>verde</b>, o <b>iguales</b>? Respondé rápido, con la primera impresión.</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '40 cm · distancia de lectura'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de cerca si usás' : 'Sin anteojos'], [<Sun size={14} />, 'Brillo al máximo']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_CERCA_MM} tol={0.2} />}
            <Stage izq="Duocromo" der="Rojo · verde">
              <Duocromo px={Math.max(28, letterMm(0.25, DIST_CERCA_MM) * S.pxPerMm)} />
            </Stage>
            {panelVoz}
            <div className="choices duo-resp">
              <button className="r" onClick={() => answerDuo('rojo')}>Rojo</button>
              <button onClick={() => answerDuo('iguales')}>Iguales</button>
              <button className="g" onClick={() => answerDuo('verde')}>Verde</button>
            </div>
          </section>
        )}

        {step === PASO_INFORME && informe && (
          <section className="step">
            <div className="report">
              <div className="rh">
                <div>
                  <div className="t">Guía previa a la consulta oftalmológica</div>
                  <div className="d">{nombreT ? nombreT + ' · ' : ''}{edadNum ? edadNum + ' años · ' : ''}{hoy}</div>
                </div>
                <span className="code">{code ?? '······'}</span>
              </div>
              <div className={'verdict ' + tono}>
                <div className="ring">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(23,23,28,.08)" strokeWidth="9" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={264 - (264 * informe.indice) / 100} />
                  </svg>
                  <div className="n"><span className="num">{informe.indice}<small>índice</small></span></div>
                </div>
                <div>
                  <h2>{informe.titulo}</h2>
                  <p>{informe.lead}</p>
                </div>
              </div>
              <table className="rtable">
                <tbody>
                  {informe.items.map((i) => (
                    <tr key={i.n}>
                      <td><span className={'status ' + i.s}><i />{i.s === 'ok' ? 'Normal' : i.s === 'warn' ? 'Revisar' : 'Consultar'}</span></td>
                      <td><div className="nm">{i.n}</div><div className="vv">{i.v}</div><div className="tx">{i.t}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rf">
                <b>Informe orientativo, no es un diagnóstico ni una receta.</b> Autoevaluación hecha por la persona con Orbital Vision Lab
                (pantalla calibrada con tarjeta, {(S.pxPerMm * 25.4).toFixed(0)} ppi). Solo un médico oftalmólogo puede examinar, diagnosticar
                e indicar anteojos. Un resultado normal no descarta enfermedades oculares: hacé tu control periódico igual.
              </div>
              {qrUrl && <QRProfesional url={qrUrl} />}
            </div>
            <AsiVes S={S} usa={usa} />

            <div className={'card flat extra' + (S.dp ? '' : ' no-print')}>
              <div className="hd"><b>Tus medidas para anteojos</b>{S.dp && <span className="tag">Con tarjeta</span>}</div>
              {S.dp ? (
                <>
                  <div className="dp-res" style={{ textAlign: 'left' }}>
                    <span className="muted small">Distancia entre pupilas (DP)</span>
                    <span className="num big">{S.dp.lejos.toFixed(1).replace('.', ',')} mm</span>
                    <span className="muted small">de lejos · {S.dp.cerca.toFixed(1).replace('.', ',')} mm de cerca. Es la medida que te piden para hacer anteojos recetados; el óptico la confirma.</span>
                  </div>
                </>
              ) : (
                <MedirDP compacto onListo={(dp) => { setS((s) => ({ ...s, dp })); guardarExtras(code, { dp }) }} />
              )}
            </div>
            {(S.amsler.R === false || S.amsler.L === false) && (
              <div className="urgent no-print"><Info size={18} /><span><b>Consultá pronto.</b> Si las líneas onduladas o las zonas faltantes aparecieron de golpe o empeoran, no esperes el turno: andá a una guardia oftalmológica.</span></div>
            )}

            <div className="actions no-print">
              <button className="btn" onClick={() => window.print()} disabled={!code}><Printer size={16} />Guardar PDF</button>
              <button className="btn ghost" onClick={compartir} disabled={!ticket}><Share2 size={16} />Compartir</button>
              <button className="btn ghost" onClick={copyTicket} disabled={!ticket}>{copiado === 'si' ? <Check size={16} /> : <Copy size={16} />}{copiado === 'si' ? 'Copiado' : copiado === 'sel' ? 'Ctrl+C' : 'Copiar'}</button>
            </div>
            <details className="more no-print">
              <summary><Info size={15} />Ver el resumen técnico para el profesional</summary>
              <div className="ticket" ref={ticketRef}>{ticket || 'Generando código…'}</div>
            </details>
            <div className="no-print"><Recordatorio meses={informe.semaforo === 'verde' ? 12 : 6} /></div>

            <div className="no-print"><Evolucion previos={previos} S={S} /></div>

            <div className="no-print" style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              <div>
                <h2>Más chequeos</h2>
                <p className="muted small" style={{ margin: 0 }}>Opcionales, de 1 minuto. Se suman a tu informe.</p>
              </div>
              <TestFatiga valor={fatiga} onListo={(f) => { setFatiga(f); guardarExtras(code, { fatiga: f }) }} />
              <OjoDominante valor={dom} onListo={(o) => { setDom(o); guardarExtras(code, { dominante: o }) }} />
            </div>

            <div className="no-print" style={{ marginTop: 12 }}>
              <h2>Tu receta y armazones</h2>
              <p className="muted small">Si el oftalmólogo te indica anteojos, subí la receta y elegí el armazón en una óptica Orbital.</p>
              <Marcos code={code} recetaFoto={!!recetaFoto} onRecetaFoto={setRecetaFoto} />
              {consejos.length > 0 && (
                <div className="note" style={{ marginTop: 12 }}>
                  <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Según tu día a día</b>
                  {consejos.map((c) => <div key={c}>· {c}</div>)}
                </div>
              )}
            </div>

            <div className="no-print" style={{ marginTop: 12 }}>
              <h2>Dónde atenderte</h2>
              <p className="muted small">Pedí turno con un oftalmólogo y, si te indica anteojos, hacelos en una óptica Orbital: con tu código tenés el chequeo registrado y atención prioritaria.</p>
              <Buscador code={code} recetaFoto={!!recetaFoto} inicial={informe.semaforo === 'verde' ? 'opticas' : 'oftalmo'} />
            </div>
            <div className="no-print" style={{ textAlign: 'center' }}>
              <button className="link" onClick={restart}>Repetir el chequeo</button>
            </div>
          </section>
        )}

        {step === PASO_BUSCAR && (
          <section className="step">
            <div>
              <div className="kicker"><MapPin size={15} />Buscador</div>
              <h1>Encontrá una óptica u oftalmólogo cerca tuyo.</h1>
              <p>Ópticas asociadas a Orbital y oftalmólogos de tu zona, con cómo llegar y turno por WhatsApp.</p>
            </div>
            <Buscador code={null} />
            <div className="card flat" style={{ display: 'grid', gap: 10 }}>
              <h3>¿Todavía no revisaste tu visión?</h3>
              <p className="muted small" style={{ margin: 0 }}>Hacé la guía visual en 10 minutos y llevá el informe a la consulta.</p>
              <button className="btn" onClick={() => go(0)}>Hacer el chequeo visual</button>
            </div>
          </section>
        )}

        {step === PASO_LEGAL && (
          <section className="step">
            <div>
              <div className="kicker"><ShieldCheck size={15} />Aviso legal y privacidad</div>
              <h1>Una guía previa, no un examen médico.</h1>
              <p className="muted small">Última actualización: 30 de septiembre de 2026.</p>
            </div>
            <div className="card legal">
              {LEGALES.map(([t, txt]) => <div key={t}><h3>{t}</h3><p>{txt}</p></div>)}
            </div>
            <button className="btn ghost" onClick={() => go(volverA)}><ChevronLeft size={18} />Volver</button>
          </section>
        )}

        <footer className="no-print">
          <b>Orbital Vision Lab</b> es una guía previa a la consulta oftalmológica de Orbital Eyewear. No es un examen médico ni un dispositivo
          médico, no diagnostica y no reemplaza la consulta con un oftalmólogo. Los resultados son orientativos y dependen de la calibración
          de tu pantalla, el brillo y la distancia. Ante una urgencia visual, acudí a una guardia.{' '}
          {step !== PASO_LEGAL && <button type="button" className="inline-link" onClick={verLegales}>Aviso legal y privacidad</button>}
        </footer>
      </div>
    </div>
  )
}
