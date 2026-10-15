import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { TXT_APP } from '../../lib/mensajes'

// Acción de marketing: enviar el catálogo B2B a un cliente con un link/token que
// lo deja auto-asociado a su óptica. Cada vendedor tiene además su propio código
// para entrar y cargar pedidos, y hay un código corporativo.
interface Acc { codigo: string; tipo: string; vendedor: string | null; label: string | null }

export default function EnvioCatalogo() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const base = window.location.origin + '/catalogo'
  const link = (codigo: string) => `${base}?k=${codigo}`

  const [accesos, setAccesos] = useState<Acc[]>([])
  const [codCliente, setCodCliente] = useState('')
  const [gen, setGen] = useState(false)
  const [genLink, setGenLink] = useState<{ codigo: string; label: string } | null>(null)

  useEffect(() => {
    supabase.rpc('catalogo_accesos_suite').then(({ data }) => setAccesos((data as Acc[]) ?? []))
  }, [])

  const copiar = (t: string) => { navigator.clipboard?.writeText(t); toast('Copiado ✓', 'success') }
  const wa = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`

  const miCodigo = useMemo(() => accesos.find((a) => a.tipo === 'vendedor' && a.vendedor === codigoEfectivo), [accesos, codigoEfectivo])
  const corporativo = accesos.find((a) => a.tipo === 'corporativo')

  async function generarCliente() {
    if (!codCliente.trim()) return
    setGen(true); setGenLink(null)
    const { data, error } = await supabase.rpc('catalogo_link_cliente', { p_cod_cliente: codCliente.trim(), p_vendedor: codigoEfectivo })
    setGen(false)
    const r = data as any
    if (error || !r?.ok) { toast(r?.error || 'No se pudo generar el link', 'error'); return }
    setGenLink({ codigo: r.codigo, label: r.label })
  }

  const msgCliente = genLink
    ? `¡Hola! Te comparto el catálogo mayorista de Orbital para que armes tu pedido directo desde acá 🕶️\n\n${link(genLink.codigo)}\n\nEntrás sin clave y el pedido queda asociado a tu óptica. Cualquier cosa te ayudo.\n\n${TXT_APP}`
    : ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">
      <div>
        <h1 className="text-lg font-bold">Enviar catálogo</h1>
        <p className="text-sm text-neutral-500">Compartí el catálogo con un cliente. El link lo deja entrar sin clave y el pedido queda asociado a su óptica.</p>
      </div>

      <PromoGrupos />

      {/* Enviar a un cliente */}
      <section className="rounded-2xl border border-black/10 p-4 bg-white">
        <h2 className="text-sm font-semibold mb-1">📤 Enviar a un cliente</h2>
        <p className="text-[12px] text-neutral-500 mb-3">Ingresá el código de la óptica para generar su link personalizado.</p>
        <div className="flex gap-2">
          <input value={codCliente} onChange={(e) => setCodCliente(e.target.value)} placeholder="Código de cliente (ej. 031022)"
            onKeyDown={(e) => e.key === 'Enter' && generarCliente()}
            className="flex-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
          <button onClick={generarCliente} disabled={gen || !codCliente.trim()} className="rounded-lg bg-[#0004FF] text-white px-4 text-sm font-medium disabled:opacity-50">
            {gen ? 'Generando…' : 'Generar link'}
          </button>
        </div>

        {genLink && (
          <div className="mt-4 rounded-xl bg-[#0004FF]/5 border border-[#0004FF]/20 p-3 space-y-3">
            <div>
              <p className="text-[11px] font-medium text-[#0004FF]">Óptica</p>
              <p className="text-sm font-semibold">{genLink.label}</p>
            </div>
            <div className="rounded-lg bg-white border border-black/10 p-2.5">
              <p className="text-[12px] break-all">{link(genLink.codigo)}</p>
            </div>
            <div className="rounded-lg bg-white border border-black/10 p-2.5">
              <p className="text-[12px] whitespace-pre-wrap text-neutral-600">{msgCliente}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => copiar(link(genLink.codigo))} className="flex-1 rounded-lg border border-black/10 py-2 text-[13px] font-medium">Copiar link</button>
              <button onClick={() => copiar(msgCliente)} className="flex-1 rounded-lg border border-black/10 py-2 text-[13px] font-medium">Copiar mensaje</button>
              <a href={wa(msgCliente)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#25D366] text-white py-2 text-[13px] font-medium text-center">WhatsApp</a>
            </div>
          </div>
        )}
      </section>

      {/* Tu código de vendedor */}
      {miCodigo && (
        <section className="rounded-2xl border border-black/10 p-4 bg-white">
          <h2 className="text-sm font-semibold mb-1">🎫 Tu acceso de vendedor</h2>
          <p className="text-[12px] text-neutral-500 mb-3">Entrás al catálogo y podés cargar pedidos vos mismo (elegís el cliente al confirmar). Los pedidos quedan a tu nombre.</p>
          <AccesoRow codigo={miCodigo.codigo} link={link(miCodigo.codigo)} onCopy={copiar} />
        </section>
      )}

      {/* Corporativo */}
      {corporativo && (
        <section className="rounded-2xl border border-black/10 p-4 bg-white">
          <h2 className="text-sm font-semibold mb-1">🏢 Corporativo</h2>
          <p className="text-[12px] text-neutral-500 mb-3">{corporativo.label} · para cargas corporativas.</p>
          <AccesoRow codigo={corporativo.codigo} link={link(corporativo.codigo)} onCopy={copiar} />
        </section>
      )}
    </div>
  )
}

function AccesoRow({ codigo, link, onCopy }: { codigo: string; link: string; onCopy: (t: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <code className="text-sm font-bold bg-black/5 rounded px-2 py-1">{codigo}</code>
      <span className="text-[12px] text-neutral-400 break-all flex-1 hidden sm:block">{link}</span>
      <button onClick={() => onCopy(codigo)} className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-medium">Copiar código</button>
      <button onClick={() => onCopy(link)} className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-medium">Copiar link</button>
    </div>
  )
}

// Promo vigente: link genérico (no es de ninguna óptica) para reenviar a grupos. El servidor solo
// lo lista mientras no venció; la óptica se identifica al confirmar y el pedido va a su vendedor.
// Se muestra en Enviar catálogo y en Envíos de propuestas.
export function PromoGrupos() {
  const toast = useToast()
  const [promo, setPromo] = useState<Acc | null>(null)
  useEffect(() => {
    supabase.rpc('catalogo_accesos_suite').then(({ data }) => setPromo(((data as Acc[]) ?? []).find((a) => a.tipo === 'promo') ?? null))
  }, [])
  if (!promo) return null
  const link = (codigo: string) => `https://ver.orbitaleyewear.com.ar/catalogo?k=${codigo}`
  const copiar = (t: string) => { navigator.clipboard?.writeText(t); toast('Copiado ✓', 'success') }
  const wa = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`
  const tg = (texto: string, url: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`
  const msgPromo = `🕶️ Precio de octubre Orbital

El 1/11 sube la lista. Todo lo que cargues hasta el 31/10 sale con el precio de octubre.

Armá tu pedido directo desde el catálogo, sobre stock real:
${link(promo.codigo)}

Al confirmar ponés el código de tu óptica o tu CUIT y el pedido queda a tu nombre. El link deja de funcionar el 31/10.`
  return (
    <section className="rounded-2xl border border-[#0004FF]/30 p-4 bg-[#0004FF]/[0.03]">
      <h2 className="text-sm font-semibold mb-1">📣 Promo precio de octubre · link para grupos</h2>
      <p className="text-[12px] text-neutral-500 mb-3">Un solo link para todos: mandalo a tus grupos. Cada óptica se identifica al confirmar y el pedido va a su vendedor. Se desactiva solo al terminar el 31/10.</p>
      <div className="rounded-lg bg-white border border-black/10 p-2.5 mb-2">
        <p className="text-[12px] break-all">{link(promo.codigo)}</p>
      </div>
      <div className="rounded-lg bg-white border border-black/10 p-2.5 mb-3">
        <p className="text-[12px] whitespace-pre-wrap text-neutral-600">{msgPromo}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => copiar(link(promo.codigo))} className="flex-1 rounded-lg border border-black/10 bg-white py-2 text-[13px] font-medium">Copiar link</button>
        <button onClick={() => copiar(msgPromo)} className="flex-1 rounded-lg border border-black/10 bg-white py-2 text-[13px] font-medium">Copiar mensaje</button>
        <a href={tg(msgPromo.replace(link(promo.codigo), '').trim(), link(promo.codigo))} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#229ED9] text-white py-2 text-[13px] font-medium text-center">Telegram</a>
        <a href={wa(msgPromo)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#25D366] text-white py-2 text-[13px] font-medium text-center">WhatsApp</a>
      </div>
    </section>
  )
}
