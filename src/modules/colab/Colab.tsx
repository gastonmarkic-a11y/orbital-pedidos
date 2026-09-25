// ── Colaboradores · ver.orbitaleyewear.com.ar/colab?k=<clave> ─────────────────
// Tres niveles, el rol lo define la clave (misma URL, sin login por mail):
//   orbital    → Administradores (alta + números) · Dashboard · Liquidación
//   admin      → Promotores (alta de sus influencers + redes) · Dashboard · Liquidación
//   influencer → Anteojos (data + copies + su link) · Mis links · Dashboard
// Los links públicos son /r/<codigo> (ver ColabRedireccion). Todo va por RPC colab_*.
import { useEffect, useState } from 'react'
import { LogOut, Plus, Pencil, MessageCircle, Users, ExternalLink, Power, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ACENTO, CLAVE_KEY, Entrada, Influencer, Admin, MiLink, Red, REDES,
  kAr, nAr, labelRed, labelFormato, linkPanel, linkPublico,
} from './colabUtil'
import ColabAnteojos, { BotonCopiar } from './ColabAnteojos'
import ColabFichas from './ColabFichas'
import ColabDashboard, { Liquidacion } from './ColabDashboard'
import ColabAgregar from './ColabAgregar'
import ColabPropuestas from './ColabPropuestas'
import ColabInfluencers from './ColabInfluencers'
import InstalarApp from '../../components/InstalarApp'
import ColabInspiracion from './ColabInspiracion'
import './colab-oscuro.css'

const ROL_TXT = { orbital: 'Orbital', admin: 'Administrador', influencer: 'Promotor' } as const

function Marca({ oscuro }: { oscuro?: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" style={{ height: 18 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      {/* En el celular va solo el logo: con el nombre al lado no entran los dos. */}
      <span className="hidden sm:inline text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: oscuro ? '#FFFFFF' : ACENTO }}>Colaboradores</span>
    </div>
  )
}

