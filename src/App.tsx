import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { Rol } from './lib/types'

import AgendaDelDia from './modules/actividad/AgendaDelDia'
import Cartera from './modules/actividad/Cartera'
import CargarActividad from './modules/actividad/CargarActividad'
import MisResultados from './modules/actividad/MisResultados'
import Marketing from './modules/actividad/Marketing'
import AdminActividad from './modules/actividad/AdminActividad'
import AdminMarketing from './modules/actividad/AdminMarketing'

import NuevoPedido from './modules/pedidos/NuevoPedido'
import Pedidos from './modules/pedidos/Pedidos'
import DashboardPedidos from './modules/pedidos/Dashboard'
import Cobranzas from './modules/pedidos/Cobranzas'
import StockAdmin from './modules/pedidos/StockAdmin'
import Clientes from './modules/pedidos/Clientes'

interface NavItem {
  to: string
  label: string
}

function navFor(rol: Rol): NavItem[] {
  if (rol === 'deposito')
    return [
      { to: '/pedidos', label: '📦 A preparar' },
      { to: '/pedidos/stock', label: 'Stock' },
    ]
  if (rol === 'logistica') return [{ to: '/pedidos', label: '🚚 Entregas' }]
  if (rol === 'administracion')
    return [
      { to: '/pedidos', label: '📋 Facturación' },
      { to: '/pedidos/cobranzas', label: '📞 Cobranzas' },
      { to: '/pedidos/dashboard', label: '📊 Dashboard' },
      { to: '/pedidos/clientes', label: '👥 Clientes' },
    ]
  const base: NavItem[] = [
    { to: '/hoy', label: 'Agenda del Día' },
    { to: '/cartera', label: 'Cartera' },
    { to: '/cargar', label: 'Cargar Actividad' },
    { to: '/resultados', label: 'Mis Resultados' },
    { to: '/marketing', label: 'Marketing' },
    { to: '/pedidos/nuevo', label: '🛒 Nuevo Pedido' },
    { to: '/pedidos', label: 'Mis Pedidos' },
  ]
  if (rol === 'admin')
    return [
      ...base,
      { to: '/pedidos/dashboard', label: '📊 Dashboard' },
      { to: '/pedidos/cobranzas', label: '📞 Cobranzas' },
      { to: '/pedidos/stock', label: 'Stock' },
      { to: '/pedidos/clientes', label: '👥 Clientes' },
      { to: '/actividad-admin', label: 'Admin' },
    ]
  return base
}

function homeFor(rol: Rol): string {
  if (rol === 'deposito' || rol === 'logistica' || rol === 'administracion') return '/pedidos'
  return '/hoy'
}

function Login() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    const { error: err } = await signInWithEmail(email.trim())
    setSending(false)
    if (err) setError(err)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f4f7] px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-semibold text-ink mb-1">Orbital Suite</h1>
        <p className="text-sm text-muted mb-6">
          Pedidos + Actividad Comercial. Ingresá con tu mail para acceder.
        </p>
        {sent ? (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            Te enviamos un link de acceso a <b>{email}</b>. Abrilo desde este mismo dispositivo.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="tu@mail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-white border border-black/10 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {sending ? 'Enviando...' : 'Enviarme el link de acceso'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { session, vendedor, loading } = useAuth()
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted bg-[#f4f4f7]">
        Cargando...
      </div>
    )
  if (!session) return <Login />
  if (!vendedor)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted bg-[#f4f4f7] px-6 text-center">
        Tu mail todavía no está vinculado a ningún usuario. Pedile al admin que cargue tu mail en la tabla de
        vendedores.
      </div>
    )
  return <>{children}</>
}

const VIEW_OPTIONS = [
  { value: 'admin', label: 'Admin (todo)' },
  { value: 'vendedor:Adrian', label: 'Adrián' },
  { value: 'vendedor:Martin', label: 'Martín' },
  { value: 'vendedor:Marketing', label: 'Prospección' },
  { value: 'vendedor:ProspeccionVenta', label: 'Prosp. venta directa' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'logistica', label: 'Logística' },
  { value: 'administracion', label: 'Administración' },
]

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem('orbital_theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('orbital_theme', dark ? 'dark' : 'light')
  }, [dark])
  return (
    <button
      onClick={() => setDark(!dark)}
      title={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="text-base leading-none px-1.5 py-1 rounded-lg border border-black/10"
    >
      {dark ? '☀️' : '🌙'}
    </button>
  )
}

function Layout() {
  const { vendedor, signOut, rolEfectivo, viewAs, setViewAs } = useAuth()
  const esAdminReal = vendedor?.rol === 'admin'
  const rol = rolEfectivo
  const items = navFor(rol)
  const esVendedorOAdmin = rol === 'vendedor' || rol === 'admin'

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f4f7]">
      <header className="bg-white border-b border-black/10 px-4 py-3 flex items-center justify-between sticky top-0 z-10 gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Orbital Suite</p>
          <p className="text-xs text-muted truncate">
            {vendedor?.nombre ?? '—'}
            {viewAs && (
              <span className="text-brandDark">
                {' '}
                · viendo como {VIEW_OPTIONS.find((o) => o.value === viewAs)?.label ?? viewAs}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {esAdminReal && (
            <select
              value={viewAs ?? 'admin'}
              onChange={(e) => setViewAs(e.target.value === 'admin' ? null : e.target.value)}
              title="Ver la app como cada usuario"
              className="text-xs bg-white border border-black/10 rounded-lg px-2 py-1.5 text-muted max-w-[150px]"
            >
              {VIEW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  👁 {o.label}
                </option>
              ))}
            </select>
          )}
          <ThemeToggle />
          <button onClick={signOut} className="text-xs text-muted underline">
            Salir
          </button>
        </div>
      </header>
      <main className="flex-1 pb-20 max-w-6xl w-full mx-auto px-3 pt-3">
        <Routes>
          <Route index element={<Navigate to={homeFor(rol)} replace />} />
          {esVendedorOAdmin && (
            <>
              <Route path="/hoy" element={<AgendaDelDia />} />
              <Route path="/cartera" element={<Cartera />} />
              <Route path="/cargar" element={<CargarActividad />} />
              <Route path="/resultados" element={<MisResultados />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/pedidos/nuevo" element={<NuevoPedido />} />
            </>
          )}
          <Route path="/pedidos" element={<Pedidos />} />
          {(rol === 'admin' || rol === 'administracion') && (
            <>
              <Route path="/pedidos/dashboard" element={<DashboardPedidos />} />
              <Route path="/pedidos/cobranzas" element={<Cobranzas />} />
              <Route path="/pedidos/clientes" element={<Clientes />} />
            </>
          )}
          {(rol === 'admin' || rol === 'deposito') && (
            <Route path="/pedidos/stock" element={<StockAdmin />} />
          )}
          {rol === 'admin' && (
            <>
              <Route path="/actividad-admin" element={<AdminActividad />} />
              <Route path="/actividad-admin/marketing" element={<AdminMarketing />} />
            </>
          )}
          <Route path="*" element={<Navigate to={homeFor(rol)} replace />} />
        </Routes>
      </main>
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-black/10 flex max-w-6xl mx-auto w-full left-0 right-0 overflow-x-auto">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/pedidos'}
            className={({ isActive }) =>
              `flex-1 text-center py-3 text-xs font-medium whitespace-nowrap px-2 ${
                isActive ? 'text-brandDark' : 'text-muted'
              }`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Protected>
            <Layout />
          </Protected>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
