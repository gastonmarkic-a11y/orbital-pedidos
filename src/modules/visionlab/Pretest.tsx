// Orbital Vision Lab: chequeo visual con el celular → informe orientativo con código ORB-XXXX-MMDD
// + buscador de ópticas Orbital y oftalmólogos cercanos. Portado de pretest-orbital.html v1.1.
// Público sin login en /lab/pretest (tienda: ?src=tienda · QR de óptica: ?o=<cod>), solo el buscador en
// /lab/buscar, y dentro de la Suite. Diseño de herramienta clínica (ref.: Zeiss Online Vision Screening,
// Warby Parker Virtual Vision Test): pasos con progreso, instrucciones con íconos, informe imprimible.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, Clock, Copy, CreditCard, Eye, EyeOff, Glasses,
  Info, LocateFixed, MapPin, Navigation, Phone, Printer, Ruler, Search, Share2, ShieldCheck, Stethoscope, Store, Sun,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { telefonosCliente } from '../../lib/telefono'
import {
  CAL_DEFAULT, CARD_H_MM, CARD_MM, CLEVELS, DIST_CERCA_MM, DIST_LEJOS_MM, DIST_MM, Dir, Eye as Ojo, Informe, LEVELS, NEAR, NearId, PLATES, Resultados, Usa,
  armarTicket, codigoLocal, drawPlate, evaluar, letterMm, rndDir,
} from './logic'
import { ComoSeHace } from './ayuda'
import { Indicador, Ubicarse, hablar, useDistancia } from './distancia'
import { Marco, Receta, recetaVacia, recomendar } from './marcos'
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

const PASOS = ['Calibración', 'Visión de lejos', 'Contraste', 'Astigmatismo', 'Visión de color', 'Visión central', 'Visión de cerca', 'Lectura']
const N_PASOS = PASOS.length
const PASO_INFORME = N_PASOS + 1
const CAL_MIN = 150
const PRUEBAS: [string, string][] = [
  ['Visión de lejos', 'A 3 m, ojo por ojo'],
  ['Sensibilidad al contraste', 'Binocular'],
  ['Astigmatismo', 'Reloj astigmático'],
  ['Visión de color', 'Láminas rojo-verde'],
  ['Visión central', 'Rejilla de Amsler'],
  ['Visión de cerca', 'A 40 cm, ojo por ojo'],
  ['Lectura', 'Texto de lectura (Jaeger)'],
]
const PASO_BUSCAR = PASO_INFORME + 1
const PASO_LEGAL = PASO_INFORME + 2

