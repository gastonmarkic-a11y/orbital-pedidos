import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Copy, Check, MessageCircle, ShieldCheck } from 'lucide-react'

// Argumentos de Triple Protección (desde la carpeta de marketing). El seller los tiene a mano al contactar.
const TRIPLE = [
  { t: '☀️ UV400', d: '100% UVA/UVB. Protección solar real, no decorativa.' },
  { t: '💻 Blue Cut', d: 'Filtra la luz azul de pantallas (hasta 420nm, bloquea ~96% de la más agresiva). Menos fatiga visual.' },
  { t: '🔴 Infrarrojo (IR-A)', d: 'El argumento que NADIE usa: penetra más profundo que el UV, cuida el contorno de ojos (colágeno, anti-envejecimiento) y se asocia a daño corneal. Todos venden UV y blue cut; del IR no habla nadie.' },
]
// Imagen de marketing (bucket privado 'marketing') para el banner.
const BANNER_PATH = 'copy/1784651895972-proteccion_total_1.jpg'

// Guiones de contacto por RUBRO y CANAL + el flujo de seguimiento (recordatorio/acelerador).
// Es la fuente única de los mensajes que usa el equipo (y, más adelante, el agente Redactor).

interface Rubro {
  id: string
  emoji: string
  nombre: string
  angulo: string
  ig: string
  linkedin: string
}

const CTA = 'Diseño actual, +80 modelos con entrega inmediata. ¿Te paso catálogo y precios por WhatsApp? 👉'

const RUBROS: Rubro[] = [
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

interface Toque { dia: string; titulo: string; detalle: string }
const FLUJO: Toque[] = [
  { dia: 'Día 0', titulo: 'Calentar', detalle: 'Seguir la cuenta + like a un post (IG). En LinkedIn, pedido de conexión con nota corta. No vender todavía.' },
  { dia: 'Día 1', titulo: 'Apertura', detalle: 'El mensaje del rubro con el gancho Triple Protección + CTA a WhatsApp.' },
  { dia: 'Día 4-5', titulo: 'Acelerador (si no respondió)', detalle: 'El dato que engancha: "el Infrarrojo no lo protege ninguna otra marca en el país. Te mando el catálogo igual".' },
  { dia: 'Día 9-10', titulo: 'Cierre suave', detalle: '"Cualquier cosa quedo a mano 🙌". Se archiva si no hubo respuesta (no insistir más — protege la cuenta).' },
]

function BotonCopiar({ texto }: { texto: string }) {
  const toast = useToast()
  const [ok, setOk] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setOk(true); toast('✓ Mensaje copiado', 'success'); setTimeout(() => setOk(false), 1500)
    } catch { toast('No se pudo copiar', 'error') }
  }
  return (
    <button onClick={copiar} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 text-brandDark">
      {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copiado' : 'Copiar'}
    </button>
  )
}

export default function GuionesContacto() {
  const [rubro, setRubro] = useState<Rubro>(RUBROS[0])
  const [banner, setBanner] = useState<string | null>(null)
  useEffect(() => {
    supabase.storage.from('marketing').createSignedUrl(BANNER_PATH, 3600).then(({ data }) => setBanner(data?.signedUrl ?? null))
  }, [])
  return (
    <div className="space-y-4 text-ink">
      <div>
        <h1 className="text-lg font-bold">💬 Guiones de contacto</h1>
        <p className="text-xs text-muted">Mensajes por rubro y canal + el flujo de seguimiento. Eje: Triple Protección única en Argentina.</p>
      </div>

      {/* Banner + argumentos de Triple Protección (desde la carpeta de marketing) */}
      <div className="rounded-2xl overflow-hidden border border-black/10 bg-ink text-white">
        {banner && <img src={banner} alt="Orbital Triple Protección" className="w-full max-h-44 object-cover" />}
        <div className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-gold font-semibold flex items-center gap-1.5 mb-2"><ShieldCheck size={14} />Triple Protección · el eje de todo mensaje</p>
          <div className="grid sm:grid-cols-3 gap-2.5">
            {TRIPLE.map((x) => (
              <div key={x.t} className="bg-white/5 rounded-xl p-2.5">
                <p className="text-[13px] font-bold">{x.t}</p>
                <p className="text-[11px] text-white/70 mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 bg-white/5 rounded-xl p-2.5">
            <p className="text-[12px] text-white/90"><b className="text-gold">Cierre de venta:</b> "¿Vos te ponés protector solar en el contorno de ojos?" — Nunca. Con el filtro Infrarrojo, tu anteojo lo hace por vos.</p>
            <p className="text-[11px] text-white/60 mt-1.5">🚗 Al manejar se nota: menos deslumbramiento y fatiga. · Cristales VSL HD · +80 modelos con entrega inmediata.</p>
          </div>
        </div>
      </div>

      {/* Selector de rubro */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {RUBROS.map((r) => (
          <button key={r.id} onClick={() => setRubro(r)}
            className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${rubro.id === r.id ? 'bg-brand text-white border-brand' : 'bg-white border-black/10 text-muted'}`}>
            {r.emoji} {r.nombre}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-faint -mt-1">{rubro.emoji} <b>{rubro.nombre}</b> · {rubro.angulo}</p>

      {/* Mensajes por canal */}
      <div className="space-y-3">
        <div className="bg-white rounded-2xl border border-black/10 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><span>📷</span>Instagram · primer toque (corto)</p>
            <BotonCopiar texto={rubro.ig} />
          </div>
          <p className="text-[13px] text-muted whitespace-pre-wrap">{rubro.ig}</p>
        </div>

        <div className="bg-white rounded-2xl border border-black/10 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><span>💼</span>LinkedIn / Email (largo, B2B)</p>
            <BotonCopiar texto={rubro.linkedin} />
          </div>
          <p className="text-[13px] text-muted whitespace-pre-wrap">{rubro.linkedin}</p>
          <p className="text-[10px] text-faint mt-2">Reemplazá {'{nombre}'} por el del contacto.</p>
        </div>
      </div>

      {/* Flujo de seguimiento */}
      <div className="bg-white rounded-2xl border border-black/10 p-4">
        <p className="text-sm font-semibold flex items-center gap-1.5 mb-1"><MessageCircle size={15} className="text-brand" />Flujo de contacto · recordatorio y acelerador</p>
        <p className="text-[11px] text-faint mb-3">Máximo 3-4 toques por prospecto. Volumen diario bajo para no quemar la cuenta.</p>
        <div className="space-y-2">
          {FLUJO.map((t, i) => (
            <div key={i} className="flex gap-3 bg-[#F6F4EF] rounded-xl border border-black/5 p-2.5">
              <span className="shrink-0 text-[11px] font-bold text-brand w-16">{t.dia}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{t.titulo}</p>
                <p className="text-[12px] text-muted">{t.detalle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-faint text-center">Todo baja a WhatsApp, donde IRIS cotiza y cierra. Cada contacto entra como prospecto en la cartera.</p>
    </div>
  )
}
