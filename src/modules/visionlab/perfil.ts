// Orbital Vision Lab · Perfil visual: lo que une las tres herramientas — Estudio de rostro (/lab/rostro), Medición de
// calce (/lab/calce) y chequeo visual previo a la consulta (/lab/pretest).
// Igual que el circuito de JINS (medición del rostro → examen → un solo ticket con QR), cada herramienta deja su
// resultado en el celular y la otra lo usa: el rostro ordena los armazones del informe, la DP medida con tarjeta
// reemplaza la aproximada del escaneo, y el QR del informe le muestra a la óptica visión + rostro juntos.
// Solo medidas (nunca la imagen) y solo en este navegador; se suman al lead del pretest si hay código.
import { supabase } from '../../lib/supabase'
import type { Forma, Resultado } from './rostro/medidas'
import type { Receta } from './marcos'

const KEY = 'orbital_lab_perfil'
/** Pasados estos días el resultado ya no se ofrece para unir (la cara no cambia, pero el lead sí envejece). */
const VIGENCIA_DIAS = 60

export interface PerfilRostro {
  f: string                         // fecha ISO (día)
  forma: Forma
  talle: 'S' | 'M' | 'L'
  ideal: number                     // ancho de frente ideal (mm)
  rango: [number, number]
  mm: { pomulos: number; largo: number; frente: number; mandibula: number; dp: number }
}
export interface PerfilVision {
  f: string
  code: string
  semaforo: string
  indice: number
  dp: { lejos: number; cerca: number } | null
}
/** Medición de calce (/lab/calce): un armazón puesto en vivo, medido como en la tablet de JINS. */
export interface PerfilCalce {
  f: string
  modelo: string                    // modelo del catálogo o "Tu talle ideal"
  marco: number                     // ancho del frente (mm)
  cara: number                      // ancho del rostro medido en vivo (mm)
  calce: number                     // marco / cara × 100 (100 % = justo)
  pupila: number                    // dónde cae la pupila en el lente, % desde el borde nasal (50 = centro)
  dp: number                        // DP usada (tarjeta si hay chequeo, si no la del escaneo)
  veredicto: 'justo' | 'grande' | 'chico'
}
/** Receta (valores que copió del oftalmólogo): solo en este celular, para el grosor de los cristales y los armazones. */
/** DP medida con la tarjeta en la frente fuera del chequeo (desde el estudio de rostro o el calce). */
export interface PerfilDP { f: string; lejos: number; cerca: number }
export interface Perfil { rostro?: PerfilRostro; vision?: PerfilVision; calces?: PerfilCalce[]; receta?: Receta; dp?: PerfilDP }

const hoy = () => new Date().toISOString().slice(0, 10)
const vigente = (f: string) => (Date.now() - new Date(f + 'T12:00:00').getTime()) / 864e5 <= VIGENCIA_DIAS
/** Código real del servidor (los locales de respaldo no existen en la base). */
const codigoReal = (c: string) => /^ORB-[A-Z0-9]{4}-\d{4}$/.test(c)

export function leerPerfil(): Perfil {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') as Perfil
    return {
      rostro: p.rostro && vigente(p.rostro.f) ? p.rostro : undefined,
      vision: p.vision && vigente(p.vision.f) ? p.vision : undefined,
      calces: (p.calces ?? []).filter((c) => vigente(c.f)),
      receta: p.receta,
      dp: p.dp && vigente(p.dp.f) ? p.dp : undefined,
    }
  } catch { return {} }
}
function escribir(p: Perfil) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* modo privado: el perfil vive solo en esta pestaña */ }
}

/** El rostro tal como viaja al lead y al QR (sin proporciones crudas). */
export const rostroDe = (r: Resultado, forma: Forma): PerfilRostro => ({
  f: hoy(), forma, talle: r.talle, ideal: r.ideal, rango: r.rango, mm: r.mm,
})

