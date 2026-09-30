// ── Creadores (Suite) ───────────────────────────────────────────────────────
// Tablero de Gastón sobre el plan Orbital Creator Hub, armado como Consignas:
// una tarjeta por administradora (Yamila, Mery, Gastón…) → tocás una y ves todo lo que trabajó:
//   · Resumen: toques, pedidos, venta y comisiones + embudo de Instagram.
//   · Promotores y links: cada influencer con su panel, redes, CBU y cada link /r con sus números.
//   · Contactos de Instagram: a quién le escribió ella y en qué quedó.
//   · Ventas: pedidos atribuidos.
//   · Accesos: link de su panel y de cada promotor, para copiar o mandar por WhatsApp.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, ExternalLink, RefreshCw, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { kAr, nAr, linkPanel, linkPublico, labelRed, labelFormato, type Red } from './colabUtil'

type Ig = { escrito: number; respondio: number; alta: number; descartado: number; total: number; ultimo: string | null }
type AdminCard = {
  id: number; nombre: string; clave: string; telefono: string | null; email: string | null
  pct: number; activo: boolean; ve_ig: boolean
  promotores: number; links: number; clicks: number; pedidos: number; neto: number; com_inf: number; com_adm: number
  ig: Ig
}
type LinkRow = {
  id: number; codigo: string; modelo: string; color: string | null; imagen: string | null; red: string; formato: string
  url_pub: string | null; activo: boolean; created_at: string; clicks: number; pedidos: number; neto: number; com: number
}
type Promotor = {
  id: number; nombre: string; clave: string; ref: string; telefono: string | null; email: string | null; redes: Red[] | null
  pct: number; pct_descuento: number; cbu_alias: string | null; activo: boolean; created_at: string; coleccion: string | null
  links: LinkRow[]
}
type Contacto = { usuario: string; nombre: string | null; seguidores: number; estado: string; escrito_en: string | null; actualizado_en: string | null; ultimo_por: string | null; notas: string | null }
type Venta = { order_name: string; fecha: string; modelo: string; estado: string; unidades: number; total: number; neto: number; com_inf: number; com_adm: number; influencer: string | null }
type Detalle = { promotores: Promotor[]; ig: Contacto[]; ventas: Venta[] }

type Vista = 'resumen' | 'promotores' | 'ig' | 'ventas' | 'accesos'
const ESTADO_TXT: Record<string, string> = { escrito: 'Escrito', respondio: 'Respondió', alta: 'Se sumó', descartado: 'Descartado', pendiente: 'Sin escribir' }
const ESTADO_CLS: Record<string, string> = {
  escrito: 'bg-sky-100 text-sky-800', respondio: 'bg-amber-100 text-amber-800', alta: 'bg-emerald-100 text-emerald-800',
  descartado: 'bg-neutral-100 text-neutral-500', pendiente: 'bg-neutral-100 text-neutral-500',
}
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
const wa = (tel: string | null, txt: string) => {
  const d = (tel ?? '').replace(/\D/g, '')
  const n = d ? (d.startsWith('54') ? d : `549${d.replace(/^0/, '')}`) : ''
  return `https://wa.me/${n}?text=${encodeURIComponent(txt)}`
}

