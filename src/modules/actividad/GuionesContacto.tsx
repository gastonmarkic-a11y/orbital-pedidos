import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Copy, Check, MessageCircle, ShieldCheck } from 'lucide-react'
import { RUBROS, type RubroGuion } from '../../lib/guiones'

// Argumentos de Triple Protección (desde la carpeta de marketing). El seller los tiene a mano al contactar.
const TRIPLE = [
  { t: '☀️ UV400', d: '100% UVA/UVB. Protección solar real, no decorativa.' },
  { t: '💻 Blue Cut', d: 'Filtra la luz azul de pantallas (hasta 420nm, bloquea ~96% de la más agresiva). Menos fatiga visual.' },
  { t: '🔴 Infrarrojo (IR-A)', d: 'El argumento que NADIE usa: penetra más profundo que el UV, cuida el contorno de ojos (colágeno, anti-envejecimiento) y se asocia a daño corneal. Todos venden UV y blue cut; del IR no habla nadie.' },
]
const BANNER_PATH = 'copy/1784651895972-proteccion_total_1.jpg'

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
  const [rubro, setRubro] = useState<RubroGuion>(RUBROS[0])
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
