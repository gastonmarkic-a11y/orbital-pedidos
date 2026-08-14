// Guiones de contacto por RUBRO y CANAL. Fuente única: la usan la sección "Guiones"
// y la "Cola de prospección social". Eje: Triple Protección única en Argentina.

export interface RubroGuion {
  id: string
  emoji: string
  nombre: string
  angulo: string
  ig: string
  linkedin: string
}

const CTA = 'Diseño actual, +80 modelos con entrega inmediata. ¿Te paso catálogo y precios por WhatsApp? 👉'

// Link a la propuesta de Triple Protección (landing). Link corto que oculta la URL larga del Artifact.
// Cambiar acá cuando esté en el dominio propio (ej. orbitaleyewear.com/proteccion) para un link de marca.
export const LINK_TP = 'https://tinyurl.com/2aardntr'

export const RUBROS: RubroGuion[] = [
  {
    id: 'opticas', emoji: '🕶️', nombre: 'Ópticas', angulo: 'Negocio principal · Argentina y Sudamérica',
    ig: '¡Hola! Soy Gastón, de Orbital Eyewear 🕶️ Fabricamos los únicos anteojos de Argentina con Triple Protección en el cristal: UV400 + Infrarrojo + Blue Cut, todo en uno. Un diferencial real para tu óptica: producto premium, diseño actual, +80 modelos con entrega inmediata y posiciones exclusivas por ser fabricantes. ¿Te paso catálogo y lista por WhatsApp? 👉',
    linkedin: 'Hola {nombre}, soy Gastón Markic, Director Comercial de Orbital Eyewear. Somos fabricantes argentinos de la única línea de anteojos de sol con Triple Protección de cristales (UV400 + Infrarrojo + Blue Cut). Un diferencial enorme frente a cualquier anteojo convencional, con diseño actual. Contamos con +80 SKUs para entrega inmediata y, como fabricantes, podemos desarrollar posiciones exclusivas para tus tiendas. Me gustaría mostrarte la propuesta y trabajar juntos con algo realmente diferente. ¿Te comparto catálogo y lista?',
  },
  {
    id: 'deporte', emoji: '🏃', nombre: 'Casas de deporte', angulo: 'Para el que vive al aire libre',
    ig: '¡Hola! Soy Gastón, de Orbital Eyewear 🕶️ Anteojos de sol con Triple Protección (UV400 + Infrarrojo + Blue Cut) pensados para el que vive al aire libre: running, ciclismo, trekking, golf. Máxima protección de la vista bajo sol fuerte, con diseño deportivo. Un producto premium que suma valor y margen a tu tienda. ' + CTA,
    linkedin: 'Hola {nombre}, soy Gastón Markic, de Orbital Eyewear. Fabricamos anteojos de sol con Triple Protección de cristales (UV400 + Infrarrojo + Blue Cut), ideales para deporte outdoor (running, ciclismo, trekking, golf): máxima protección con diseño actual. Un producto premium para sumar a tu tienda, +80 SKUs con entrega inmediata. ¿Te muestro la propuesta?',
  },
  {
    id: 'pesca', emoji: '🎣', nombre: 'Pesca', angulo: 'Sol + reflejo del agua',
    ig: '¡Hola! Soy Gastón, de Orbital Eyewear 🕶️ El pescador se come horas de sol y reflejo del agua. Nuestros cristales con Triple Protección (UV400 + Infrarrojo + Blue Cut) —y modelos polarizados— cuidan la vista y ayudan a ver mejor sobre el agua. Un producto que tus clientes usan en cada salida. ¿Te paso los modelos y precios por WhatsApp? 👉',
    linkedin: 'Hola {nombre}, soy Gastón Markic, de Orbital Eyewear. Fabricamos anteojos con Triple Protección de cristales (UV400 + Infrarrojo + Blue Cut) y modelos polarizados, ideales para pesca: protegen la vista de las horas de sol y el reflejo del agua. +80 SKUs con entrega inmediata. ¿Te comparto la propuesta?',
  },
  {
    id: 'autos', emoji: '🚗', nombre: 'Concesionarias autos/motos', angulo: 'Regalo de entrega — customizable',
    ig: '¡Hola! Soy Gastón, de Orbital Eyewear 🕶️ Una idea para tus entregas: por el precio de un buen champagne, regalale al que compra un auto/moto unos anteojos con Triple Protección — un regalo que va a usar y disfrutar cada vez que maneja (protege del sol, el reflejo y el cansancio de la vista), no una botella que se toma y se olvida. Los customizamos con tu marca. ¿Te muestro la propuesta por WhatsApp? 👉',
    linkedin: 'Hola {nombre}, soy Gastón Markic, de Orbital Eyewear. Te propongo una idea para las entregas de tu concesionaria: por el precio de un buen champagne, regalá a cada comprador unos anteojos de sol con Triple Protección — un obsequio que usa y disfruta cada vez que maneja, no una botella que se olvida. Podemos customizarlos con la marca de la concesionaria. ¿Te muestro la propuesta?',
  },
  {
    id: 'showroom', emoji: '🛋️', nombre: 'Showrooms', angulo: 'Experiencia de marca',
    ig: '¡Hola! Soy Gastón, de Orbital Eyewear 🕶️ Para tu showroom: un producto premium con historia — los únicos anteojos de Argentina con Triple Protección (UV400 + Infrarrojo + Blue Cut). Diseño actual y posiciones exclusivas para crear una experiencia de marca difícil de replicar. +80 modelos, entrega inmediata. ¿Te paso la propuesta por WhatsApp? 👉',
    linkedin: 'Hola {nombre}, soy Gastón Markic, de Orbital Eyewear. Para tu showroom te propongo un producto premium con historia: la única línea con Triple Protección de cristales del país (UV400 + Infrarrojo + Blue Cut). Diseño actual y posiciones exclusivas para una experiencia de marca única. ¿Te comparto la propuesta?',
  },
]

export function mensajePara(rubroId: string, canal: 'ig' | 'linkedin', nombre?: string): string {
  const r = RUBROS.find((x) => x.id === rubroId) ?? RUBROS[0]
  const t = canal === 'linkedin' ? r.linkedin : r.ig
  const base = (nombre && nombre.trim()) ? t.replace('{nombre}', nombre.trim()) : t.replace('{nombre}', '')
  return `${base}\n\n👉 Ver más información: ${LINK_TP}`
}