// Aviso legal (2026-09-30, pedido de Gastón: "siempre aclarar que es una guía previa para ir al oftalmólogo").
// Pendiente: revisión de un abogado. Los pedidos de la Ley 25.326 se derivan a IRIS (WhatsApp de Orbital).
const WA_IRIS = '5491178548316'
const LEGALES: [string, ReactNode][] = [
  ['Qué es esta herramienta', 'Orbital Vision Lab es una guía previa a la consulta oftalmológica: un conjunto de pruebas de autoevaluación visual que te ayuda a llegar a la consulta con información y a saber qué contarle al profesional. Es gratuita y la ofrece Orbital Eyewear con fines informativos.'],
  ['Qué no es', 'No es un examen oftalmológico, no es un dispositivo médico, no realiza diagnósticos y no reemplaza la consulta con un médico oftalmólogo. No sirve para obtener, renovar ni modificar una receta de anteojos o lentes de contacto. Un resultado "normal" no descarta enfermedades oculares: muchas no dan síntomas y solo se detectan en un control profesional.'],
  ['Cómo leer los resultados', 'Los valores son estimaciones orientativas. Dependen de la calibración de tu pantalla, el brillo, la iluminación, la distancia a la que sostengas el celular y tus respuestas. Pueden no coincidir con los de un examen profesional.'],
  ['Cuándo ir a una guardia', 'Si tenés pérdida de visión repentina, dolor ocular, ojo rojo con dolor, destellos de luz, una "cortina" o manchas nuevas en la visión, visión doble repentina o un golpe en el ojo, no hagas esta guía: consultá de inmediato en una guardia oftalmológica.'],
  ['Menores de edad', 'Las personas menores de 18 años deben hacer la guía acompañadas por un adulto responsable. Los chicos necesitan controles oftalmológicos periódicos aunque no tengan síntomas.'],
  ['Armazones y ópticas sugeridos', 'Las sugerencias de armazones son recomendaciones comerciales generales de Orbital Eyewear según criterios ópticos habituales, no una indicación médica. Los anteojos recetados se confeccionan únicamente con la receta de un profesional matriculado; el óptico confirma medidas y calce. Los oftalmólogos del buscador provienen de Google Maps: Orbital Eyewear no tiene relación con ellos ni responde por su atención.'],
  ['Tus datos', <>Si activás la medición de distancia, la cámara se usa solo dentro de tu celular para calcular a qué distancia estás: las imágenes no se guardan ni se envían. Guardamos las respuestas de la guía, el nombre y la edad si los ingresás, y tu zona aproximada (barrio o ciudad; nunca tu ubicación exacta) para generar tu código, que la óptica que elijas pueda identificar tu informe y para mejorar el servicio. No vendemos tus datos. Podés pedir acceder, corregir o borrar tus datos en cualquier momento escribiéndole a IRIS, la asistente de Orbital Eyewear, por <a href={`https://wa.me/${WA_IRIS}?text=${encodeURIComponent('Hola IRIS, quiero hacer una consulta sobre mis datos del Vision Lab')}`} target="_blank" rel="noopener">WhatsApp al +54 9 11 7854-8316</a> (Ley 25.326 de Protección de los Datos Personales). La Agencia de Acceso a la Información Pública es el órgano de control de esa ley.</>],
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

const resultadosIniciales = (pxPerMm: number): Resultados => ({
  pxPerMm, distMm: DIST_LEJOS_MM, acuity: { R: null, L: null }, acuityNear: { R: null, L: null }, contrast: null, astig: { R: null, L: null },
  colorHits: 0, amsler: { R: null, L: null }, near: null,
})

// Escalera de 2 intentos por nivel: ambos correctos para subir (agudeza y contraste).
interface Escalera { lvl: number; trial: number; hits: number; best: number; dir: Dir }
const escaleraNueva = (): Escalera => ({ lvl: 0, trial: 0, hits: 0, best: -1, dir: rndDir() })

function E({ dir, px, color = '#000' }: { dir: Dir; px: number; color?: string }) {
  const rot = { up: 270, right: 0, down: 90, left: 180 }[dir]
  return (
    <svg width={px} height={px} viewBox="0 0 5 5" style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <rect x="0" y="0" width="5" height="1" fill={color} />
      <rect x="0" y="2" width="5" height="1" fill={color} />
      <rect x="0" y="4" width="5" height="1" fill={color} />
      <rect x="0" y="0" width="1" height="5" fill={color} />
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
function Ojos({ eye }: { eye: Ojo }) {
  const card = (o: Ojo) => {
    const on = o === eye
    return (
      <div className={on ? 'on' : 'off'}>
        <span className="ic">{on ? <Eye size={18} /> : <EyeOff size={18} />}</span>
        <span><b>Ojo {o === 'R' ? 'derecho' : 'izquierdo'}</b><small>{on ? 'Evaluando' : 'Tapalo con la palma'}</small></span>
      </div>
    )
  }
  return <div className="eyes">{card('R')}{card('L')}</div>
}

function DPad({ onAnswer }: { onAnswer: (d: Dir | 'none') => void }) {
  return (
    <div className="dpad">
      <span className="blank" />
      <button onClick={() => onAnswer('up')} aria-label="Arriba"><ArrowUp size={26} /></button>
      <span className="blank" />
      <button onClick={() => onAnswer('left')} aria-label="Izquierda"><ArrowLeft size={26} /></button>
      <button className="none" onClick={() => onAnswer('none')}>No la veo</button>
      <button onClick={() => onAnswer('right')} aria-label="Derecha"><ArrowRight size={26} /></button>
      <span className="blank" />
      <button onClick={() => onAnswer('down')} aria-label="Abajo"><ArrowDown size={26} /></button>
      <span className="blank" />
    </div>
  )
}

/** Intentos del nivel actual (2 por nivel). */
const Intentos = ({ n }: { n: number }) => <div className="dots" aria-hidden="true"><i className={n >= 0 ? 'on' : ''} /><i className={n >= 1 ? 'on' : ''} /></div>

// ────────────────────────────────────────────────────────────────────────────────────────────
// Buscador de ópticas Orbital y oftalmólogos: al final del informe y solo en /lab/buscar.
function Buscador({ code, inicial = 'opticas' }: { code: string | null; inicial?: 'opticas' | 'oftalmo' }) {
  const [tab, setTab] = useState<'opticas' | 'oftalmo'>(inicial)
  const [zona, setZona] = useState<Zona | null>(null)
  const [geo, setGeo] = useState<string | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [loc, setLoc] = useState('')
  const [opticas, setOpticas] = useState<Optica[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [mapaDe, setMapaDe] = useState<string | null>(null)

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
              ? `Hola, hice el chequeo visual Orbital (código ${code}) y quiero pedir turno para hacer mis anteojos`
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
// Recomendador de armazones: por la receta (si la carga) o por las señales del pretest.
const precioAR = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function Marcos({ S, edad, usa, code }: { S: Resultados; edad: number | null; usa: Usa; code: string | null }) {
  const [marcos, setMarcos] = useState<Marco[] | null>(null)
  const [rec, setRec] = useState<Receta>(recetaVacia)
  const [abrir, setAbrir] = useState(false)

  useEffect(() => {
    supabase.rpc('pretest_marcos').then(({ data }) => setMarcos((data as Marco[] | null) ?? []))
  }, [])

  const r = useMemo(() => (marcos ? recomendar(marcos, rec, S, edad, usa) : null), [marcos, rec, S, edad, usa])
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
          <span><b>¿Ya tenés tu receta?</b><small>Cargala y ajustamos la recomendación a tu graduación exacta.</small></span>
          <span className="chev">{abrir ? '−' : '+'}</span>
        </button>
        {abrir && (
          <div className="rx-grid">
            {campo('esfOD', 'Esfera OD', '-2,50')}
            {campo('esfOI', 'Esfera OI', '-2,25')}
            {campo('cil', 'Cilindro (mayor)', '-1,00')}
            {campo('add', 'Adición', '+1,50')}
            <p className="muted small" style={{ gridColumn: '1/-1', margin: 0 }}>Copiá los valores de la receta tal cual (con el signo). Si no tiene adición, dejalo vacío.</p>
          </div>
        )}
      </div>

      {!r && <div className="empty">Buscando armazones…</div>}
      {r && (
        <>
          <div className="profile">
            <div className="muted small">{r.fuente === 'receta' ? 'Según tu receta' : 'Según tu chequeo'}</div>
            <div className="lvl">{r.nivel}</div>
            {r.criterios.length > 0 ? (
              <ul className="crit">
                {r.criterios.map((c) => <li key={c.id}><Check size={16} /><span><b>{c.t}</b><small>{c.por}</small></span></li>)}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: '4px 0 0' }}>Sin restricciones de armazón: elegí el que más te guste.</p>
            )}
            {r.fuente === 'pretest' && <p className="muted small" style={{ margin: '8px 0 0' }}>El chequeo no mide dioptrías: con tu receta la recomendación es exacta.</p>}
          </div>

          {r.marcos.length === 0 && <div className="empty">No encontramos armazones en stock que cumplan todo. Consultá en tu óptica Orbital.</div>}
          <div className="fgrid">
            {r.marcos.map((m) => (
              <a className="frame" key={m.modelo} href={link(m.modelo)} target="_blank" rel="noopener">
                <div className="ph"><img src={m.foto} alt={'Armazón ' + m.modelo} loading="lazy" /></div>
                <div className="fb">
                  <b>{m.modelo}</b>
                  <span className="dim num">{m.formato ? m.formato.charAt(0).toUpperCase() + m.formato.slice(1) + ' · ' : ''}{m.ancho_mm} × {m.alto_mm} mm</span>
                  <span className="why">{m.motivos.slice(0, 2).join(' · ')}</span>
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
          <p className="muted small" style={{ margin: 0 }}>Medidas: ancho total del frente × altura del lente. Probátelos en una óptica Orbital antes de decidir.</p>
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
  const [cvI, setCvI] = useState(0)
  const [near, setNear] = useState<NearId | null>(null)
  const [informe, setInforme] = useState<Informe | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<'no' | 'si' | 'sel'>('no')
  const [scrolled, setScrolled] = useState(false)
  const [acepta, setAcepta] = useState(false)
  const [volverA, setVolverA] = useState(0)
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
  useEffect(() => {
    if (step === 1) calibRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [step, vertical])
  const ticketRef = useRef<HTMLDivElement>(null)

  const pxPerMm = calW / CARD_MM
  const edadNum = +edad || null
  const nombreT = nombre.trim()
  const enTest = step >= 1 && step <= N_PASOS
  const dist = useDistancia(usarCam && step >= 2 && step <= N_PASOS && (step !== 2 || modoLejos !== null))

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
    setEye('R')
    setAc(escaleraNueva())
    setModoLejos(null)
    setLock(null)
    go(2)
  }

  /** Escalera de agudeza con E: devuelve la agudeza final o null si sigue la prueba. */
  function escalera(e: Escalera, set: (e: Escalera) => void, a: Dir | 'none'): number | null {
    const hits = e.hits + (a === e.dir ? 1 : 0)
    const trial = e.trial + 1
    if (trial < 2) { set({ ...e, trial, hits, dir: rndDir() }); return null }
    let best = e.best
    if (hits === 2) {
      best = e.lvl
      const lvl = e.lvl + 1
      if (lvl < LEVELS.length) { set({ lvl, trial: 0, hits: 0, best, dir: rndDir() }); return null }
    }
    return best >= 0 ? LEVELS[best] : 0
  }

  // ---------- agudeza de lejos (3 m con ayudante o 50 cm) ----------
  function elegirLejos(dist: number) {
    setModoLejos(dist)
    setLock(null)
    setS((s) => ({ ...s, distMm: dist }))
    // La primera frase se dice dentro del toque: en iPhone la voz solo arranca desde un gesto del usuario.
    if (usarCam) hablar(dist >= 2000 ? 'Apoyá el celular y alejate despacio. Te aviso cuándo frenar.' : 'Sostené el celular con el brazo estirado.')
  }
  function listoLejos(mm: number) {
    setLock(mm)
    setS((s) => ({ ...s, distMm: mm }))
  }
  function answerE(a: Dir | 'none') {
    const val = escalera(ac, setAc, a)
    if (val === null) return
    setS((s) => ({ ...s, acuity: { ...s.acuity, [eye]: val } }))
    if (eye === 'R') {
      setEye('L')
      setAc(escaleraNueva())
    } else {
      setCt(escaleraNueva())
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
    } else {
      setNear(null)
      go(8)
    }
  }

  // ---------- contraste ----------
  function answerC(a: Dir | 'none') {
    const hits = ct.hits + (a === ct.dir ? 1 : 0)
    const trial = ct.trial + 1
    if (trial < 2) return setCt({ ...ct, trial, hits, dir: rndDir() })
    let best = ct.best
    if (hits === 2) {
      best = ct.lvl
      const lvl = ct.lvl + 1
      if (lvl < CLEVELS.length) return setCt({ lvl, trial: 0, hits: 0, best, dir: rndDir() })
    }
    setS((s) => ({ ...s, contrast: best >= 0 ? CLEVELS[best] : null }))
    setEye('R')
    go(4)
  }

  // ---------- astigmatismo / Amsler (ojo por ojo) ----------
  function answerAstig(eq: boolean) {
    setS((s) => ({ ...s, astig: { ...s.astig, [eye]: eq } }))
    if (eye === 'R') return setEye('L')
    setS((s) => ({ ...s, colorHits: 0 }))
    setCvI(0)
    go(5)
  }
  function answerAmsler(ok: boolean) {
    setS((s) => ({ ...s, amsler: { ...s.amsler, [eye]: ok } }))
    if (eye === 'R') return setEye('L')
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
  async function finish() {
    const final: Resultados = { ...S, near }
    setS(final)
    const inf = evaluar(final, edadNum, usa, nombreT)
    setInforme(inf)
    setCode(null)
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
    setCode(!error && typeof data === 'string' ? data : codigoLocal())
  }

  const ticket = informe && code ? armarTicket(S, informe, code, nombreT, edadNum, usa) : ''

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
    setS(resultadosIniciales(pxPerMm))
    setNear(null)
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
              {usa === 'si' && <div className="note"><Glasses size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Hacé las pruebas de lejos con tus anteojos puestos: así vemos si tu graduación actual todavía te sirve.</div>}
            </div>

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

            <button className="btn block" onClick={() => go(1)} disabled={!acepta}>Comenzar la guía</button>
            <div style={{ textAlign: 'center' }}>
              <button className="link" onClick={() => go(PASO_BUSCAR)}><MapPin size={15} />Solo quiero buscar una óptica u oftalmólogo</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="step calibstep">
            <div>
              <h2>Calibrá tu pantalla</h2>
              <p className="small">Apoyá una tarjeta {vertical ? <b>parada</b> : <b>acostada</b>} sobre el dibujo y mové el control hasta que coincida <b>exactamente</b> con el borde.</p>
            </div>
            <div className="calib" ref={calibRef}>
              <div className={'ccard' + (vertical ? ' v' : '')} style={vertical
                ? { width: (calW * CARD_H_MM) / CARD_MM, height: calW }
                : { width: calW, height: (calW * CARD_H_MM) / CARD_MM }}>
                <span className="chipc" /><span className="stripe" />
                <span className="w num">85,6 mm</span>
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
              <b>A 3 metros, con ayuda</b>
              <span>Apoyá el celular a la altura de tus ojos (contra un libro o una taza) y alejate 3 metros{usarCam ? ': el celular te avisa cuándo frenar' : ', unos 4 pasos largos'}. Vos decís en voz alta hacia dónde apunta la E y la otra persona lo toca en la pantalla.</span>
            </button>
            <button className="mode" onClick={() => elegirLejos(DIST_MM)}>
              <b>Sin ayuda, a 50 cm</b>
              <span>Con el brazo estirado. Es menos preciso para la visión de lejos: el informe lo va a marcar como estimado.</span>
            </button>
            <label className="camopt">
              <input type="checkbox" checked={usarCam} onChange={(e) => setUsarCam(e.target.checked)} />
              <span>Medir la distancia con la cámara y avisarme en voz alta cuándo frenar. Las imágenes no salen del celular.</span>
            </label>
          </section>
        )}

        {step === 2 && modoLejos !== null && usarCam && lock === null && (
          <Ubicarse d={dist} objetivo={modoLejos} tol={0.1} onListo={listoLejos} onManual={() => { setUsarCam(false); setLock(modoLejos) }} />
        )}

        {step === 2 && modoLejos !== null && (!usarCam || lock !== null) && (
          <section className="step">
            <div>
              <h2>¿Hacia dónde apunta la E?</h2>
              <p>{modoLejos >= 2000
                ? 'Decí en voz alta hacia dónde apuntan las patas de la letra; tu ayudante toca esa flecha. Si no la distinguís, que toque “No la veo”.'
                : 'Tocá la flecha hacia donde apuntan las patas de la letra. Si no la distinguís, tocá “No la veo”. Las letras se achican a medida que acertás.'}</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={modoLejos >= 2000
              ? [[<Ruler size={14} />, '3 m · unos 4 pasos largos'], [<Eye size={14} />, 'Celular a la altura de los ojos'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de lejos' : 'Sin anteojos']]
              : [[<Ruler size={14} />, '50 cm · brazo estirado'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos de lejos' : 'Sin anteojos']]} />
            {usarCam && <Indicador d={dist} objetivo={modoLejos} tol={0.15} />}
            <Stage izq={`Nivel ${ac.lvl + 1} de 6 · ${S.distMm >= 1000 ? (S.distMm / 1000).toFixed(1).replace('.', ',') + ' m' : Math.round(S.distMm / 10) + ' cm'}`} der={`${letterMm(LEVELS[ac.lvl], S.distMm).toFixed(1)} mm`}>
              <E dir={ac.dir} px={Math.max(6, letterMm(LEVELS[ac.lvl], S.distMm) * S.pxPerMm)} />
            </Stage>
            <Intentos n={ac.trial} />
            <DPad onAnswer={answerE} />
            {ac.lvl === 0 && ac.trial === 0 && eye === 'R' && (
              <div style={{ textAlign: 'center' }}><button className="link" onClick={() => { setModoLejos(null); setLock(null) }}>Cambiar la distancia</button></div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="step">
            <div>
              <h2>Contraste: la E se va aclarando</h2>
              <p>Con los dos ojos. Tocá hacia dónde apunta; cuando ya no la distingas del fondo, tocá “No la veo”.</p>
            </div>
            <Guia items={[[<Eye size={14} />, 'Los dos ojos'], [<Ruler size={14} />, '50 cm'], [<Sun size={14} />, 'Brillo al máximo']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_MM} tol={0.2} />}
            <Stage izq={`Nivel ${ct.lvl + 1} de 6`} der={`Contraste ${CLEVELS[ct.lvl]}%`}>
              {(() => {
                const g = Math.round(255 * (1 - CLEVELS[ct.lvl] / 100))
                return <E dir={ct.dir} px={Math.max(24, letterMm(0.2) * S.pxPerMm)} color={`rgb(${g},${g},${g})`} />
              })()}
            </Stage>
            <Intentos n={ct.trial} />
            <DPad onAnswer={answerC} />
          </section>
        )}

        {step === 4 && (
          <section className="step">
            <div>
              <h2>¿Todas las líneas se ven iguales?</h2>
              <p>Mirá el centro del reloj. Si algunas líneas se ven más oscuras, gruesas o nítidas que otras, puede ser señal de astigmatismo.</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '50 cm'], [<Glasses size={14} />, usa === 'si' ? 'Con tus anteojos' : 'Sin anteojos']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_MM} tol={0.2} />}
            <Stage izq="Reloj astigmático" der="12 meridianos"><Dial /></Stage>
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
            <div className="answers2">
              <button className="btn ghost" onClick={() => answerAmsler(true)}>Rectas y completas</button>
              <button className="btn ghost" onClick={() => answerAmsler(false)}>Onduladas o con faltantes</button>
            </div>
          </section>
        )}

        {step === 7 && (
          <section className="step">
            <div>
              <h2>Visión de cerca: ¿hacia dónde apunta la E?</h2>
              <p>Sostené el celular a <b>40 cm</b>, la distancia a la que leés un libro. Tocá hacia dónde apuntan las patas de la letra; si no la distinguís, tocá “No la veo”.</p>
            </div>
            <Ojos eye={eye} />
            <Guia items={[[<Ruler size={14} />, '40 cm · distancia de lectura'], [<Glasses size={14} />, usa === 'si' ? 'Con anteojos de lectura si usás' : 'Sin anteojos']]} />
            {usarCam && <Indicador d={dist} objetivo={DIST_CERCA_MM} tol={0.2} />}
            <Stage izq={`Nivel ${na.lvl + 1} de 6 · 40 cm`} der={`${letterMm(LEVELS[na.lvl], DIST_CERCA_MM).toFixed(1)} mm`}>
              <E dir={na.dir} px={Math.max(4, letterMm(LEVELS[na.lvl], DIST_CERCA_MM) * S.pxPerMm)} />
            </Stage>
            <Intentos n={na.trial} />
            <DPad onAnswer={answerNear} />
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
              {[...NEAR].reverse().filter((n) => n.id !== 'J14').map((n) => (
                <p key={n.id} style={{ fontSize: `${((n.mm * S.pxPerMm) / 0.45).toFixed(1)}px`, lineHeight: 1.35 }}>
                  <span className="jid">{n.id}</span> {n.t}
                </p>
              ))}
            </div>
            <div className="nearpick" role="radiogroup">
              {NEAR.map((n) => (
                <button key={n.id} role="radio" aria-checked={near === n.id} className={near === n.id ? 'sel' : ''} onClick={() => setNear(n.id)}>{n.id === 'J14' ? 'Ninguno' : n.id}</button>
              ))}
            </div>
            <button className="btn block" onClick={finish} disabled={!near}>Ver mi informe</button>
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

            <div className="no-print" style={{ marginTop: 12 }}>
              <h2>Armazones recomendados para vos</h2>
              <p className="muted small">Según la graduación conviene un tamaño, una forma y un material de armazón: así el cristal queda más fino, liviano y ves mejor.</p>
              <Marcos S={S} edad={edadNum} usa={usa} code={code} />
            </div>

            <div className="no-print" style={{ marginTop: 12 }}>
              <h2>Dónde atenderte</h2>
              <p className="muted small">Pedí turno con un oftalmólogo para confirmar la graduación y hacé tus anteojos en una óptica Orbital: con tu código tenés el chequeo registrado y atención prioritaria.</p>
              <Buscador code={code} inicial={informe.semaforo === 'verde' ? 'opticas' : 'oftalmo'} />
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
