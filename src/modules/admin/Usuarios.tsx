import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { RefreshCw, Search, Copy, KeyRound, Plus, Link2, Link2Off } from 'lucide-react'
import type { Rol } from '../../lib/types'

// Administración de accesos — quién entra a la Suite y quién tiene link del catálogo.
//
// Las contraseñas no se manejan desde acá y no se pueden ver: Supabase las guarda
// hasheadas. Lo que sí se puede es mandarle a la persona un link por mail para que
// entre, que además es más seguro que dictarle una clave por teléfono.

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

const BASE_CATALOGO = 'https://orbital-pedidos-zu5qorbital-suite.vercel.app/catalogo'

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
  const [tab, setTab] = useState<'usuarios' | 'catalogo'>('usuarios')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<typeof vacio | null>(null)
  const [guardando, setGuardando] = useState(false)

  const esAdmin = rolEfectivo === 'admin'

  const cargar = useCallback(async () => {
    setLoading(true)
    const [us, ac] = await Promise.all([
      supabase.rpc('admin_usuarios'),
      supabase.rpc('admin_accesos', { p_busca: null, p_limite: 500 }),
    ])
    setUsuarios(us.error ? [] : ((us.data as Usuario[]) ?? []))
    setAccesos(ac.error ? [] : ((ac.data as Acceso[]) ?? []))
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
           ['catalogo', `Accesos al catálogo · ${conToken.length}`]] as ['usuarios' | 'catalogo', string][]).map(([k, l]) => (
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
              No se pueden ver desde acá: Supabase las guarda encriptadas y nadie —ni vos ni yo— puede leerlas.
              Con <strong>Mandar link</strong> la persona recibe un acceso por mail y entra sin contraseña.
              Si igual querés ponerle una, se hace en Supabase → Authentication → Users.
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
                          <button onClick={() => void mandarLink(u)}
                            className="rounded-md border border-black/10 px-2 py-1 text-[11px] text-muted hover:bg-black/[0.03] transition-colors">
                            Mandar link
                          </button>
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
              Al crear un usuario nuevo, mandale el link por mail desde la lista. Al entrar por primera vez,
              su cuenta queda vinculada sola.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