export default function CreadoresSuite() {
  const [admins, setAdmins] = useState<AdminCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [vista, setVista] = useState<Vista>('resumen')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    supabase.rpc('colab_suite_panel').then(({ data, error }) => {
      if (error) { setError(error.message); return }
      const a = (data as AdminCard[]) ?? []
      setAdmins(a)
      setSel((s) => s ?? a[0]?.id ?? null)
    })
  }, [tick])

  if (error) return <p className="text-sm text-red-600 p-4">No se pudo cargar: {error}</p>
  if (!admins) return <p className="text-sm text-muted p-4">Cargando creadores…</p>
  const admin = admins.find((a) => a.id === sel) ?? admins[0]
  const tot = admins.reduce((t, a) => ({
    promotores: t.promotores + a.promotores, clicks: t.clicks + a.clicks, pedidos: t.pedidos + a.pedidos,
    neto: t.neto + Number(a.neto), ig: t.ig + a.ig.total, altas: t.altas + a.ig.alta,
  }), { promotores: 0, clicks: 0, pedidos: 0, neto: 0, ig: 0, altas: 0 })

  const tabs: [Vista, string, number?][] = [
    ['resumen', 'Resumen'],
    ['promotores', 'Promotores y links', admin?.promotores],
    ['ig', 'Contactos de Instagram', admin?.ig.total],
    ['ventas', 'Ventas', admin?.pedidos],
    ['accesos', 'Accesos'],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">🕶️ Creadores · administradoras de influencers</h2>
          <p className="text-xs text-muted">
            Todo el equipo: {tot.promotores} promotores · {nAr(tot.clicks)} toques · {tot.pedidos} pedidos · {kAr(tot.neto)} sin IVA · {tot.ig} contactados en IG ({tot.altas} se sumaron)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/influencers" className="text-xs font-semibold underline">Lista de influencers de Instagram →</Link>
          <button onClick={() => setTick((t) => t + 1)} className="text-xs text-muted flex items-center gap-1"><RefreshCw size={13} /> Actualizar</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {admins.map((a) => {
          const on = a.id === admin?.id
          return (
            <button key={a.id} onClick={() => setSel(a.id)}
              className={`text-left rounded-xl border px-4 py-3 ${on ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 hover:border-gold'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold truncate">{a.nombre}</span>
                <span className={`text-[11px] ${on ? 'text-white/60' : 'text-faint'}`}>{a.activo ? `${a.pct}% comisión` : 'inactiva'}</span>
              </div>
              <div className={`text-xs mt-1 tabular-nums ${on ? 'text-white/75' : 'text-muted'}`}>
                {a.promotores} promotores · {a.links} links · {nAr(a.clicks)} toques · {a.pedidos} pedidos
              </div>
              <div className={`text-xs tabular-nums ${on ? 'text-white/75' : 'text-muted'}`}>Venta {kAr(a.neto)} sin IVA</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-100 text-sky-800">IG {a.ig.total} contactados</span>
                {a.ig.respondio > 0 && <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">{a.ig.respondio} respondieron</span>}
                {a.ig.alta > 0 && <span className="text-[11px] rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800">{a.ig.alta} se sumaron</span>}
                {a.ig.ultimo && <span className={`text-[11px] ${on ? 'text-white/60' : 'text-faint'}`}>últ. {fecha(a.ig.ultimo)}</span>}
              </div>
            </button>
          )
        })}
      </div>

      {admin && (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-black/10">
            {tabs.map(([k, label, n]) => (
              <button key={k} onClick={() => setVista(k)}
                className={`px-3 py-2 text-sm -mb-px border-b-2 ${vista === k ? 'border-gold font-semibold' : 'border-transparent text-muted'}`}>
                {label}{n ? <span className="ml-1 text-[11px] rounded-full px-1.5 bg-neutral-100 text-neutral-700">{n}</span> : null}
              </button>
            ))}
          </nav>
          <DetalleAdmin key={`${admin.id}-${tick}`} admin={admin} vista={vista} />
        </>
      )}
    </div>
  )
}

function DetalleAdmin({ admin, vista }: { admin: AdminCard; vista: Vista }) {
  const [d, setD] = useState<Detalle | null>(null)
  useEffect(() => {
    supabase.rpc('colab_suite_admin', { p_admin: admin.id }).then(({ data }) => setD((data as Detalle) ?? { promotores: [], ig: [], ventas: [] }))
  }, [admin.id])
  if (!d) return <p className="text-sm text-muted">Cargando {admin.nombre}…</p>
  if (vista === 'resumen') return <Resumen admin={admin} d={d} />
  if (vista === 'promotores') return <Promotores d={d} />
  if (vista === 'ig') return <Contactos d={d} nombre={admin.nombre} />
  if (vista === 'ventas') return <Ventas d={d} />
  return <Accesos admin={admin} d={d} />
}

function Kpi({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight">{v}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  )
}

function Resumen({ admin, d }: { admin: AdminCard; d: Detalle }) {
  const links = d.promotores.flatMap((p) => p.links.map((l) => ({ ...l, promotor: p.nombre })))
  const top = [...links].sort((a, b) => Number(b.neto) - Number(a.neto) || b.clicks - a.clicks).slice(0, 5)
  const sinCbu = d.promotores.filter((p) => p.activo && !p.cbu_alias)
  const sinLinks = d.promotores.filter((p) => p.activo && p.links.length === 0)
  const ig = admin.ig
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi k="Promotores activos" v={admin.promotores} sub={`${admin.links} links activos`} />
        <Kpi k="Toques en los links" v={nAr(admin.clicks)} sub={`${pct(admin.pedidos, admin.clicks)} compra`} />
        <Kpi k="Pedidos pagados" v={admin.pedidos} sub={`venta ${kAr(admin.neto)} sin IVA`} />
        <Kpi k="Comisiones" v={kAr(Number(admin.com_inf) + Number(admin.com_adm))} sub={`promotores ${kAr(admin.com_inf)} · ${admin.nombre} ${kAr(admin.com_adm)}`} />
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold mb-2">Embudo de Instagram · lo que contactó {admin.nombre}</div>
        {ig.total === 0 ? <p className="text-xs text-muted">Todavía no marcó a nadie como contactado.</p> : (
          <div className="flex flex-col gap-1.5">
            {[['Contactados', ig.total], ['Respondieron', ig.respondio + ig.alta], ['Se sumaron', ig.alta]].map(([t, n]) => (
              <div key={t as string} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-muted">{t}</span>
                <div className="flex-1 h-5 rounded bg-neutral-100 overflow-hidden">
                  <div className="h-full bg-ink" style={{ width: `${ig.total ? Math.max(2, (Number(n) / ig.total) * 100) : 0}%` }} />
                </div>
                <span className="w-16 text-right tabular-nums font-semibold">{n} <span className="text-faint font-normal">{pct(Number(n), ig.total)}</span></span>
              </div>
            ))}
            {ig.descartado > 0 && <p className="text-[11px] text-faint">{ig.descartado} descartados</p>}
          </div>
        )}
      </div>

      {(sinCbu.length > 0 || sinLinks.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex flex-col gap-1">
          <div className="font-semibold">Para seguir</div>
          {sinLinks.length > 0 && <div>Sin ningún link generado: {sinLinks.map((p) => p.nombre).join(', ')}</div>}
          {sinCbu.length > 0 && <div>Falta CBU o alias (para pagarles): {sinCbu.map((p) => p.nombre).join(', ')}</div>}
        </div>
      )}

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold mb-2">Publicaciones que mejor rinden</div>
        {top.length === 0 ? <p className="text-xs text-muted">Sin links todavía.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1">Publicación</th><th>Promotor</th><th className="text-right">Toques</th><th className="text-right">Pedidos</th><th className="text-right">Venta</th></tr></thead>
            <tbody>
              {top.map((l) => (
                <tr key={l.id} className="border-t border-black/5">
                  <td className="py-1.5">{l.modelo}{l.color ? ` · ${l.color}` : ''} <span className="text-faint">({labelRed(l.red)})</span></td>
                  <td>{l.promotor}</td>
                  <td className="text-right tabular-nums">{nAr(l.clicks)}</td>
                  <td className="text-right tabular-nums">{l.pedidos}</td>
                  <td className="text-right tabular-nums">{kAr(l.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Copiar({ texto, label }: { texto: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1800) }}
      className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] font-semibold shrink-0">
      {ok ? <Check size={11} /> : <Copy size={11} />}{label ?? (ok ? 'Copiado' : 'Copiar')}
    </button>
  )
}

function Promotores({ d }: { d: Detalle }) {
  const [abierto, setAbierto] = useState<number | null>(d.promotores[0]?.id ?? null)
  if (d.promotores.length === 0) return <p className="text-sm text-muted">Todavía no dio de alta promotores.</p>
  return (
    <div className="flex flex-col gap-2">
      {d.promotores.map((p) => {
        const n = p.links.reduce((t, l) => ({ c: t.c + l.clicks, p: t.p + l.pedidos, v: t.v + Number(l.neto), m: t.m + Number(l.com) }), { c: 0, p: 0, v: 0, m: 0 })
        const open = abierto === p.id
        return (
          <div key={p.id} className={`rounded-xl border bg-white ${p.activo ? 'border-black/10' : 'border-black/5 opacity-60'}`}>
            <button onClick={() => setAbierto(open ? null : p.id)} className="w-full text-left px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold flex items-center gap-2 flex-wrap">
                  {p.nombre}
                  {!p.activo && <span className="text-[10px] rounded px-1.5 bg-neutral-100 text-neutral-500">inactivo</span>}
                  {p.coleccion && <span className="text-[10px] rounded px-1.5 bg-violet-100 text-violet-800">colección</span>}
                  {p.activo && !p.cbu_alias && <span className="text-[10px] rounded px-1.5 bg-amber-100 text-amber-800">falta CBU</span>}
                </div>
                <div className="text-xs text-muted">
                  {(p.redes ?? []).filter((r) => r.usuario).map((r) => `${labelRed(r.red)} ${r.usuario}${r.seguidores ? ` (${r.seguidores})` : ''}`).join(' · ') || 'sin redes cargadas'}
                  {' · '}{p.pct}% comisión · {p.pct_descuento}% desc. · alta {fecha(p.created_at)}
                </div>
              </div>
              <div className="text-right text-xs tabular-nums shrink-0">
                <div className="font-semibold">{kAr(n.v)}</div>
                <div className="text-muted">{p.links.length} links · {nAr(n.c)} toques · {n.p} ped.</div>
              </div>
              {open ? <ChevronUp size={16} className="mt-1 text-muted" /> : <ChevronDown size={16} className="mt-1 text-muted" />}
            </button>
            {open && (
              <div className="px-4 pb-4 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 rounded-lg bg-neutral-50 px-2 py-1.5 text-[11px]">
                  <span className="text-muted shrink-0">Panel:</span>
                  <span className="flex-1 truncate font-mono">{linkPanel(p.clave).replace('https://', '')}</span>
                  <Copiar texto={linkPanel(p.clave)} />
                  <a href={linkPanel(p.clave)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-1 font-semibold"><ExternalLink size={11} />Abrir</a>
                </div>
                <div className="text-[11px] text-muted">
                  {p.telefono ? `Tel ${p.telefono}` : 'sin teléfono'}{p.email ? ` · ${p.email}` : ''}{p.cbu_alias ? ` · CBU/alias ${p.cbu_alias}` : ''} · comisión acumulada {kAr(n.m)}
                </div>
                {p.links.length === 0 ? <p className="text-xs text-muted">Sin links generados.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead><tr className="text-left text-muted">
                        <th className="py-1">Anteojo</th><th>Dónde</th><th>Link</th><th className="text-right">Toques</th><th className="text-right">Pedidos</th><th className="text-right">Conv.</th><th className="text-right">Venta</th><th className="text-right">Comisión</th>
                      </tr></thead>
                      <tbody>
                        {p.links.map((l) => (
                          <tr key={l.id} className={`border-t border-black/5 ${l.activo ? '' : 'opacity-50'}`}>
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                {l.imagen && <img src={l.imagen} alt="" className="w-9 h-6 object-contain bg-neutral-50 rounded" />}
                                <span>{l.modelo}{l.color ? ` · ${l.color}` : ''}</span>
                              </div>
                            </td>
                            <td>{labelRed(l.red)} · {labelFormato(l.formato)}<div className="text-faint">{fecha(l.created_at)}</div></td>
                            <td>
                              <div className="flex items-center gap-1">
                                <span className="font-mono">/r/{l.codigo}</span>
                                <Copiar texto={linkPublico(l.codigo)} label=" " />
                                {l.url_pub && <a href={l.url_pub} target="_blank" rel="noopener noreferrer" className="underline">post</a>}
                              </div>
                            </td>
                            <td className="text-right tabular-nums">{nAr(l.clicks)}</td>
                            <td className="text-right tabular-nums">{l.pedidos}</td>
                            <td className="text-right tabular-nums">{pct(l.pedidos, l.clicks)}</td>
                            <td className="text-right tabular-nums">{kAr(l.neto)}</td>
                            <td className="text-right tabular-nums">{kAr(l.com)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Contactos({ d, nombre }: { d: Detalle; nombre: string }) {
  const [f, setF] = useState<string>('')
  if (d.ig.length === 0) return <p className="text-sm text-muted">{nombre} todavía no contactó a nadie de la lista de Instagram.</p>
  const lista = f ? d.ig.filter((c) => c.estado === f) : d.ig
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {['', 'escrito', 'respondio', 'alta', 'descartado'].map((k) => (
          <button key={k} onClick={() => setF(k)}
            className={`rounded-full px-3 py-1 text-xs border ${f === k ? 'bg-ink text-white border-ink' : 'bg-white border-black/10'}`}>
            {k ? ESTADO_TXT[k] : 'Todos'} <span className="opacity-70">{k ? d.ig.filter((c) => c.estado === k).length : d.ig.length}</span>
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
        {lista.map((c) => (
          <div key={c.usuario} className="px-3 py-2 flex items-center gap-3 text-xs">
            <div className="flex-1 min-w-0">
              <a href={`https://instagram.com/${c.usuario}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">@{c.usuario}</a>
              <span className="text-muted"> · {nAr(c.seguidores)} seg.{c.nombre ? ` · ${c.nombre}` : ''}</span>
              {c.notas && <div className="text-faint truncate">{c.notas}</div>}
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${ESTADO_CLS[c.estado] ?? ''}`}>{ESTADO_TXT[c.estado] ?? c.estado}</span>
            <span className="text-faint tabular-nums w-28 text-right">
              escrito {fecha(c.escrito_en)}{c.ultimo_por && c.ultimo_por !== nombre ? <><br />últ. cambio {c.ultimo_por}</> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Ventas({ d }: { d: Detalle }) {
  if (d.ventas.length === 0) return <p className="text-sm text-muted">Todavía no hay ventas atribuidas a sus promotores.</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
      <table className="w-full text-xs min-w-[640px]">
        <thead><tr className="text-left text-muted">
          <th className="p-2">Pedido</th><th>Fecha</th><th>Promotor</th><th>Modelo</th><th>Estado</th><th className="text-right">Total cliente</th><th className="text-right">Sin IVA</th><th className="text-right">Com. promotor</th><th className="text-right pr-2">Com. admin</th>
        </tr></thead>
        <tbody>
          {d.ventas.map((v) => (
            <tr key={v.order_name + v.modelo} className="border-t border-black/5">
              <td className="p-2 font-semibold">{v.order_name}</td><td>{fecha(v.fecha)}</td><td>{v.influencer ?? '—'}</td><td>{v.modelo}</td>
              <td>{v.estado}</td>
              <td className="text-right tabular-nums">{kAr(v.total)}</td><td className="text-right tabular-nums">{kAr(v.neto)}</td>
              <td className="text-right tabular-nums">{kAr(v.com_inf)}</td><td className="text-right tabular-nums pr-2">{kAr(v.com_adm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Accesos({ admin, d }: { admin: AdminCard; d: Detalle }) {
  const fila = (nombre: string, clave: string, tel: string | null, msg: string, sub: string) => (
    <div key={clave} className="flex items-center gap-2 px-3 py-2 text-xs">
      <div className="w-40 shrink-0"><div className="font-semibold truncate">{nombre}</div><div className="text-faint">{sub}</div></div>
      <span className="flex-1 truncate font-mono text-[11px]">{linkPanel(clave).replace('https://', '')}</span>
      <Copiar texto={linkPanel(clave)} />
      <a href={wa(tel, msg)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] font-semibold"><MessageCircle size={11} />WhatsApp</a>
      <a href={linkPanel(clave)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] font-semibold"><ExternalLink size={11} />Abrir</a>
    </div>
  )
  return (
    <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
      {fila(admin.nombre, admin.clave, admin.telefono,
        `Hola ${admin.nombre}! Este es tu panel de administradora de Orbital Creator Hub: ${linkPanel(admin.clave)}\nAhí das de alta a tus promotores, ves sus links y resultados, y en "Influencers" la lista de Instagram para contactar.`,
        admin.ve_ig ? 'administradora · ve la lista IG' : 'administradora')}
      {d.promotores.filter((p) => p.activo).map((p) => fila(p.nombre, p.clave, p.telefono,
        `Hola ${p.nombre}! Este es tu panel de Orbital: ${linkPanel(p.clave)}\nAhí tenés los anteojos para promocionar, los copies y tu link con descuento exclusivo para tus seguidores.`,
        'promotor'))}
    </div>
  )
}