function Gate({ onOk }: { onOk: (c: string, e: Entrada) => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  async function probar(ev: React.FormEvent) {
    ev.preventDefault(); setCargando(true); setErr(null)
    const { data, error } = await supabase.rpc('colab_entrar', { p_clave: v.trim() })
    setCargando(false)
    if (error) { setErr('Error de conexión'); return }
    if (data) onOk(v.trim(), data as Entrada)
    else setErr('Clave incorrecta o inactiva')
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <form onSubmit={probar} className="w-full max-w-sm border border-black/10 rounded-2xl shadow-sm p-8">
        <Marca />
        <div className="h-px bg-gradient-to-r from-[#0004FF]/60 to-transparent my-4" />
        <p className="text-sm text-neutral-600 mb-5">Ingresá tu clave de acceso.</p>
        <input autoFocus type="password" placeholder="Clave" value={v} onChange={(e) => setV(e.target.value)}
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/40" />
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button disabled={cargando} className="w-full mt-4 rounded-lg text-white py-2.5 text-sm font-medium disabled:opacity-50" style={{ background: ACENTO }}>
          {cargando ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

export default function Colab() {
  const [clave, setClave] = useState<string | null>(null)
  const [ent, setEnt] = useState<Entrada | null | undefined>(undefined)

  // Panel de Zaira (cobranding ZN): el ícono instalado se llama "ZAIRA". En Android lo da
  // api/colab-manifest.js; iPhone toma el nombre de este meta al "Agregar a inicio".
  useEffect(() => {
    if (ent?.rol !== 'influencer' || ent.ref !== 'zn') return
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'ZAIRA')
    document.title = 'ZAIRA'
  }, [ent])

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k') || localStorage.getItem(CLAVE_KEY)
    if (!k) { setEnt(null); return }
    supabase.rpc('colab_entrar', { p_clave: k }).then(({ data }) => {
      if (data) {
        localStorage.setItem(CLAVE_KEY, k); setClave(k); setEnt(data as Entrada)
        // Saca la clave de la barra: si comparten captura o la URL, no viaja.
        if (window.location.search) window.history.replaceState(null, '', '/colab')
      } else { localStorage.removeItem(CLAVE_KEY); setEnt(null) }
    })
  }, [])

  if (ent === undefined) return <p className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Cargando…</p>
  if (!ent || !clave) {
    return <Gate onOk={(c, e) => { localStorage.setItem(CLAVE_KEY, c); setClave(c); setEnt(e) }} />
  }
  return <Panel clave={clave} ent={ent} salir={() => { localStorage.removeItem(CLAVE_KEY); setClave(null); setEnt(null) }} />
}

type Tab = 'admins' | 'promotores' | 'propuestas' | 'influencers' | 'anteojos' | 'inspiracion' | 'links' | 'fichas' | 'dashboard' | 'liquidacion'
// Inspiración y Links son internos: el promotor ve solo sus anteojos y su dashboard.
const TABS: Record<Entrada['rol'], [Tab, string][]> = {
  orbital: [['admins', 'Administradores'], ['propuestas', 'Propuestas'], ['influencers', 'Influencers'], ['inspiracion', 'Inspiración'], ['links', 'Links'], ['dashboard', 'Dashboard'], ['liquidacion', 'Liquidación']],
  admin: [['promotores', 'Promotores'], ['links', 'Links'], ['dashboard', 'Dashboard'], ['liquidacion', 'Liquidación']],
  influencer: [['anteojos', 'Anteojos'], ['fichas', 'Cámara'], ['dashboard', 'Dashboard']],
}

function Panel({ clave, ent, salir }: { clave: string; ent: Entrada; salir: () => void }) {
  // Algunos administradores (Mery) también escriben a los influencers de Instagram.
  const tabs: [Tab, string][] = ent.rol === 'admin' && ent.influencers_ig
    ? [TABS.admin[0], ['influencers', 'Influencers'], ...TABS.admin.slice(1)]
    : TABS[ent.rol]
  const [tab, setTab] = useState<Tab>(tabs[0][0])
  const [version, setVersion] = useState(0)
  const [adminSel, setAdminSel] = useState<number | null>(null)
  const [admins, setAdmins] = useState<Admin[] | null>(null)
  // Promotor de colección: "Agregar anteojos" abre toda la tienda para proponer SKU.
  const [agregando, setAgregando] = useState(false)
  // Anteojos en negro, como la tienda; Inspiración, Mis links y Dashboard en blanco (se leen mejor).
  const oscuro = ent.rol === 'influencer' && tab === 'anteojos'

  useEffect(() => {
    if (ent.rol === 'orbital') supabase.rpc('colab_orbital_admins', { p_clave: clave }).then(({ data }) => setAdmins((data as Admin[]) ?? []))
  }, [clave, ent.rol, version])

  return (
    <div className={`min-h-screen ${oscuro ? 'colab-oscuro' : 'bg-[#FAFAFA]'}`}>
      <header className="bg-white border-b border-black/5 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Marca oscuro={oscuro} />
          <div className="ml-auto min-w-0 text-right leading-tight">
            <div className="text-[12px] font-bold truncate">{ent.nombre}</div>
            <div className="text-[10px] text-neutral-500 truncate">
              {ROL_TXT[ent.rol]}{ent.rol === 'admin' || ent.rol === 'influencer' ? ` · ${ent.pct}%` : ''}
              {ent.rol === 'influencer' && ent.admin ? <span className="hidden sm:inline"> · {ent.admin}</span> : null}
            </div>
          </div>
          <InstalarApp nombre="Orbital Colaboradores" que="tu panel" urlParaInstalar={`/colab?k=${clave}`}
            bajada="Queda con el ícono de Orbital y entra directo a tu panel, sin clave." />
          <button onClick={salir} title="Salir" className="p-1.5 rounded-md hover:bg-black/5"><LogOut size={16} /></button>
        </div>
        {oscuro ? (
          // Panel del promotor: pestañas como botones blancos; la activa en azul
          <div className="max-w-5xl mx-auto px-4 pt-1 pb-3 flex gap-2 overflow-x-auto">
            {tabs.map(([id, t]) => (
              <button key={id} onClick={() => setTab(id)}
                className="rounded-full px-4 py-1.5 text-[12px] font-semibold whitespace-nowrap"
                style={tab === id ? { background: ACENTO, color: '#FFFFFF' } : { background: '#FFFFFF', color: '#0A0A0A' }}>{t}</button>
            ))}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
            {tabs.map(([id, t]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-2 text-[12px] font-semibold border-b-2 whitespace-nowrap ${tab === id ? '' : 'border-transparent text-neutral-500'}`}
                style={tab === id ? { borderColor: ACENTO, color: ACENTO } : undefined}>{t}</button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {ent.rol === 'orbital' && (tab === 'dashboard' || tab === 'liquidacion' || tab === 'links') && admins && admins.length > 0 && (
          <select value={adminSel ?? ''} onChange={(e) => setAdminSel(e.target.value ? Number(e.target.value) : null)}
            className="mb-4 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px]">
            <option value="">Todos los administradores</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        )}

        {tab === 'admins' && <Administradores clave={clave} admins={admins} recargar={() => setVersion((v) => v + 1)} />}
        {tab === 'promotores' && <Promotores clave={clave} />}
        {tab === 'propuestas' && <ColabPropuestas clave={clave} />}
        {tab === 'influencers' && <ColabInfluencers clave={clave} yo={ent.rol === 'admin' ? ent.nombre : undefined} />}
        {tab === 'inspiracion' && <ColabInspiracion clave={clave} rol={ent.rol} />}
        {tab === 'anteojos' && ent.coleccion && agregando && <ColabAgregar clave={clave} volver={() => setAgregando(false)} />}
        {tab === 'anteojos' && !(ent.coleccion && agregando) && (
          <>
            {ent.coleccion && (
              <div className="mb-3 flex justify-end">
                <button onClick={() => setAgregando(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg text-white px-3 py-2 text-[12px] font-semibold" style={{ background: ACENTO }}>
                  <Plus size={14} /> Agregar anteojos
                </button>
              </div>
            )}
            <ColabAnteojos clave={clave} pct={ent.pct_descuento ?? 15} puedeLink onLink={() => setVersion((v) => v + 1)} oscuro={oscuro} coleccion={ent.coleccion} />
          </>
        )}
        {tab === 'fichas' && <ColabFichas clave={clave} onLink={() => setVersion((v) => v + 1)} />}
        {tab === 'links' && <LinksTodos key={`${adminSel}`} clave={clave} rol={ent.rol} adminId={adminSel} />}
        {tab === 'dashboard' && (
          <ColabDashboard key={`${adminSel}`} clave={clave} rol={ent.rol} adminId={adminSel} coleccion={ent.rol === 'influencer' && !!ent.coleccion}
            pctInf={ent.rol === 'influencer' ? ent.pct : 10} pctAdm={ent.rol === 'admin' ? ent.pct : 5} />
        )}
        {tab === 'liquidacion' && (
          <Liquidacion clave={clave} rol={ent.rol} adminId={adminSel} pctAdm={ent.rol === 'admin' ? ent.pct : 5} />
        )}
      </main>
    </div>
  )
}

// ── Utilidades de UI ──
const input = 'w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30'

function waLink(tel: string | null, texto: string) {
  let d = (tel ?? '').replace(/\D/g, '')
  if (d.length === 10) d = '549' + d
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`
}

function AccesoPanel({ nombre, clave, telefono, rol }: { nombre: string; clave: string; telefono: string | null; rol: 'admin' | 'influencer' }) {
  const url = linkPanel(clave)
  const msg = rol === 'admin'
    ? `Hola ${nombre}! Este es tu panel de administrador de colaboradores de Orbital: ${url}\nDesde ahí das de alta a tus promotores y ves sus ventas.`
    : `Hola ${nombre}! Este es tu panel de Orbital: ${url}\nAhí tenés los anteojos para promocionar, los copies y tu link con ${'descuento exclusivo'} para tus seguidores.`
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-[#F5F5F7] px-2 py-1.5">
      <span className="flex-1 truncate font-mono text-[10px]" title={url}>{url.replace('https://', '')}</span>
      <BotonCopiar texto={url} />
      <a href={waLink(telefono, msg)} target="_blank" rel="noopener noreferrer"
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-1 text-[10px] font-bold">
        <MessageCircle size={11} />WhatsApp
      </a>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-400">{k}</div>
      <div className="text-[12px] font-bold tabular-nums">{v}</div>
    </div>
  )
}

// ── ORBITAL: administradores ─────────────────────────────────────────────────
function Administradores({ clave, admins, recargar }: { clave: string; admins: Admin[] | null; recargar: () => void }) {
  const [editando, setEditando] = useState<Partial<Admin> | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)

  async function toggle(a: Admin) {
    if (!window.confirm(a.activo ? `¿Desactivar a ${a.nombre}? Sus promotores y links dejan de funcionar.` : `¿Reactivar a ${a.nombre}?`)) return
    await supabase.rpc('colab_orbital_guardar_admin', { p_clave: clave, p: { id: a.id, nombre: a.nombre, email: a.email, telefono: a.telefono, nota: a.nota, activo: !a.activo } })
    recargar()
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Administradores</h1>
          <p className="text-[11px] text-neutral-500 mt-1">Cada administrador da de alta a sus propios promotores y cobra su % sobre lo que venden.</p>
        </div>
        <button onClick={() => setEditando({ pct: 5 })} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg text-white px-3 py-2 text-[12px] font-semibold" style={{ background: ACENTO }}>
          <Plus size={14} /> Nuevo administrador
        </button>
      </div>

      {editando && <FormAdmin clave={clave} inicial={editando} onClose={() => setEditando(null)} onOk={recargar} />}

      {!admins && <p className="text-sm text-neutral-500 py-10 text-center">Cargando…</p>}
      {admins?.length === 0 && <p className="text-sm text-neutral-500 py-10 text-center">Todavía no hay administradores.</p>}
      <div className="space-y-3">
        {(admins ?? []).map((a) => (
          <div key={a.id} className={`bg-white rounded-xl border border-black/10 p-3 ${a.activo ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{a.nombre} {!a.activo && <span className="text-[10px] font-normal text-neutral-500">· inactivo</span>}</div>
                <div className="text-[10px] text-neutral-500">{a.pct}% sobre la venta{a.email ? ` · ${a.email}` : ''}{a.telefono ? ` · ${a.telefono}` : ''}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditando(a)} className="p-1.5 rounded-md border border-black/10" title="Editar"><Pencil size={13} /></button>
                <button onClick={() => toggle(a)} className="p-1.5 rounded-md border border-black/10" title={a.activo ? 'Desactivar' : 'Activar'}><Power size={13} /></button>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">
              <Stat k="Promotores" v={`${a.influencers_activos}/${a.influencers}`} />
              <Stat k="Links" v={a.links} />
              <Stat k="Toques" v={nAr(a.clicks)} />
              <Stat k="Pedidos" v={a.pedidos} />
              <Stat k="Venta neta" v={kAr(a.neto)} />
              <Stat k={`Su ${a.pct}%`} v={kAr(a.com_adm)} />
            </div>
            <div className="mt-2"><AccesoPanel nombre={a.nombre} clave={a.clave} telefono={a.telefono} rol="admin" /></div>
            <button onClick={() => setAbierto(abierto === a.id ? null : a.id)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: ACENTO }}>
              <Users size={12} /> {abierto === a.id ? 'Ocultar promotores' : 'Ver promotores'} {abierto === a.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {abierto === a.id && <PromotoresDe clave={clave} adminId={a.id} />}
          </div>
        ))}
      </div>
    </>
  )
}

function PromotoresDe({ clave, adminId }: { clave: string; adminId: number }) {
  const [filas, setFilas] = useState<Influencer[] | null>(null)
  useEffect(() => {
    supabase.rpc('colab_admin_influencers', { p_clave: clave, p_admin: adminId }).then(({ data }) => setFilas((data as Influencer[]) ?? []))
  }, [clave, adminId])
  if (!filas) return <p className="text-[11px] text-neutral-400 mt-2">Cargando…</p>
  if (!filas.length) return <p className="text-[11px] text-neutral-400 mt-2">Sin promotores cargados.</p>
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-[9px] uppercase tracking-wide text-neutral-400">
          <th className="py-1 pr-2">Promotor</th><th className="pr-2">Redes</th><th className="pr-2 text-right">Toques</th>
          <th className="pr-2 text-right">Ped.</th><th className="pr-2 text-right">Neto</th><th className="text-right">Comisión</th>
        </tr></thead>
        <tbody>
          {filas.map((i) => (
            <tr key={i.id} className={`border-t border-black/5 ${i.activo ? '' : 'opacity-50'}`}>
              <td className="py-1.5 pr-2"><div className="font-semibold">{i.nombre} <span className="font-normal text-neutral-400">{i.pct}%</span></div>{i.cbu_alias && <div className="text-[10px] text-neutral-500">CBU/alias: {i.cbu_alias}</div>}</td>
              <td className="pr-2">{(i.redes ?? []).map((r) => `${labelRed(r.red)} ${r.usuario}`).join(' · ') || '—'}</td>
              <td className="pr-2 text-right tabular-nums">{nAr(i.clicks)}</td>
              <td className="pr-2 text-right tabular-nums">{i.pedidos}</td>
              <td className="pr-2 text-right tabular-nums">{kAr(i.neto)}</td>
              <td className="text-right tabular-nums">{kAr(i.com_inf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FormAdmin({ clave, inicial, onClose, onOk }: { clave: string; inicial: Partial<Admin>; onClose: () => void; onOk: () => void }) {
  const [f, setF] = useState({ nombre: inicial.nombre ?? '', email: inicial.email ?? '', telefono: inicial.telefono ?? '', nota: inicial.nota ?? '', pct: String(inicial.pct ?? 5) })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creado, setCreado] = useState<{ clave: string } | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setGuardando(true); setErr(null)
    const pct = Number(f.pct.replace(',', '.'))
    if (!(pct >= 0 && pct <= 50)) { setErr('El % tiene que estar entre 0 y 50.'); setGuardando(false); return }
    const { data, error } = await supabase.rpc('colab_orbital_guardar_admin', { p_clave: clave, p: { ...f, pct, id: inicial.id ?? null } })
    setGuardando(false)
    if (error) { setErr(error.message.includes('falta_nombre') ? 'Falta el nombre.' : 'No se pudo guardar.'); return }
    onOk()
    if (inicial.id) onClose()
    else setCreado(data as { clave: string })
  }

  return (
    <div className="bg-white rounded-xl border-2 p-3 mb-4" style={{ borderColor: ACENTO }}>
      {creado ? (
        <>
          <div className="text-[13px] font-bold">Administrador creado: {f.nombre}</div>
          <p className="text-[11px] text-neutral-500 mb-2">Mandale su panel. Con ese link entra directo, sin usuario ni contraseña.</p>
          <AccesoPanel nombre={f.nombre} clave={creado.clave} telefono={f.telefono} rol="admin" />
          <button onClick={onClose} className="mt-3 rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-semibold">Listo</button>
        </>
      ) : (
        <form onSubmit={guardar} className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2 text-[12px] font-bold uppercase tracking-wide">{inicial.id ? 'Editar administrador' : 'Nuevo administrador'}</div>
          <input className={input} placeholder="Nombre *" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          <input className={input} placeholder="% de comisión" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} inputMode="decimal" />
          <input className={input} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className={input} placeholder="Teléfono (WhatsApp)" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />
          <input className={`${input} sm:col-span-2`} placeholder="Nota" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
          {err && <p className="sm:col-span-2 text-[11px] text-red-600">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-semibold">Cancelar</button>
            <button disabled={guardando} className="rounded-lg text-white px-4 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: ACENTO }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── ADMIN: promotores (influencers) ──────────────────────────────────────────
function Promotores({ clave }: { clave: string }) {
  const [filas, setFilas] = useState<Influencer[] | null>(null)
  const [editando, setEditando] = useState<Partial<Influencer> | null>(null)
  const cargar = () => supabase.rpc('colab_admin_influencers', { p_clave: clave, p_admin: null }).then(({ data }) => setFilas((data as Influencer[]) ?? []))
  useEffect(() => { cargar() }, [clave])

  async function toggle(i: Influencer) {
    if (!window.confirm(i.activo ? `¿Desactivar a ${i.nombre}? Sus links dejan de dar descuento.` : `¿Reactivar a ${i.nombre}?`)) return
    await supabase.rpc('colab_admin_guardar', { p_clave: clave, p: { id: i.id, nombre: i.nombre, email: i.email, telefono: i.telefono, redes: i.redes, nota: i.nota, activo: !i.activo } })
    cargar()
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Promotores</h1>
          <p className="text-[11px] text-neutral-500 mt-1">Dalos de alta con sus redes. Cada uno recibe su panel con los anteojos, los copies y su link.</p>
        </div>
        <button onClick={() => setEditando({ redes: [{ red: 'instagram', usuario: '' }] })} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg text-white px-3 py-2 text-[12px] font-semibold" style={{ background: ACENTO }}>
          <Plus size={14} /> Nuevo promotor
        </button>
      </div>

      {editando && <FormPromotor clave={clave} inicial={editando} onClose={() => setEditando(null)} onOk={cargar} />}

      {!filas ? <p className="text-sm text-neutral-500 py-10 text-center">Cargando…</p>
        : filas.length === 0 ? <p className="text-sm text-neutral-500 py-10 text-center">Todavía no cargaste promotores.</p>
        : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filas.map((i) => (
              <div key={i.id} className={`bg-white rounded-xl border border-black/10 p-3 ${i.activo ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold">{i.nombre} {!i.activo && <span className="text-[10px] font-normal text-neutral-500">· inactivo</span>}</div>
                    <div className="text-[10px] text-neutral-500">{i.pct}% para el promotor · {i.pct_descuento}% OFF para sus seguidores</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditando(i)} className="p-1.5 rounded-md border border-black/10" title="Editar"><Pencil size={13} /></button>
                    <button onClick={() => toggle(i)} className="p-1.5 rounded-md border border-black/10" title={i.activo ? 'Desactivar' : 'Activar'}><Power size={13} /></button>
                  </div>
                </div>
                <div className="text-[10px] mt-1">{i.cbu_alias
                  ? <span className="text-neutral-600">CBU/alias: <b className="font-mono">{i.cbu_alias}</b></span>
                  : <span className="text-amber-600 font-semibold">Falta CBU o alias para liquidarle</span>}</div>
                {(i.redes ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {i.redes.map((r, k) => (
                      <a key={k} href={r.url || undefined} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px]">
                        <b>{labelRed(r.red)}</b> {r.usuario}{r.seguidores ? ` · ${r.seguidores}` : ''}{r.url && <ExternalLink size={9} />}
                      </a>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Stat k="Links" v={i.links} />
                  <Stat k="Toques" v={nAr(i.clicks)} />
                  <Stat k="Pedidos" v={i.pedidos} />
                  <Stat k="Venta neta" v={kAr(i.neto)} />
                  <Stat k={`Su ${i.pct}%`} v={kAr(i.com_inf)} />
                  <Stat k="Tu comisión" v={kAr(i.com_adm)} />
                </div>
                <div className="mt-2"><AccesoPanel nombre={i.nombre} clave={i.clave} telefono={i.telefono} rol="influencer" /></div>
              </div>
            ))}
          </div>
        )}
    </>
  )
}

function FormPromotor({ clave, inicial, onClose, onOk }: { clave: string; inicial: Partial<Influencer>; onClose: () => void; onOk: () => void }) {
  const [f, setF] = useState({ nombre: inicial.nombre ?? '', email: inicial.email ?? '', telefono: inicial.telefono ?? '', nota: inicial.nota ?? '', cbu_alias: inicial.cbu_alias ?? '', pct: inicial.pct ?? 10 })
  const [redes, setRedes] = useState<Red[]>(inicial.redes?.length ? inicial.redes : [{ red: 'instagram', usuario: '' }])
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creado, setCreado] = useState<{ clave: string } | null>(null)

  const setRed = (k: number, campo: keyof Red, v: string) => setRedes(redes.map((r, i) => (i === k ? { ...r, [campo]: v } : r)))

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setGuardando(true); setErr(null)
    const limpias = redes.filter((r) => r.usuario.trim() || (r.url ?? '').trim()).map((r) => ({
      red: r.red, usuario: r.usuario.trim(), url: (r.url ?? '').trim(), seguidores: (r.seguidores ?? '').trim(),
    }))
    const { data, error } = await supabase.rpc('colab_admin_guardar', { p_clave: clave, p: { ...f, redes: limpias, id: inicial.id ?? null } })
    setGuardando(false)
    if (error) { setErr(error.message.includes('falta_nombre') ? 'Falta el nombre.' : error.message.includes('pct_invalido') ? 'La comisión tiene que ser 5, 10 o 15%.' : 'No se pudo guardar.'); return }
    onOk()
    if (inicial.id) onClose()
    else setCreado(data as { clave: string })
  }

  return (
    <div className="bg-white rounded-xl border-2 p-3 mb-4" style={{ borderColor: ACENTO }}>
      {creado ? (
        <>
          <div className="text-[13px] font-bold">Promotor dado de alta: {f.nombre}</div>
          <p className="text-[11px] text-neutral-500 mb-2">Mandale su panel. Con ese link entra directo a los anteojos, los copies y su link.</p>
          <AccesoPanel nombre={f.nombre} clave={creado.clave} telefono={f.telefono} rol="influencer" />
          <button onClick={onClose} className="mt-3 rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-semibold">Listo</button>
        </>
      ) : (
        <form onSubmit={guardar} className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2 text-[12px] font-bold uppercase tracking-wide">{inicial.id ? 'Editar promotor' : 'Nuevo promotor'}</div>
          <input className={`${input} sm:col-span-2`} placeholder="Nombre *" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          <input className={input} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className={input} placeholder="Teléfono (WhatsApp)" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />

          <div className="sm:col-span-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500 mt-1">Liquidación</div>
          <input className={input} placeholder="CBU o alias para pagarle" value={f.cbu_alias} onChange={(e) => setF({ ...f, cbu_alias: e.target.value })} />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-500 shrink-0">Comisión</span>
            {[5, 10, 15].map((n) => (
              <button key={n} type="button" onClick={() => setF({ ...f, pct: n })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold ${Number(f.pct) === n ? 'text-white border-transparent' : 'border-black/10 bg-white'}`}
                style={Number(f.pct) === n ? { background: ACENTO } : undefined}>{n}%</button>
            ))}
          </div>
          {inicial.id && Number(f.pct) !== Number(inicial.pct) && (
            <p className="sm:col-span-2 text-[10px] text-amber-600">El nuevo % se aplica a las ventas que se sincronicen desde ahora.</p>
          )}

          <div className="sm:col-span-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500 mt-1">Redes sociales</div>
          {redes.map((r, k) => (
            <div key={k} className="sm:col-span-2 grid grid-cols-[110px_1fr_auto] sm:grid-cols-[120px_1fr_1.4fr_110px_auto] gap-1.5">
              <select className={input} value={r.red} onChange={(e) => setRed(k, 'red', e.target.value)}>
                {REDES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <input className={input} placeholder="@usuario" value={r.usuario} onChange={(e) => setRed(k, 'usuario', e.target.value)} />
              <input className={`${input} col-span-2 sm:col-span-1 order-last sm:order-none`} placeholder="Link al perfil" value={r.url ?? ''} onChange={(e) => setRed(k, 'url', e.target.value)} />
              <input className={`${input} hidden sm:block`} placeholder="Seguidores" value={r.seguidores ?? ''} onChange={(e) => setRed(k, 'seguidores', e.target.value)} />
              <button type="button" onClick={() => setRedes(redes.filter((_, i) => i !== k))} className="px-2 text-neutral-400 text-[16px]" title="Quitar">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setRedes([...redes, { red: 'tiktok', usuario: '' }])} className="sm:col-span-2 justify-self-start text-[11px] font-semibold" style={{ color: ACENTO }}>
            + Agregar otra red
          </button>

          <input className={`${input} sm:col-span-2`} placeholder="Nota (opcional)" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
          {err && <p className="sm:col-span-2 text-[11px] text-red-600">{err}</p>}
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-semibold">Cancelar</button>
            <button disabled={guardando} className="rounded-lg text-white px-4 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: ACENTO }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── INFLUENCER: mis links ────────────────────────────────────────────────────
// ── ORBITAL / ADMIN: los links de todos los promotores ───────────────────────
// Para adentro: cómo va cada promotor publicación por publicación. El promotor
// ya no ve esta pestaña (arma sus links desde Anteojos y ve su Dashboard).
type LinkDeTodos = MiLink & { influencer_id: number; influencer: string; influencer_activo: boolean; admin: string | null; pct: number }

function LinksTodos({ clave, rol, adminId }: { clave: string; rol: Entrada['rol']; adminId: number | null }) {
  const [filas, setFilas] = useState<LinkDeTodos[] | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)

  useEffect(() => {
    supabase.rpc('colab_links_todos', { p_clave: clave, p_admin: adminId })
      .then(({ data }) => setFilas((data as LinkDeTodos[]) ?? []))
  }, [clave, adminId])

  if (!filas) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  // Un bloque por promotor, ordenados por lo que vendieron.
  const porInf = new Map<number, { nombre: string; admin: string | null; pct: number; activo: boolean; links: LinkDeTodos[] }>()
  for (const l of filas) {
    if (!porInf.has(l.influencer_id)) porInf.set(l.influencer_id, { nombre: l.influencer, admin: l.admin, pct: Number(l.pct) || 0, activo: l.influencer_activo, links: [] })
    porInf.get(l.influencer_id)!.links.push(l)
  }
  const sum = (ls: LinkDeTodos[]) => ls.reduce((a, f) => ({ clicks: a.clicks + f.clicks, pedidos: a.pedidos + f.pedidos, neto: a.neto + Number(f.neto), com: a.com + Number(f.com) }), { clicks: 0, pedidos: 0, neto: 0, com: 0 })
  const grupos = [...porInf.entries()].map(([id, g]) => ({ id, ...g, tot: sum(g.links) })).sort((a, b) => b.tot.neto - a.tot.neto)
  const tot = sum(filas)

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Links</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Cada link es una publicación de un promotor. Sirve para ver cómo va cada uno: qué publicó, cuántos toques trajo y cuánto vendió.
        </p>
      </div>

      <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">Venta neta por links</div>
            <div className="text-[30px] font-bold leading-none mt-1">{kAr(tot.neto)}</div>
          </div>
          <div className="flex gap-5 text-[11px]">
            {[['Promotores', String(grupos.length)], ['Links', String(filas.length)], ['Toques', nAr(tot.clicks)], ['Pedidos', nAr(tot.pedidos)], ['Comisión', kAr(tot.com)]].map(([k, v]) => (
              <div key={k}><div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div><div className="font-bold">{v}</div></div>
            ))}
          </div>
        </div>
      </div>

      {grupos.length === 0 && <p className="text-sm text-neutral-500 py-10 text-center">Todavía no hay links generados.</p>}

      <div className="space-y-3">
        {grupos.map((g) => (
          <div key={g.id} className={`bg-white rounded-xl border border-black/10 p-3 ${g.activo ? '' : 'opacity-60'}`}>
            <div className="min-w-0">
              <div className="text-[13px] font-bold">{g.nombre} <span className="text-[10px] font-normal text-neutral-400">{g.pct}%</span>{!g.activo && <span className="text-[10px] font-normal text-neutral-500"> · inactivo</span>}</div>
              {rol === 'orbital' && g.admin && <div className="text-[10px] text-neutral-500">{g.admin}</div>}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
              <Stat k="Links" v={g.links.length} />
              <Stat k="Toques" v={nAr(g.tot.clicks)} />
              <Stat k="Pedidos" v={g.tot.pedidos} />
              <Stat k="Venta neta" v={kAr(g.tot.neto)} />
              <Stat k="Comisión" v={kAr(g.tot.com)} />
            </div>
            <button onClick={() => setAbierto(abierto === g.id ? null : g.id)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: ACENTO }}>
              <ExternalLink size={12} /> {abierto === g.id ? 'Ocultar links' : 'Ver links'} {abierto === g.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {abierto === g.id && (
              <div className="mt-2 space-y-2">
                {g.links.map((l) => {
                  const conv = l.clicks ? (l.pedidos / l.clicks) * 100 : 0
                  return (
                    <div key={l.id} className={`rounded-lg border border-black/10 p-2.5 ${l.activo ? '' : 'opacity-60'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wide">
                            {l.modelo}{l.color ? <span className="font-normal text-neutral-400"> · {l.color}</span> : null}
                            {!l.activo && <span className="text-[9px] font-normal text-neutral-500"> · pausado</span>}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            {labelRed(l.red)} · {labelFormato(l.formato)}
                            {l.url_pub && <> · <a href={l.url_pub} target="_blank" rel="noopener noreferrer" className="underline">ver publicación</a></>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-bold tabular-nums leading-none">{kAr(Number(l.neto))}</div>
                          <div className="text-[9px] text-neutral-400">comisión {kAr(Number(l.com))}</div>
                        </div>
                      </div>
                      <div className="flex gap-4 text-[9px] text-neutral-500 mt-1.5">
                        <span>Toques <b className="text-black">{nAr(l.clicks)}</b></span>
                        <span>Pedidos <b className="text-black">{l.pedidos}</b></span>
                        <span>Conversión <b className="text-black">{conv.toFixed(1)}%</b></span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#F5F5F7] px-2 py-1.5">
                        <span className="flex-1 truncate font-mono text-[10px]">{linkPublico(l.codigo).replace('https://', '')}</span>
                        <BotonCopiar texto={linkPublico(l.codigo)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

export function MisLinks({ clave, pct, irAnteojos }: { clave: string; pct: number; irAnteojos: () => void }) {
  const [filas, setFilas] = useState<MiLink[] | null>(null)
  const cargar = () => supabase.rpc('colab_mis_links', { p_clave: clave }).then(({ data }) => setFilas((data as MiLink[]) ?? []))
  useEffect(() => { cargar() }, [clave])

  if (!filas) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>
  const tot = filas.reduce((a, f) => ({ clicks: a.clicks + f.clicks, pedidos: a.pedidos + f.pedidos, neto: a.neto + Number(f.neto), com: a.com + Number(f.com) }), { clicks: 0, pedidos: 0, neto: 0, com: 0 })

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Mis links</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Un link por publicación. Cuando lo publiques, pegá acá el link de la historia o del posteo: así el dashboard te muestra cuál rinde más.
        </p>
      </div>

      <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">Tu {pct}% acumulado</div>
            <div className="text-[30px] font-bold leading-none mt-1">{kAr(tot.com)}</div>
          </div>
          <div className="flex gap-5 text-[11px]">
            {[['Links', String(filas.length)], ['Toques', nAr(tot.clicks)], ['Pedidos', nAr(tot.pedidos)], ['Venta neta', kAr(tot.neto)]].map(([k, v]) => (
              <div key={k}><div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div><div className="font-bold">{v}</div></div>
            ))}
          </div>
        </div>
      </div>

      {filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center">
          <p className="text-[12px] text-neutral-600">Todavía no generaste links.</p>
          <button onClick={irAnteojos} className="mt-3 rounded-lg text-white px-4 py-2 text-[12px] font-semibold" style={{ background: ACENTO }}>Elegir un anteojo</button>
        </div>
      )}

      <div className="space-y-2">
        {filas.map((l) => <FilaLink key={l.id} l={l} clave={clave} pct={pct} onCambio={cargar} />)}
      </div>
    </>
  )
}

function FilaLink({ l, clave, pct, onCambio }: { l: MiLink; clave: string; pct: number; onCambio: () => void }) {
  const [pub, setPub] = useState(l.url_pub ?? '')
  const [guardado, setGuardado] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [errVideo, setErrVideo] = useState<string | null>(null)
  const url = linkPublico(l.codigo)

  async function eliminar() {
    if (!window.confirm('Eliminar este link: deja de funcionar y se borran sus toques. ¿Seguimos?')) return
    const { error } = await supabase.rpc('colab_link_eliminar', { p_clave: clave, p_id: l.id })
    if (error) {
      window.alert(/tiene_ventas/.test(error.message) ? 'Este link ya tiene ventas: no se puede eliminar. Pausalo.' : 'No se pudo eliminar. Probá de nuevo.')
      return
    }
    onCambio()
  }
  // El video de reacción se sube directo al almacenamiento con una URL firmada (colab-video)
  async function subirVideo(file: File) {
    setErrVideo(null)
    if (file.size > 50 * 1024 * 1024) { setErrVideo('El video pesa más de 50 MB. Recortalo o bajale la calidad.'); return }
    setSubiendo(true)
    const { data, error } = await supabase.functions.invoke('colab-video', { body: { clave, link_id: l.id, tipo: file.type } })
    const r = data as { path?: string; token?: string; url?: string } | null
    if (error || !r?.path || !r.token || !r.url) { setSubiendo(false); setErrVideo('No se pudo preparar la subida. Probá de nuevo.'); return }
    const subida = await supabase.storage.from('colab-videos').uploadToSignedUrl(r.path, r.token, file, { contentType: file.type })
    if (subida.error) { setSubiendo(false); setErrVideo('No se pudo subir el video. Probá de nuevo.'); return }
    await supabase.rpc('colab_link_video', { p_clave: clave, p_id: l.id, p_url: r.url })
    setSubiendo(false)
    onCambio()
  }
  async function quitarVideo() {
    if (!window.confirm('¿Quitar el video de este link?')) return
    await supabase.rpc('colab_link_video', { p_clave: clave, p_id: l.id, p_url: null })
    onCambio()
  }

  async function guardarPub() {
    if (!pub.trim() || pub.trim() === l.url_pub) return
    await supabase.rpc('colab_link_editar', { p_clave: clave, p_id: l.id, p_url_pub: pub.trim(), p_activo: null })
    setGuardado(true); setTimeout(() => setGuardado(false), 1500); onCambio()
  }
  async function pausar() {
    if (!window.confirm(l.activo ? 'Pausar este link: quien lo toque va a la tienda sin descuento. ¿Seguimos?' : '¿Reactivar este link?')) return
    await supabase.rpc('colab_link_editar', { p_clave: clave, p_id: l.id, p_url_pub: null, p_activo: !l.activo })
    onCambio()
  }

  return (
    <div className={`bg-white rounded-xl border border-black/10 p-3 ${l.activo ? '' : 'opacity-60'}`}>
      <div className="flex gap-3">
        <div className="w-20 h-14 shrink-0 bg-white foto-clara rounded-md p-1">{l.imagen && <img src={l.imagen} alt={l.modelo} className="w-full h-full object-contain" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] font-bold uppercase tracking-wide truncate">{l.modelo}</div>
              <div className="text-[10px] text-neutral-500 truncate">{l.color} · {labelRed(l.red)} · {labelFormato(l.formato)} · {new Date(l.created_at).toLocaleDateString('es-AR')}</div>
            </div>
            <div className="shrink-0 flex gap-1.5">
              <button onClick={pausar} className="rounded-md border border-black/10 px-2 py-1 text-[10px] font-semibold">{l.activo ? 'Pausar' : 'Reactivar'}</button>
              <button onClick={eliminar} className="rounded-md border border-red-500/50 text-red-500 px-2 py-1 text-[10px] font-semibold">Eliminar</button>
            </div>
          </div>
          <div className="flex gap-4 text-[10px] text-neutral-500 mt-1">
            <span>Toques <b className="text-black">{nAr(l.clicks)}</b></span>
            <span>Pedidos <b className="text-black">{l.pedidos}</b></span>
            <span>Tu {pct}% <b className="text-black">{kAr(l.com)}</b></span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-2.5 py-1.5">
        <span className="flex-1 truncate font-mono text-[11px] font-bold">{url.replace('https://', '')}</span>
        <BotonCopiar texto={url} label="Copiar link" />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input value={pub} onChange={(e) => setPub(e.target.value)} onBlur={guardarPub}
          placeholder="Pegá el link de tu publicación (opcional)" className={`${input} text-[11px]`} />
        {guardado && <span className="text-[10px] font-bold text-emerald-600 shrink-0">Guardado</span>}
      </div>

      {/* Video de reacción: se ve en la página de este link */}
      <div className="mt-1.5 rounded-lg border border-dashed border-black/20 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px]"><b>Video de reacción</b> <span className="text-neutral-500">· se ve en la página de este link</span></div>
          {l.video_url && <button onClick={quitarVideo} className="text-[10px] font-semibold underline text-neutral-500">Quitar</button>}
        </div>
        {l.video_url ? (
          <div className="mt-1.5 flex items-center gap-2">
            <video src={l.video_url} className="h-24 rounded-md bg-black" muted playsInline controls />
            {l.video_ejemplo && <span className="text-[10px] rounded bg-amber-400 text-black px-1.5 py-0.5 font-bold">VIDEO DE EJEMPLO</span>}
          </div>
        ) : (
          <label className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md text-white px-2.5 py-1.5 text-[11px] font-semibold ${subiendo ? 'opacity-60' : 'cursor-pointer'}`} style={{ background: ACENTO }}>
            {subiendo ? 'Subiendo…' : 'Subir video'}
            <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" disabled={subiendo}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirVideo(f); e.target.value = '' }} />
          </label>
        )}
        {errVideo && <p className="text-[10px] text-red-500 mt-1">{errVideo}</p>}
        <p className="text-[9px] text-neutral-400 mt-1">Hasta 50 MB · mp4, mov o webm · ideal vertical.</p>
      </div>
    </div>
  )
}
