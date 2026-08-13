import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import {
  CalendarDays, Users, Send, ShoppingCart, TrendingUp, Megaphone, Package, UserPlus,
  PieChart, Wallet, BookUser, Eye, Palette, Truck, ReceiptText, Menu as MenuIcon, Factory, Store,
  BarChart3, Banknote, Calculator,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { Rol } from './lib/types'

import AgendaDelDia from './modules/actividad/AgendaDelDia'
import AgendaCampo from './modules/actividad/AgendaCampo'
import ProspeccionCampo from './modules/actividad/ProspeccionCampo'
import AgendaEquipo from './modules/actividad/AgendaEquipo'
import Cartera from './modules/actividad/Cartera'
import CargarActividad from './modules/actividad/CargarActividad'
import MisResultados from './modules/actividad/MisResultados'
import CoachFlotante from './modules/actividad/CoachFlotante'
import Marketing from './modules/actividad/Marketing'
import GuionesContacto from './modules/actividad/GuionesContacto'
import ProspeccionSocial from './modules/actividad/ProspeccionSocial'
import AdminActividad from './modules/actividad/AdminActividad'
import AdminMarketing from './modules/actividad/AdminMarketing'

import NuevoPedido from './modules/pedidos/NuevoPedido'
import Pedidos from './modules/pedidos/Pedidos'
import Envios from './modules/envios/Envios'
import GestionClientes from './modules/actividad/GestionClientes'
import Conversaciones from './modules/atencion/Conversaciones'
import BannerPendientes from './modules/atencion/BannerPendientes'
import BannerPedidosWeb from './modules/atencion/BannerPedidosWeb'
import MapaZonas from './modules/atencion/MapaZonas'
import EnviosEcom from './modules/atencion/Envios'
import DashboardPedidos from './modules/pedidos/Dashboard'
import Cobranzas from './modules/pedidos/Cobranzas'
import StockAdmin from './modules/pedidos/StockAdmin'
import Clientes from './modules/pedidos/Clientes'
import Produccion from './modules/pedidos/Produccion'
import Tienda from './modules/pedidos/Tienda'
import Publicidad from './modules/publicidad/Publicidad'
import Liquidacion from './modules/liquidacion/Liquidacion'
import PanelCosteo from './modules/produccion/PanelCosteo'
import GeneradorProduccion from './modules/produccion/GeneradorProduccion'
import PedidosProduccion from './modules/produccion/PedidosProduccion'
import DashboardVentas from './modules/pedidos/DashboardVentas'
import ActualizarBanner from './modules/ActualizarBanner'
import ProduccionHub from './modules/produccion/ProduccionHub'
import DashboardHub from './modules/pedidos/DashboardHub'
import CatalogoPublico from './modules/catalogo/CatalogoPublico'

interface NavItem {
  to: string
  label: string
}

const NAV_ICONS: Record<string, LucideIcon> = {
  '/hoy': CalendarDays,
  '/cartera': Users,
  '/envios': Send,
  '/pedidos': ShoppingCart,
  '/resultados': TrendingUp,
  '/marketing': Megaphone,
  '/pedidos/stock': Package,
  '/pedidos/dashboard': PieChart,
  '/pedidos/cobranzas': Wallet,
  '/pedidos/clientes': BookUser,
  '/actividad-admin': Eye,
  '/actividad-admin/marketing': Palette,
  '/gestion-clientes': UserPlus,
  '/produccion': Factory,
  '/tienda': Store,
  '/publicidad': BarChart3,
  '/envios-ecom': Truck,
  '/liquidacion': Banknote,
  '/produccion/costeo': Calculator,
  '/produccion/generar': Factory,
  '/produccion/pedidos': Factory,
  '/ventas-historico': TrendingUp,
}

function iconoDe(to: string, label: string) {
  if (label.includes('Entregas')) return Truck
  if (label.includes('Facturación') || label.includes('preparar')) return ReceiptText
  return NAV_ICONS[to] ?? Users
}

interface NavConfig {
  principales: NavItem[]
  secundarios: NavItem[] // visibles en escritorio, dentro de "Más" en celular
  menu: NavItem[] // siempre dentro del menú (Gestión)
}

function navConfig(rol: Rol, codigo?: string): NavConfig {
  if (rol === 'produccion')
    return {
      principales: [{ to: '/produccion', label: 'Producción' }],
      secundarios: [{ to: '/pedidos/stock', label: 'Stock' }],
      menu: [],
    }
  if (rol === 'tienda')
    return {
      principales: [
        { to: '/pedidos', label: 'Pedidos tienda' },
        { to: '/tienda', label: 'Shopify' },
      ],
      secundarios: [{ to: '/pedidos/stock', label: 'Stock' }],
      menu: [],
    }
  if (rol === 'deposito')
    return {
      principales: [
        { to: '/pedidos', label: 'A preparar' },
        { to: '/produccion', label: 'Ingresos' },
        { to: '/pedidos/stock', label: 'Stock' },
      ],
      secundarios: [],
      menu: [],
    }
  if (rol === 'logistica')
    return { principales: [{ to: '/pedidos', label: 'Entregas' }], secundarios: [], menu: [] }
  // Usuario de solo-contenido: únicamente la carpeta de material de marketing, nada más.
  if (rol === 'contenido')
    return { principales: [{ to: '/marketing', label: 'Contenido' }], secundarios: [], menu: [] }
  // Revendedor: Cartera (su zona), Pedidos (solo los suyos) y Marketing (material para vender). Nada más.
  if (rol === 'revendedor')
    return { principales: [{ to: '/cartera', label: 'Cartera' }, { to: '/pedidos', label: 'Pedidos' }, { to: '/marketing', label: 'Marketing' }], secundarios: [{ to: '/guiones', label: 'Guiones' }, { to: '/prospeccion-social', label: 'Prospección social' }], menu: [] }
  if (rol === 'administracion')
    return {
      principales: [
        { to: '/pedidos', label: 'Facturación' },
        { to: '/pedidos/cobranzas', label: 'Cobranzas' },
      ],
      secundarios: [
        { to: '/pedidos/dashboard', label: 'Dashboard' },
        { to: '/pedidos/clientes', label: 'Clientes' },
        { to: '/conversaciones', label: 'Conversaciones' },
        { to: '/liquidacion', label: 'Liquidación' },
        { to: '/envios-ecom', label: 'Envíos' },
      ],
      menu: [],
    }
  // Envíos ya no está en el menú: se abre como popup desde Cartera (la ruta sigue viva
  // por si hace falta volver a la vista completa con la cola del día).
  const principales: NavItem[] = [
    { to: '/hoy', label: 'Agenda' },
    { to: '/cartera', label: 'Cartera' },
    { to: '/pedidos', label: 'Pedidos' },
  ]
  const secundarios: NavItem[] = [
    { to: '/gestion-clientes', label: 'Mis clientes' },
    { to: '/resultados', label: 'Asistente' },
    { to: '/envios-ecom', label: 'Envíos' },
    { to: '/marketing', label: 'Marketing' },
    { to: '/guiones', label: 'Guiones' },
    { to: '/prospeccion-social', label: 'Prospección social' },
    { to: '/conversaciones', label: 'Conversaciones' },
  ]
  const menu: NavItem[] = []
  // El vendedor cobra sus propios pedidos: ve la misma solapa que administración,
  // pero acotada a su cartera.
  if (rol === 'vendedor') secundarios.push({ to: '/pedidos/cobranzas', label: 'Cobranzas' }, { to: '/ventas-historico', label: 'Ventas' })
  if (rol === 'vendedor' && codigo === 'Corporativo') menu.push({ to: '/actividad-admin', label: 'Equipo' })
  if (rol === 'admin') {
    secundarios.push({ to: '/pedidos/stock', label: 'Stock' })
    menu.push(
      { to: '/pedidos/dashboard', label: 'Dashboard' },
      { to: '/pedidos/cobranzas', label: 'Cobranzas' },
      { to: '/pedidos/clientes', label: 'Clientes' },
      { to: '/produccion', label: 'Producción (órdenes y costos)' },
      { to: '/tienda', label: 'Tienda Shopify' },
      { to: '/publicidad', label: 'Publicidad / ROAS' },
      { to: '/conversaciones', label: 'Conversaciones (bot)' },
      { to: '/liquidacion', label: 'Liquidación prospectores' },
      { to: '/envios-ecom', label: 'Envíos' },
      { to: '/actividad-admin', label: 'Equipo' },
      { to: '/agenda-equipo', label: 'Agenda equipo (campo)' },
      { to: '/actividad-admin/marketing', label: 'Piezas de marketing' },
      { to: '/guiones', label: 'Guiones de contacto' },
      { to: '/prospeccion-social', label: 'Cola de prospección social' }
    )
  }
  return { principales, secundarios, menu }
}

function homeFor(rol: Rol): string {
  if (rol === 'produccion') return '/produccion'
  if (rol === 'contenido') return '/marketing'
  if (rol === 'revendedor') return '/cartera'
  if (rol === 'deposito' || rol === 'logistica' || rol === 'administracion' || rol === 'tienda') return '/pedidos'
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
    <div className="min-h-screen flex items-center justify-center bg-[#F6F4EF] px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8">
        <div className="flex items-center gap-2.5 mb-2">
          <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" style={{ height: 24 }} />
          <span className="text-[10px] font-bold tracking-[0.3em] text-gold uppercase mt-1">Suite</span>
        </div>
        <div className="h-px bg-gradient-to-r from-gold/60 to-transparent mb-4" />
        <p className="text-sm text-muted mb-6">Pedidos y actividad comercial en un solo lugar. Ingresá con tu mail.</p>
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
      <div className="min-h-screen flex items-center justify-center text-sm text-muted bg-[#F6F4EF]">
        Cargando...
      </div>
    )
  if (!session) return <Login />
  if (!vendedor)
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted bg-[#F6F4EF] px-6 text-center">
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
  { value: 'vendedor:Marketing', label: 'Luna (prospección)' },
  { value: 'vendedor:Damian', label: 'Damián (prospección)' },
  { value: 'vendedor:ProspeccionVenta', label: 'Prosp. venta directa' },
  { value: 'vendedor:Corporativo', label: 'Corporativo' },
  { value: 'revendedor', label: 'Revendedor Cuyo/SF' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'produccion', label: 'Producción' },
  { value: 'tienda', label: 'Tienda online' },
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
  const { vendedor, signOut, rolEfectivo, codigoEfectivo, viewAs, setViewAs, cuentas, setCuenta } = useAuth()
  const location = useLocation()
  // En escritorio, Cartera usa todo el ancho del monitor para ver todos los datos sin scroll
  const anchoAmplio = location.pathname === '/cartera'
  const esAdminReal = vendedor?.rol === 'admin'
  const rol = rolEfectivo
  const nav = navConfig(rol, codigoEfectivo)
  const [menuOpen, setMenuOpen] = useState(false)
  const hayMenu = nav.menu.length > 0 || nav.secundarios.length > 0
  const esVendedorOAdmin = rol === 'vendedor' || rol === 'admin'

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F4EF]">
      <ActualizarBanner />
      <BannerPendientes />
      <BannerPedidosWeb />
      <header className="bg-white border-b border-black/10 px-4 py-3 flex items-center justify-between sticky top-0 z-10 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
            <span className="text-[9px] font-bold tracking-[0.28em] text-gold uppercase mt-0.5">Suite</span>
          </div>
          <p className="text-xs text-muted truncate mt-0.5">
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
          {cuentas.length > 1 && (
            <select
              value={vendedor?.codigo ?? ''}
              onChange={(e) => setCuenta(e.target.value)}
              title="Cambiar entre tus roles"
              className="text-xs bg-white border border-brand/30 rounded-lg px-2 py-1.5 text-brandDark font-medium max-w-[150px]"
            >
              {cuentas.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  🔀 {c.nombre}
                </option>
              ))}
            </select>
          )}
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
      <main className={`flex-1 pb-20 w-full mx-auto px-3 pt-3 ${anchoAmplio ? 'max-w-[1600px]' : 'max-w-6xl'}`}>
        <Routes>
          <Route index element={<Navigate to={homeFor(rol)} replace />} />
          {esVendedorOAdmin && (
            <>
              <Route path="/hoy" element={
                codigoEfectivo === 'Adrian' || codigoEfectivo === 'Martin' ? <AgendaCampo />
                : codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian' ? <ProspeccionCampo />
                : rol === 'admin' ? <AgendaEquipo />
                : <AgendaDelDia />
              } />
              <Route path="/cartera" element={<Cartera />} />
              <Route path="/cargar" element={<CargarActividad />} />
              <Route path="/resultados" element={<MisResultados />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/pedidos/nuevo" element={<NuevoPedido />} />
              <Route path="/envios" element={<Envios />} />
              <Route path="/gestion-clientes" element={<GestionClientes />} />
            </>
          )}
          {rol === 'contenido' && <Route path="/marketing" element={<Marketing />} />}
          {rol === 'revendedor' && (
            <>
              <Route path="/cartera" element={<Cartera />} />
              <Route path="/pedidos/nuevo" element={<NuevoPedido />} />
              <Route path="/marketing" element={<Marketing />} />
            </>
          )}
          {rol !== 'contenido' && <Route path="/pedidos" element={<Pedidos />} />}
          {(rol === 'admin' || rol === 'administracion') && (
            <>
              <Route path="/pedidos/dashboard" element={<DashboardHub />} />
              <Route path="/pedidos/clientes" element={<Clientes />} />
            </>
          )}
          {(rol === 'admin' || rol === 'administracion' || rol === 'vendedor') && (
            <Route path="/pedidos/cobranzas" element={<Cobranzas />} />
          )}
          {(rol === 'admin' || rol === 'deposito' || rol === 'produccion' || rol === 'tienda') && (
            <Route path="/pedidos/stock" element={<StockAdmin />} />
          )}
          {(rol === 'admin' || rol === 'deposito' || rol === 'produccion') && (
            <Route path="/produccion" element={<ProduccionHub />} />
          )}
          {(rol === 'admin' || rol === 'produccion') && <Route path="/produccion/costeo" element={<PanelCosteo />} />}
          {(rol === 'admin' || rol === 'produccion') && <Route path="/produccion/generar" element={<GeneradorProduccion />} />}
          {(rol === 'admin' || rol === 'produccion') && <Route path="/produccion/pedidos" element={<PedidosProduccion />} />}
          {(rol === 'admin' || rol === 'tienda') && <Route path="/tienda" element={<Tienda />} />}
          {rol === 'admin' && <Route path="/publicidad" element={<Publicidad />} />}
          {(rol === 'admin' || codigoEfectivo === 'Corporativo') && (
            <Route path="/actividad-admin" element={<AdminActividad />} />
          )}
          {rol === 'admin' && <Route path="/actividad-admin/marketing" element={<AdminMarketing />} />}
          {(rol === 'admin' || rol === 'administracion' || codigoEfectivo === 'Corporativo') && <Route path="/agenda-equipo" element={<AgendaEquipo />} />}
          <Route path="/conversaciones" element={<Conversaciones />} />
          <Route path="/derivaciones" element={<Conversaciones />} />
          <Route path="/guiones" element={<GuionesContacto />} />
          <Route path="/prospeccion-social" element={<ProspeccionSocial />} />
          {(rol === 'admin' || rol === 'administracion') && <Route path="/liquidacion" element={<Liquidacion />} />}
          {(rol === 'admin' || rol === 'administracion' || rol === 'vendedor') && <Route path="/ventas-historico" element={<DashboardVentas />} />}
          {(rol === 'admin' || rol === 'administracion' || codigoEfectivo === 'Corporativo') && <Route path="/mapa-zonas" element={<MapaZonas />} />}
          <Route path="/envios-ecom" element={<EnviosEcom />} />

          <Route path="*" element={<Navigate to={homeFor(rol)} replace />} />
        </Routes>
      </main>
      <CoachFlotante />
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-black/10 max-w-6xl mx-auto w-full left-0 right-0 z-20">
        {menuOpen && (
          <div className="absolute bottom-full right-2 mb-2 bg-white border border-black/10 rounded-xl shadow-lg p-2 w-56">
            {nav.secundarios.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `md:hidden block px-3 py-2.5 rounded-lg text-sm ${isActive ? 'text-brandDark font-semibold bg-brand/5' : 'text-ink'}`
                }
              >
                {it.label}
              </NavLink>
            ))}
            {nav.menu.length > 0 && nav.secundarios.length > 0 && (
              <p className="md:hidden text-[10px] text-faint uppercase tracking-wide px-3 pt-2 pb-1 border-t border-black/5 mt-1">
                Gestión
              </p>
            )}
            {nav.menu.map((it) => {
              const Icono = iconoDe(it.to, it.label)
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${isActive ? 'text-brandDark font-semibold bg-gold/10' : 'text-ink'}`
                  }
                >
                  <Icono size={16} strokeWidth={1.75} />
                  {it.label}
                </NavLink>
              )
            })}
          </div>
        )}
        <div className="flex overflow-x-auto">
          {nav.principales.map((it) => {
            const Icono = iconoDe(it.to, it.label)
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/pedidos'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold whitespace-nowrap px-2 border-t-2 ${
                    isActive ? 'text-ink border-gold' : 'text-faint border-transparent'
                  }`
                }
              >
                <Icono size={19} strokeWidth={1.75} />
                {it.label}
              </NavLink>
            )
          })}
          {nav.secundarios.map((it) => {
            const Icono = iconoDe(it.to, it.label)
            return (
              <NavLink
                key={it.to}
                to={it.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `hidden md:flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold whitespace-nowrap px-2 border-t-2 ${
                    isActive ? 'text-ink border-gold' : 'text-faint border-transparent'
                  }`
                }
              >
                <Icono size={19} strokeWidth={1.75} />
                {it.label}
              </NavLink>
            )
          })}
          {hayMenu && (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex-1 md:flex-none md:px-6 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold whitespace-nowrap px-2 border-t-2 border-transparent ${
                menuOpen ? 'text-ink' : 'text-faint'
              }`}
            >
              <MenuIcon size={19} strokeWidth={1.75} />
              {nav.menu.length > 0 ? 'Gestión' : 'Más'}
            </button>
          )}
        </div>
      </nav>
    </div>
  )
}

export default function App() {
  // Catálogo B2B público: ruta independiente del login por mail (acceso con clave propia).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/catalogo')) {
    return (
      <ToastProvider>
        <CatalogoPublico />
      </ToastProvider>
    )
  }
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
