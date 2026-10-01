// Orbital Vision Lab — recomendador de armazones según la graduación (2026-09-30, pedido de Gastón).
// Reglas de óptica (20/20 Magazine "ABCs of framing the high myope", Zeiss/Essilor, guías de progresivos):
//  · Miopía alta (≤ −4 D) e hipermetropía alta (≥ +3 D): lente chico (A ≤ 50 mm ≈ frente ≤ 145 mm), formas
//    redondeadas / cuadradas suaves, aro completo de acetato (disimula el borde grueso), sin envolventes.
//  · Astigmatismo (cil ≥ 1,50 D o reloj desparejo): frente plano, nada de curvatura envolvente, calce estable.
//  · Presbicia / progresivos (adición > 0): altura de lente (B) ≥ 30 mm; 26–29 mm solo con corredor corto.
//  · Graduación baja: cualquier armazón.
// El pretest mide a 50 cm: NO sirve para estimar dioptrías de lejos. Sin receta se recomienda por señales
// (astigmatismo, cerca, agudeza) y se aclara que con la receta la recomendación es exacta.
import { NearId, Resultados, Usa } from './logic'

export interface Marco {
  modelo: string
  alto_mm: number
  ancho_mm: number
  formato: string | null
  frente: string | null
  para: string | null
  foto: string
  precio_desde: number | null
}

export interface Receta { esfOD: string; esfOI: string; cil: string; add: string }
export const recetaVacia: Receta = { esfOD: '', esfOI: '', cil: '', add: '' }

export interface Criterio { id: string; t: string; por: string }
export interface Recomendacion {
  fuente: 'receta' | 'pretest'
  nivel: string                 // "Miopía alta", "Graduación baja", …
  criterios: Criterio[]
  lentes: string[]              // consejos de cristal
  marcos: (Marco & { motivos: string[] })[]
}