/** Guarda el estudio de rostro y, si ya hay un chequeo visual con código, lo suma a ese lead. Devuelve el perfil. */
export function guardarRostro(ro: PerfilRostro): Perfil {
  const p = { ...leerPerfil(), rostro: ro }
  escribir(p)
  if (p.vision && codigoReal(p.vision.code)) supabase.rpc('pretest_extras', { p_code: p.vision.code, p: { rostro: ro } }).then(() => {})
  return p
}

/** Guarda la medición de un armazón (el último medido de cada modelo, hasta 6) y la suma al lead si hay código. */
export function guardarCalce(c: Omit<PerfilCalce, 'f'>): Perfil {
  const prev = leerPerfil()
  const calces = [{ ...c, f: hoy() }, ...(prev.calces ?? []).filter((x) => x.modelo !== c.modelo)].slice(0, 6)
  const p = { ...prev, calces }
  escribir(p)
  if (p.vision && codigoReal(p.vision.code)) supabase.rpc('pretest_extras', { p_code: p.vision.code, p: { calces } }).then(() => {})
  return p
}

export function guardarReceta(receta: Receta): Perfil {
  const p = { ...leerPerfil(), receta }
  escribir(p)
  return p
}

/** Armazón de referencia para el grosor: el que mejor le calzó de los medidos, o su talle ideal. */
export function marcoDelPerfil(p: Perfil): { modelo: string | null; ancho: number | null } {
  const reales = (p.calces ?? []).filter((c) => c.modelo !== 'Tu talle ideal')
  const mejor = reales.length ? [...reales].sort((a, b) => Math.abs(a.calce - 100) - Math.abs(b.calce - 100))[0] : null
  return mejor ? { modelo: mejor.modelo, ancho: mejor.marco } : { modelo: null, ancho: p.rostro?.ideal ?? null }
}
/** DP medida con tarjeta (la del chequeo o la medida suelta), o null. Es la escala más precisa del rostro y el calce. */
export const dpTarjetaDe = (p: Perfil): { lejos: number; cerca: number } | null => p.vision?.dp ?? p.dp ?? null
/** Guarda la DP medida con la tarjeta fuera del chequeo. */
export function guardarDP(dp: { lejos: number; cerca: number }): Perfil {
  const p = { ...leerPerfil(), dp: { ...dp, f: hoy() } }
  escribir(p)
  return p
}
/** DP: la de la tarjeta si la midió, si no la del escaneo de rostro. */
export const dpDelPerfil = (p: Perfil) => dpTarjetaDe(p)?.lejos ?? p.rostro?.mm.dp ?? null

/** Guarda el chequeo visual; el pretest suma el rostro a su lead por su cuenta (guardarExtras). */
export function guardarVision(v: Omit<PerfilVision, 'f'>): Perfil {
  const p = { ...leerPerfil(), vision: { ...v, f: hoy() } }
  escribir(p)
  return p
}

// ── QR para la óptica ─────────────────────────────────────────────────────────────────────────
// Va dentro del Compacto del informe (`ro`) o solo, cuando la persona hizo el rostro sin el chequeo.
export interface RostroCompacto { fo: Forma; t: 'S' | 'M' | 'L'; w: number; r: [number, number]; mm: [number, number, number, number]; dp: number }
/** Armazones medidos: [modelo, ancho marco, calce %, pupila %]. */
export type CalceCompacto = [string, number, number, number]
export const compactarCalces = (cs?: PerfilCalce[]): CalceCompacto[] | undefined =>
  cs?.length ? cs.slice(0, 4).map((c) => [c.modelo, c.marco, c.calce, c.pupila]) : undefined

/** Cuántas de las tres partes del perfil están hechas. */
export const avance = (p: Perfil) => Number(!!p.rostro) + Number(!!p.calces?.length) + Number(!!p.vision)
export const compactarRostro = (ro: PerfilRostro): RostroCompacto => ({
  fo: ro.forma, t: ro.talle, w: ro.ideal, r: ro.rango, mm: [ro.mm.pomulos, ro.mm.largo, ro.mm.frente, ro.mm.mandibula], dp: ro.mm.dp,
})
