import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { RefreshCw, Search, Copy, KeyRound, Plus, Link2, Link2Off, MessageCircle, Mail } from 'lucide-react'
import { parseTelefonos, abrirWhatsApp, abrirMail } from '../../lib/telefono'
import type { Rol } from '../../lib/types'

// Administración de accesos — quién entra a la Suite y quién tiene link del catálogo.
//
// Las contraseñas no se pueden VER: Supabase las guarda hasheadas y nadie las lee.
// Lo que sí se puede es ponerle una nueva a cualquiera (botón Clave): se la pasás por
// WhatsApp y entra con mail + contraseña, sin depender de que le llegue el mail.
// El link por mail queda como respaldo para quien lo prefiera.

interface Usuario {
  codigo: string
  nombre: string | null
  email: string | null
  rol: Rol
  activo: boolean
  telefono: string | null
  /** Ya entró alguna vez: su cuenta de mail quedó vinculada. */
  entro: boolean
  prospecta: boolean
  cupo: number
  pendientes: number
  ultimo_acceso: string | null
}

interface Acceso {
  codigo: string
  tipo: string
  label: string | null
  cod_cliente: string | null
  vendedor: string | null
  activo: boolean
  creado_por: string | null
  creado_at: string
  visitas: number
  ultima_visita: string | null
  minutos: number
  pedidos: number
}

const ROLES: Rol[] = [
  'vendedor', 'admin', 'administracion', 'postventa', 'deposito', 'logistica',
  'produccion', 'tienda', 'contenido', 'revendedor', 'social', 'usa', 'financiero',
]

// El mismo dominio que reciben las ópticas en el WhatsApp.
const BASE = 'https://ver.orbitaleyewear.com.ar'
const BASE_CATALOGO = `${BASE}/catalogo`

/** Los cuatro links de una óptica. El token es el mismo: cambia el parámetro. */
const linksDe = (token: string) => [
  { l: 'Catálogo', u: `${BASE}/catalogo?k=${token}` },
  { l: 'Triple Protección', u: `${BASE}/tripleproteccion?c=${token}` },
  { l: 'Bienvenida', u: `${BASE}/bienvenida?c=${token}` },
  { l: 'Plan Canje', u: `${BASE}/canje?c=${token}` },
]

interface ColabAcceso {
  tipo: 'orbital' | 'admin' | 'promotor'
  id: number
  nombre: string
  clave: string
  email: string | null
  telefono: string | null
  activo: boolean
  jefe: string | null
  links: number
  ventas: number
}

interface ClienteLinks {
  cod: string
  razon: string | null
  vendedor: string | null
  provincia: string | null
  localidad: string | null
  token: string | null
  token_activo: boolean | null
  visitas: number
  ultima_visita: string | null
  minutos: number
  propuesta: string | null
  ultima_propuesta: string | null
  pedidos: number
}

// Clave fácil de dictar por teléfono: sin los caracteres que se confunden (0/O, 1/l/I).
const ALFA = 'abcdefghijkmnpqrstuvwxyz23456789'
const bloque = (n = 4): string =>
  Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ALFA[x % ALFA.length]).join('')
const claveAlAzar = (): string => `${bloque()}-${bloque()}-${bloque()}`
// Las de Colaboradores llevan el prefijo del nivel, como las que ya están cargadas.
const claveColabAlAzar = (tipo: string): string =>
  `${tipo === 'admin' ? 'ad' : tipo === 'promotor' ? 'in' : 'or'}-${bloque()}${bloque()}`

/** Lo que se le manda a la persona cuando le ponés la contraseña. */
const mensajeClave = (nombre: string, email: string, pass: string): string =>
  `Hola ${nombre}! Desde ahora podés entrar a la Suite de dos formas: con el link que te llega por mail, o con tu usuario y contraseña.\n\n` +
  `🔗 ${window.location.origin}\n` +
  `👤 Usuario: ${email}\n` +
  `🔑 Contraseña: ${pass}\n\n` +
  `La contraseña la podés cambiar cuando quieras desde "Mi clave", arriba a la derecha.`