const num = (s: string) => {
  const v = parseFloat(s.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

const NEAR_MALA: NearId[] = ['J7', 'J10', 'J14']

export function recomendar(
  marcos: Marco[], rec: Receta, S: Resultados, edad: number | null, _usa: Usa,
): Recomendacion {
  const esfs = [num(rec.esfOD), num(rec.esfOI)].filter((v): v is number => v !== null)
  const cil = num(rec.cil)
  const add = num(rec.add)
  const conReceta = esfs.length > 0 || cil !== null || add !== null
  // La esfera que manda es la de mayor valor absoluto (el ojo con más aumento define el borde del cristal).
  const esf = esfs.length ? esfs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null

  const astig = conReceta ? Math.abs(cil ?? 0) >= 1.5 : S.astig.R === false || S.astig.L === false
  const cercaMala = (!!S.near && NEAR_MALA.includes(S.near)) || Math.min(S.acuityNear.R ?? 1, S.acuityNear.L ?? 1) < 0.5
  const presbicia = conReceta ? (add ?? 0) > 0 : (cercaMala && (edad ?? 0) >= 38)
  const miopiaAlta = esf !== null && esf <= -4
  const miopiaMedia = esf !== null && esf < -2 && esf > -4
  const hiperAlta = esf !== null && esf >= 3
  const agudezaBaja = !conReceta && Math.min(S.acuity.R ?? 0, S.acuity.L ?? 0) < 0.5

  const criterios: Criterio[] = []
  const lentes: string[] = []
  let nivel = 'Graduación baja'
  if (miopiaAlta || hiperAlta) {
    nivel = miopiaAlta ? `Miopía alta (${esf!.toFixed(2).replace(".", ",")})` : `Hipermetropía alta (+${esf!.toFixed(2).replace(".", ",")})`
    criterios.push({ id: 'chico', t: 'Lente chico · frente ≤ 145 mm', por: miopiaAlta ? 'Cuanto más chico el lente, más fino queda el borde del cristal.' : 'Un lente chico reduce el grosor del centro y el peso.' })
    criterios.push({ id: 'aro', t: 'Aro completo de acetato', por: 'El aro cubre el espesor del cristal; evitá los al aire y los metálicos finos.' })
    criterios.push({ id: 'forma', t: 'Formas redondeadas o cuadradas suaves', por: 'Las esquinas muy marcadas y los aviadores agrandan el diámetro del cristal.' })
    lentes.push('Cristal de alto índice (1.67 o 1.74) y diseño asférico para que quede fino y liviano.')
    lentes.push('Pedí que midan la distancia pupilar de cada ojo por separado.')
  } else if (miopiaMedia) {
    nivel = `Miopía moderada (${esf!.toFixed(2).replace(".", ",")})`
    criterios.push({ id: 'medio', t: 'Lente mediano · frente ≤ 150 mm', por: 'Con esta graduación conviene no pasarse de tamaño para que el borde no se note.' })
    criterios.push({ id: 'aro', t: 'Mejor con aro completo', por: 'Disimula el espesor del cristal en los bordes.' })
    lentes.push('Un índice 1.60 deja el cristal más fino que el estándar.')
  } else if (conReceta) {
    nivel = 'Graduación baja'
    lentes.push('Con esta graduación sirve casi cualquier armazón: elegí por estilo y comodidad.')
  } else if (agudezaBaja) {
    nivel = 'Sin receta todavía'
    criterios.push({ id: 'medio', t: 'Lente mediano', por: 'Tu agudeza sugiere que vas a necesitar graduación: un tamaño medio funciona bien en casi todos los casos.' })
  } else {
    nivel = 'Sin receta todavía'
  }
  if (astig) {
    criterios.push({ id: 'plano', t: 'Frente plano, sin curva envolvente', por: 'Con astigmatismo, la curvatura envolvente distorsiona la visión periférica.' })
    lentes.push('Pedí un buen calce: plaquetas o puente que no dejen girar el anteojo, así el eje del astigmatismo no se corre.')
  }
  if (presbicia) {
    criterios.push({ id: 'alto', t: 'Altura de lente ≥ 30 mm', por: 'Deja lugar para la zona de lectura de un multifocal o progresivo.' })
    lentes.push(conReceta ? 'Para progresivos, la altura de montaje la mide el óptico con el armazón puesto.' : 'Por tu edad y la prueba de cerca, es probable que te indiquen un multifocal: preferí lentes altos.')
  }

  const ids = new Set(criterios.map((c) => c.id))
  const ranked = marcos
    .map((m) => {
      let score = 0
      const motivos: string[] = []
      const envolvente = /envolvente/i.test(m.formato ?? '')
      const metal = /metal/i.test(m.frente ?? '')
      if ((ids.has('plano') || ids.has('chico') || ids.has('medio')) && envolvente) return null
      if (ids.has('chico')) {
        if (m.ancho_mm > 150) return null
        if (m.ancho_mm <= 145) { score += 3; motivos.push('Lente chico') } else score -= 1
      }
      if (ids.has('medio')) {
        if (m.ancho_mm <= 150) { score += 2; motivos.push('Tamaño medio') } else score -= 2
      }
      if (ids.has('aro')) {
        if (!metal) { score += 2; motivos.push('Aro de acetato') } else score -= 1
      }
      if (ids.has('forma') && /redondo|cuadrado/i.test(m.formato ?? '')) { score += 1; motivos.push('Forma ' + m.formato) }
      if (ids.has('plano') && !envolvente) motivos.push('Frente plano')
      if (ids.has('alto')) {
        if (m.alto_mm < 30) return null
        if (m.alto_mm >= 45) { score += 2; motivos.push(`Lente alto (${m.alto_mm} mm)`) } else score += 1
      }
      if (!motivos.length) motivos.push('Apto receta')
      return { ...m, motivos, score }
    })
    .filter((m): m is Marco & { motivos: string[]; score: number } => !!m)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ score: _s, ...m }) => m)

  return { fuente: conReceta ? 'receta' : 'pretest', nivel, criterios, lentes, marcos: ranked }
}