/** Lo que se le manda a un admin o promotor de Colaboradores. */
const mensajeColab = (nombre: string, clave: string): string =>
  `Hola ${nombre}! Este es tu acceso al panel de Colaboradores de Orbital:\n\n` +
  `🔗 ${BASE}/colab?k=${clave}\n` +
  `🔑 Tu clave: ${clave}\n\n` +
  `Con ese link entrás directo, y desde el panel podés instalarlo como app en el celular.`

const haceCuanto = (iso: string | null): string => {
  if (!iso) return 'nunca'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} d`
  const m = Math.round(d / 30)
  return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`
}

const vacio: Omit<Usuario, 'entro' | 'prospecta' | 'cupo' | 'pendientes' | 'ultimo_acceso'> = {
  codigo: '', nombre: '', email: '', rol: 'vendedor', activo: true, telefono: '',
}

export default function Usuarios() {
  const { rolEfectivo } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<'usuarios' | 'colab' | 'catalogo' | 'buscador'>('usuarios')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [resultados, setResultados] = useState<ClienteLinks[]>([])
  const [buscando, setBuscando] = useState(false)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<typeof vacio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [clave, setClave] = useState<{ codigo: string; nombre: string; email: string; telefono: string | null } | null>(null)
  const [claveTexto, setClaveTexto] = useState('')
  const [guardandoClave, setGuardandoClave] = useState(false)
  // Paso 2: la clave ya quedó puesta y falta avisarle a la persona.
  const [claveLista, setClaveLista] = useState<{ nombre: string; email: string; pass: string; telefono: string | null } | null>(null)
  const [colab, setColab] = useState<ColabAcceso[]>([])
  const [claveColab, setClaveColab] = useState<ColabAcceso | null>(null)
  const [claveColabTexto, setClaveColabTexto] = useState('')

  const esAdmin = rolEfectivo === 'admin'

  const cargar = useCallback(async () => {
    setLoading(true)
    const [us, ac, co] = await Promise.all([
      supabase.rpc('admin_usuarios'),
      supabase.rpc('admin_accesos', { p_busca: null, p_limite: 500 }),
      supabase.rpc('admin_colab_accesos'),
    ])
    setUsuarios(us.error ? [] : ((us.data as Usuario[]) ?? []))
    setAccesos(ac.error ? [] : ((ac.data as Acceso[]) ?? []))
    setColab(co.error ? [] : ((co.data as ColabAcceso[]) ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { if (esAdmin) void cargar() }, [cargar, esAdmin])

  const guardar = useCallback(async () => {
    if (!editando) return
    setGuardando(true)
    const { data, error } = await supabase.rpc('admin_usuario_guardar', {
      p_codigo: editando.codigo, p_nombre: editando.nombre, p_email: editando.email,
      p_rol: editando.rol, p_activo: editando.activo, p_telefono: editando.telefono,
    })
    setGuardando(false)
    const r = data as { ok?: boolean; error?: string } | null
    if (error || !r?.ok) { toast(r?.error ?? error?.message ?? 'No se pudo guardar', 'error'); return }
    toast('Usuario guardado', 'success')
    setEditando(null)
    void cargar()
  }, [editando, cargar, toast])

  // Le pone la contraseña que vos elegís. Si todavía no tenía cuenta, la crea con el
  // mail ya confirmado: entra aunque su casilla no reciba los mails de Supabase.
  const ponerClave = useCallback(async () => {
    if (!clave) return
    const pass = claveTexto.trim()
    if (pass.length < 8) { toast('La contraseña necesita al menos 8 caracteres', 'error'); return }
    setGuardandoClave(true)
    const { data, error } = await supabase.functions.invoke('admin-usuario-clave', {
      body: { codigo: clave.codigo, password: pass },
    })
    setGuardandoClave(false)
    let r = data as { ok?: boolean; error?: string; creado?: boolean } | null
    // Con status 4xx el detalle viaja en el cuerpo, no en el mensaje del error.
    if (error) {
      try { r = await (error as { context?: Response }).context?.json() } catch { /* sin detalle */ }
    }
    if (!r?.ok) { toast(r?.error ?? error?.message ?? 'No se pudo poner la clave', 'error'); return }
    toast(r.creado ? 'Cuenta creada con esa contraseña' : 'Contraseña cambiada', 'success')
    setClaveLista({ nombre: clave.nombre, email: clave.email, pass, telefono: clave.telefono })
    setClave(null)
    setClaveTexto('')
    void cargar()
  }, [clave, claveTexto, toast, cargar])

  // Clave de un admin o promotor de Colaboradores. Ahí la clave es el acceso entero
  // (no hay mail ni contraseña aparte), así que se ve y se puede copiar.
  const ponerClaveColab = useCallback(async () => {
    if (!claveColab) return
    const { data, error } = await supabase.rpc('admin_colab_clave', {
      p_tipo: claveColab.tipo, p_id: claveColab.id, p_clave: claveColabTexto.trim(),
    })
    const r = data as { ok?: boolean; error?: string } | null
    if (error || !r?.ok) { toast(r?.error ?? error?.message ?? 'No se pudo cambiar', 'error'); return }
    toast('Clave cambiada', 'success')
    setClaveColab(null)
    setClaveColabTexto('')
    void cargar()
  }, [claveColab, claveColabTexto, toast, cargar])

  // Le manda a la persona un link a su casilla para entrar sin contraseña.
  const mandarLink = useCallback(async (u: Usuario) => {
    if (!u.email) { toast('Ese usuario no tiene mail cargado', 'error'); return }
    const { error } = await supabase.auth.signInWithOtp({
      email: u.email, options: { emailRedirectTo: window.location.origin },
    })
    if (error) { toast('No se pudo enviar: ' + error.message, 'error'); return }
    toast(`Link enviado a ${u.email}`, 'success')
  }, [toast])

  const activarAcceso = useCallback(async (a: Acceso) => {
    const { data, error } = await supabase.rpc('admin_acceso_activar', {
      p_codigo: a.codigo, p_activo: !a.activo,
    })
    const r = data as { ok?: boolean; error?: string } | null
    if (error || !r?.ok) { toast(r?.error ?? 'No se pudo cambiar', 'error'); return }
    setAccesos((xs) => xs.map((x) => (x.codigo === a.codigo ? { ...x, activo: !x.activo } : x)))
  }, [toast])

  // Busca sobre TODAS las ópticas, tengan link o no.
  const buscarCliente = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResultados([]); return }
    setBuscando(true)
    const { data, error } = await supabase.rpc('admin_links_cliente', { p_busca: q, p_limite: 40 })
    setBuscando(false)
    setResultados(error ? [] : ((data as ClienteLinks[]) ?? []))
  }, [])

  const generarToken = useCallback(async (c: ClienteLinks) => {
    const { data, error } = await supabase.rpc('admin_token_generar', { p_cod: c.cod })
    const r = data as { ok?: boolean; token?: string; error?: string } | null
    if (error || !r?.ok) { toast(r?.error ?? 'No se pudo generar', 'error'); return }
    setResultados((xs) => xs.map((x) => (x.cod === c.cod ? { ...x, token: r.token ?? null, token_activo: true } : x)))
    toast('Link generado', 'success')
  }, [toast])

  const copiar = useCallback((texto: string, aviso: string) => {
    navigator.clipboard.writeText(texto).then(
      () => toast(aviso, 'success'),
      () => toast('No se pudo copiar', 'error'),
    )
  }, [toast])

  const accesosVisibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return accesos
    return accesos.filter((a) =>
      a.codigo.toLowerCase().includes(q) ||
      (a.label ?? '').toLowerCase().includes(q) ||
      (a.cod_cliente ?? '').toLowerCase().includes(q))
  }, [accesos, busca])

  if (!esAdmin)
    return (
      <div className="max-w-[1000px] mx-auto px-4 py-16 text-center">
        <p className="text-lg font-medium tracking-tight">Solo para administradores</p>
        <p className="text-sm text-muted mt-2">Acá se dan de alta los accesos de todo el equipo.</p>
      </div>
    )

  const conToken = accesos.filter((a) => a.tipo === 'optica')
  const usaron = conToken.filter((a) => a.visitas > 0).length

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accesos</h1>
          <p className="text-sm text-muted mt-1">
            Quién entra a la Suite y qué óptica tiene link del catálogo.
          </p>
        </div>
        <button onClick={() => void cargar()}
          className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors" title="Actualizar">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-5">
        {([['usuarios', `Usuarios de la Suite · ${usuarios.filter((u) => u.activo).length}`],
           ['colab', `Colaboradores · ${colab.filter((c) => c.activo && c.tipo !== 'orbital').length}`],
           ['catalogo', `Accesos al catálogo · ${conToken.length}`],
           ['buscador', 'Buscar los links de una óptica']] as ['usuarios' | 'colab' | 'catalogo' | 'buscador', string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              tab === k ? 'bg-brand text-white' : 'border border-black/10 text-muted hover:bg-black/[0.03]'}`}>
            {l}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-faint text-center py-16">Cargando…</p>}

      {/* ── Usuarios de la Suite ─────────────────────────────────────────── */}
      {!loading && tab === 'usuarios' && (
        <>
          <div className="rounded-lg border border-brandDark/25 bg-goldSoft/30 p-3 mb-4 text-[12px] text-ink">
            <p className="flex items-center gap-1.5 font-semibold mb-1"><KeyRound size={13} /> Sobre las contraseñas</p>
            <p className="text-muted">
              Con <strong>Clave</strong> le ponés la contraseña que quieras y se copia sola para que se la
              pases por WhatsApp: entra con su mail y esa clave, sin esperar ningún mail. Si todavía no tenía
              cuenta, se le crea en el momento. Después cada uno puede cambiarla desde <strong>Mi clave</strong>,
              arriba a la derecha. Verlas no se puede: Supabase las guarda encriptadas.
            </p>
          </div>

          <div className="flex justify-end mb-3">
            <button onClick={() => setEditando({ ...vacio })}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium">
              <Plus size={13} /> Nuevo usuario
            </button>
          </div>

          <div className="rounded-lg border border-black/10 bg-white overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-faint text-left border-b border-black/[0.07]">
                  <th className="px-3 py-2 font-medium">Usuario</th>
                  <th className="px-3 py-2 font-medium">Rol</th>
                  <th className="px-3 py-2 font-medium">Entra con</th>
                  <th className="px-3 py-2 font-medium text-right">Tanda</th>
                  <th className="px-3 py-2 font-medium">Último acceso</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.codigo} className={`border-b border-black/[0.04] last:border-0 ${u.activo ? '' : 'opacity-45'}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{u.nombre || u.codigo}</p>
                      <p className="text-faint text-[11px]">{u.codigo}{u.activo ? '' : ' · inactivo'}</p>
                    </td>
                    <td className="px-3 py-2 text-muted">{u.rol}</td>
                    <td className="px-3 py-2">
                      <p className="truncate max-w-[220px]">{u.email ?? <span className="text-faint">sin mail</span>}</p>
                      <p className={`text-[11px] ${u.entro ? 'text-faint' : 'font-medium text-brandDark'}`}>
                        {u.entro ? 'cuenta vinculada' : 'nunca entró'}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {u.prospecta ? <>{u.pendientes} <span className="text-faint">/ {u.cupo}</span></> : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-3 py-2 text-muted">{haceCuanto(u.ultimo_acceso)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.email && (
                          <>
                            <button onClick={() => { setClave({ codigo: u.codigo, nombre: u.nombre || u.codigo, email: u.email!, telefono: u.telefono }); setClaveTexto(claveAlAzar()) }}
                              className="inline-flex items-center gap-1 rounded-md border border-brandDark/30 bg-goldSoft/40 px-2 py-1 text-[11px] text-brandDark hover:bg-goldSoft/70 transition-colors">
                              <KeyRound size={11} /> Clave
                            </button>
                            <button onClick={() => void mandarLink(u)}
                              className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-muted hover:bg-black/[0.03] transition-colors">
                              Mandar link
                            </button>
                          </>
                        )}
                        <button onClick={() => setEditando({
                          codigo: u.codigo, nombre: u.nombre ?? '', email: u.email ?? '',
                          rol: u.rol, activo: u.activo, telefono: u.telefono ?? '',
                        })}
                          className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-muted hover:bg-black/[0.03] transition-colors">
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Colaboradores (/colab) ───────────────────────────────────────── */}
      {!loading && tab === 'colab' && (
        <>
          <div className="rounded-lg border border-brandDark/25 bg-goldSoft/30 p-3 mb-4 text-[12px] text-ink">
            <p className="flex items-center gap-1.5 font-semibold mb-1"><KeyRound size={13} /> Cómo entran acá</p>
            <p className="text-muted">
              El panel de Colaboradores no usa mail ni contraseña: <strong>la clave es el acceso</strong>, y el
              link <code>/colab?k=…</code> ya la lleva adentro. Por eso acá sí se ve: copiás el link, se lo mandás
              y entra. Si se le filtró a alguien, le ponés una clave nueva y el link viejo deja de servir.
            </p>
          </div>

          <div className="rounded-lg border border-black/10 bg-white overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-faint text-left border-b border-black/[0.07]">
                  <th className="px-3 py-2 font-medium">Quién</th>
                  <th className="px-3 py-2 font-medium">Nivel</th>
                  <th className="px-3 py-2 font-medium">Clave</th>
                  <th className="px-3 py-2 font-medium text-right">Links</th>
                  <th className="px-3 py-2 font-medium text-right">Ventas</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {colab.map((c) => (
                  <tr key={`${c.tipo}-${c.id}`} className={`border-b border-black/[0.04] last:border-0 ${c.activo ? '' : 'opacity-45'}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{c.nombre}</p>
                      <p className="text-faint text-[11px]">
                        {c.jefe ? `de ${c.jefe}` : c.email || '—'}{c.activo ? '' : ' · inactivo'}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {c.tipo === 'orbital' ? 'Orbital' : c.tipo === 'admin' ? 'Administrador' : 'Promotor'}
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-[11px]">{c.clave}</code>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.links || <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.ventas || <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => copiar(`${BASE}/colab?k=${c.clave}`, 'Link del panel copiado')}
                          className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-muted hover:bg-black/[0.03] transition-colors">
                          Copiar link
                        </button>
                        {c.telefono && parseTelefonos(c.telefono, true)[0] && (
                          <button onClick={() => abrirWhatsApp(parseTelefonos(c.telefono, true)[0].wa, mensajeColab(c.nombre, c.clave))}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100 transition-colors">
                            <MessageCircle size={11} /> WhatsApp
                          </button>
                        )}
                        <button onClick={() => { setClaveColab(c); setClaveColabTexto(claveColabAlAzar(c.tipo)) }}
                          className="inline-flex items-center gap-1 rounded-md border border-brandDark/30 bg-goldSoft/40 px-2 py-1 text-[11px] text-brandDark hover:bg-goldSoft/70 transition-colors">
                          <KeyRound size={11} /> Clave
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-faint mt-3">
            Las altas y bajas de promotores siguen estando en el panel de Colaboradores (/colab), que es donde
            se cargan las comisiones y las colecciones. Acá solo se administran los accesos.
          </p>
        </>
      )}

      {/* ── Accesos al catálogo ──────────────────────────────────────────── */}
      {!loading && tab === 'catalogo' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { n: conToken.length, l: 'ópticas con link' },
              { n: usaron, l: 'ya lo usaron' },
              { n: conToken.length - usaron, l: 'nunca lo abrieron' },
              { n: accesos.filter((a) => !a.activo).length, l: 'dados de baja' },
            ].map((t) => (
              <div key={t.l} className="rounded-lg border border-black/10 bg-white p-3">
                <p className="text-2xl font-semibold tabular-nums tracking-tight">{t.n}</p>
                <p className="text-[11px] text-muted mt-0.5">{t.l}</p>
              </div>
            ))}
          </div>

          <div className="relative mb-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar óptica, código de cliente o token"
              className="w-full rounded-md border border-black/10 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand/20" />
          </div>

          <div className="rounded-lg border border-black/10 bg-white overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-faint text-left border-b border-black/[0.07]">
                  <th className="px-3 py-2 font-medium">Óptica</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Vendedor</th>
                  <th className="px-3 py-2 font-medium text-right">Entradas</th>
                  <th className="px-3 py-2 font-medium">Última vez</th>
                  <th className="px-3 py-2 font-medium text-right">Pedidos</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {accesosVisibles.map((a) => (
                  <tr key={a.codigo} className={`border-b border-black/[0.04] last:border-0 ${a.activo ? '' : 'opacity-45'}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium truncate max-w-[260px]">{a.label ?? a.codigo}</p>
                      <p className="text-faint text-[11px]">{a.cod_cliente ?? '—'} · {a.codigo}</p>
                    </td>
                    <td className="px-3 py-2 text-muted">{a.tipo}</td>
                    <td className="px-3 py-2 text-muted">{a.vendedor ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.visitas || <span className="text-faint">—</span>}
                      {a.minutos > 0 && <p className="text-faint text-[11px]">{a.minutos} min</p>}
                    </td>
                    <td className="px-3 py-2 text-muted">{haceCuanto(a.ultima_visita)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.pedidos || <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => copiar(`${BASE_CATALOGO}?k=${a.codigo}`, 'Link copiado')}
                          title="Copiar el link de esta óptica"
                          className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors">
                          <Copy size={13} />
                        </button>
                        <button onClick={() => void activarAcceso(a)}
                          title={a.activo ? 'Dar de baja este link' : 'Volver a habilitarlo'}
                          className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors">
                          {a.activo ? <Link2Off size={13} /> : <Link2 size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Buscador de links por óptica ─────────────────────────────────── */}
      {tab === 'buscador' && (
        <>
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input autoFocus value={buscaCliente}
              onChange={(e) => { setBuscaCliente(e.target.value); void buscarCliente(e.target.value) }}
              placeholder="Nombre de la óptica, código de cliente, teléfono o token"
              className="w-full rounded-md border border-black/10 bg-white pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20" />
          </div>

          {buscaCliente.trim().length < 2 && (
            <p className="text-sm text-faint text-center py-14">
              Escribí al menos dos letras. Busca sobre todas las ópticas, tengan link o no.
            </p>
          )}

          {buscaCliente.trim().length >= 2 && !buscando && resultados.length === 0 && (
            <p className="text-sm text-faint text-center py-14">Ninguna óptica coincide con eso.</p>
          )}

          <div className="space-y-3">
            {resultados.map((c) => (
              <div key={c.cod} className="rounded-lg border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[15px] tracking-tight">{c.razon}</p>
                    <p className="text-[11px] text-faint">
                      {[c.cod, c.vendedor, c.localidad || c.provincia].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted tabular-nums shrink-0">
                    {c.visitas > 0
                      ? <p>{c.visitas} entradas al catálogo{c.minutos > 0 ? ` · ${c.minutos} min` : ''} · {haceCuanto(c.ultima_visita)}</p>
                      : <p className="text-faint">nunca entró al catálogo</p>}
                    {c.propuesta && <p>abrió {c.propuesta} · {haceCuanto(c.ultima_propuesta)}</p>}
                    {c.pedidos > 0 && <p className="font-medium">{c.pedidos} pedidos</p>}
                  </div>
                </div>

                {c.token ? (
                  <div className="space-y-1.5">
                    {linksDe(c.token).map((x) => (
                      <div key={x.l} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 text-[11px] text-muted">{x.l}</span>
                        <code className="flex-1 min-w-0 truncate text-[11px] text-ink bg-black/[0.03] rounded px-2 py-1">{x.u}</code>
                        <button onClick={() => copiar(x.u, `Link de ${x.l} copiado`)}
                          className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors shrink-0" title="Copiar">
                          <Copy size={13} />
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] text-faint pt-1">
                      Token <code>{c.token}</code>{c.token_activo ? '' : ' · dado de baja'}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] text-muted">Esta óptica todavía no tiene link propio.</p>
                    <button onClick={() => void generarToken(c)}
                      className="rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium shrink-0">
                      Generar link
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ponerle contraseña a alguien */}
      {clave && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setClave(null)}>
          <div className="bg-white rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold tracking-tight">Contraseña de {clave.nombre}</p>
            <p className="text-[12px] text-muted mt-1">
              Entra con <b>{clave.email}</b> y esta clave. Al guardar se copia sola: pasásela por WhatsApp.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <input value={claveTexto} onChange={(e) => setClaveTexto(e.target.value)} autoFocus
                className="flex-1 rounded-md border border-black/10 px-3 py-1.5 text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-brand/20" />
              <button onClick={() => setClaveTexto(claveAlAzar())} title="Generar otra"
                className="rounded-md border border-black/10 px-2.5 py-1.5 text-[11px] text-muted hover:bg-black/[0.03] transition-colors shrink-0">
                Otra
              </button>
              <button onClick={() => copiar(claveTexto, 'Clave copiada')} title="Copiar"
                className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors shrink-0">
                <Copy size={14} />
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setClave(null)} className="px-3 py-1.5 text-sm text-muted">Cancelar</button>
              <button onClick={() => void ponerClave()} disabled={guardandoClave}
                className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                {guardandoClave ? 'Guardando…' : 'Guardar clave'}
              </button>
            </div>
            <p className="text-[11px] text-faint mt-3">
              Es provisoria: {clave.nombre} puede cambiarla cuando entre, desde <b>Mi clave</b>.
              Si la pierde, volvés acá y le ponés otra.
            </p>
          </div>
        </div>
      )}

      {/* Paso 2: avisarle la contraseña */}
      {claveLista && (() => {
        const texto = mensajeClave(claveLista.nombre, claveLista.email, claveLista.pass)
        const tel = parseTelefonos(claveLista.telefono, true)[0]
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
            onClick={() => setClaveLista(null)}>
            <div className="bg-white rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <p className="text-[15px] font-semibold tracking-tight">Listo. Ahora avisale</p>
              <p className="text-[12px] text-muted mt-1">
                Ya puede entrar con su mail y esta contraseña. Mandale el mensaje:
              </p>
              <pre className="mt-3 rounded-md border border-black/10 bg-black/[0.02] p-3 text-[11px] whitespace-pre-wrap font-sans text-ink">
                {texto}
              </pre>
              <div className="flex flex-wrap gap-2 mt-4">
                {tel && (
                  <button onClick={() => abrirWhatsApp(tel.wa, texto)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium">
                    <MessageCircle size={13} /> WhatsApp
                  </button>
                )}
                <button onClick={() => abrirMail(claveLista.email, 'Tu acceso a la Suite de Orbital', texto)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 px-3 py-1.5 text-xs text-muted hover:bg-black/[0.03] transition-colors">
                  <Mail size={13} /> Mail
                </button>
                <button onClick={() => copiar(texto, 'Mensaje copiado')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 px-3 py-1.5 text-xs text-muted hover:bg-black/[0.03] transition-colors">
                  <Copy size={13} /> Copiar
                </button>
                <button onClick={() => setClaveLista(null)} className="ml-auto px-3 py-1.5 text-sm text-muted">
                  Cerrar
                </button>
              </div>
              {!tel && (
                <p className="text-[11px] text-faint mt-3">
                  No tiene WhatsApp cargado: agregáselo con <b>Editar</b> y la próxima vez sale de un toque.
                </p>
              )}
            </div>
          </div>
        )
      })()}

      {/* Clave de un colaborador */}
      {claveColab && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setClaveColab(null)}>
          <div className="bg-white rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold tracking-tight">Clave de {claveColab.nombre}</p>
            <p className="text-[12px] text-muted mt-1">
              Al cambiarla, el link que tenía deja de funcionar y hay que mandarle el nuevo.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <input value={claveColabTexto} onChange={(e) => setClaveColabTexto(e.target.value)} autoFocus
                className="flex-1 rounded-md border border-black/10 px-3 py-1.5 text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-brand/20" />
              <button onClick={() => setClaveColabTexto(claveColabAlAzar(claveColab.tipo))} title="Generar otra"
                className="rounded-md border border-black/10 px-2.5 py-1.5 text-[11px] text-muted hover:bg-black/[0.03] transition-colors shrink-0">
                Otra
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setClaveColab(null)} className="px-3 py-1.5 text-sm text-muted">Cancelar</button>
              <button onClick={() => void ponerClaveColab()}
                className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium">
                Guardar clave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alta y edición */}
      {editando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setEditando(null)}>
          <div className="bg-white rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold tracking-tight mb-4">
              {usuarios.some((u) => u.codigo === editando.codigo) ? 'Editar usuario' : 'Nuevo usuario'}
            </p>
            <div className="space-y-3">
              {([
                ['codigo', 'Código (no se puede cambiar después)'],
                ['nombre', 'Nombre'],
                ['email', 'Mail con el que entra'],
                ['telefono', 'WhatsApp (solo números, con 549)'],
              ] as [keyof typeof vacio, string][]).map(([k, l]) => (
                <label key={k} className="block">
                  <span className="text-[11px] text-muted">{l}</span>
                  <input value={(editando[k] as string) ?? ''}
                    disabled={k === 'codigo' && usuarios.some((u) => u.codigo === editando.codigo)}
                    onChange={(e) => setEditando({ ...editando, [k]: e.target.value })}
                    className="mt-1 w-full rounded-md border border-black/10 px-3 py-1.5 text-sm disabled:bg-black/[0.04] focus:outline-none focus:ring-2 focus:ring-brand/20" />
                </label>
              ))}
              <label className="block">
                <span className="text-[11px] text-muted">Rol</span>
                <select value={editando.rol} onChange={(e) => setEditando({ ...editando, rol: e.target.value as Rol })}
                  className="mt-1 w-full rounded-md border border-black/10 px-3 py-1.5 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editando.activo}
                  onChange={(e) => setEditando({ ...editando, activo: e.target.checked })} />
                Activo
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditando(null)} className="px-3 py-1.5 text-sm text-muted">Cancelar</button>
              <button onClick={() => void guardar()} disabled={guardando}
                className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            <p className="text-[11px] text-faint mt-3">
              Después de guardarlo, tocá <b>Clave</b> en la lista para ponerle la contraseña con la que entra.
              Su cuenta queda creada y vinculada en ese momento.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
