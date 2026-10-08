import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  CalendarDays, Users, Send, ShoppingCart, TrendingUp, Megaphone, Package, UserPlus,
  PieChart, Wallet, BookUser, Eye, Palette, Truck, ReceiptText, Menu as MenuIcon, Factory, Store,
  BarChart3, Banknote, Calculator, Tag, Landmark, ScanEye, Search, Briefcase, Car,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import { ToastProvider } from './lib/toast'
import { Rol } from './lib/types'

import AgendaDelDia from './modules/actividad/AgendaDelDia'
import AgendaCampo from './modules/actividad/AgendaCampo'
import ProspeccionCampo from './modules/actividad/ProspeccionCampo'
import AgendaEquipo from './modules/actividad/AgendaEquipo'
import Cartera from './modules/actividad/Cartera'
import MisOpticas from './modules/actividad/MisOpticas'
import CargarActividad from './modules/actividad/CargarActividad'
import MisResultados from './modules/actividad/MisResultados'
import CoachFlotante from './modules/actividad/CoachFlotante'
import Marketing from './modules/actividad/Marketing'
import EnvioCatalogo from './modules/actividad/EnvioCatalogo'
import GuionesContacto from './modules/actividad/GuionesContacto'
import CondicionesComerciales from './modules/actividad/CondicionesComerciales'
import ProspeccionSocial from './modules/actividad/ProspeccionSocial'
import MiTanda from './modules/actividad/MiTanda'
import Seguimiento from './modules/actividad/Seguimiento'
import PanelResultados from './modules/actividad/PanelResultados'
import Usuarios from './modules/admin/Usuarios'
import AdminActividad from './modules/actividad/AdminActividad'
import AdminMarketing from './modules/actividad/AdminMarketing'

import NuevoPedido from './modules/pedidos/NuevoPedido'
import Escanear from './modules/pedidos/Escanear'
import Muestrario from './modules/pedidos/Muestrario'
import Pedidos from './modules/pedidos/Pedidos'
import Devoluciones from './modules/pedidos/Devoluciones'
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
import PanelCanales from './modules/panel/PanelCanales'
import ColabInfluencers from './modules/colab/ColabInfluencers'
import CreadoresSuite from './modules/colab/CreadoresSuite'
import OpticasInstagram from './modules/colab/OpticasInstagram'
import Liquidacion from './modules/liquidacion/Liquidacion'
import GastosAuto from './modules/gastos/GastosAuto'
import PanelCosteo from './modules/produccion/PanelCosteo'
import GeneradorProduccion from './modules/produccion/GeneradorProduccion'
import PedidosProduccion from './modules/produccion/PedidosProduccion'
import DashboardVentas from './modules/pedidos/DashboardVentas'
import ActualizarBanner from './modules/ActualizarBanner'
import InstalarApp from './components/InstalarApp'
import ProduccionHub from './modules/produccion/ProduccionHub'
import DashboardHub from './modules/pedidos/DashboardHub'
import CatalogoPublico from './modules/catalogo/CatalogoPublico'
import CobroPublico from './modules/cobros/CobroPublico'
import PanelCobros from './modules/cobros/PanelCobros'
import CatalogoUSA from './modules/catalogo/CatalogoUSA'
import CentralConsigna from './modules/consigna/CentralConsigna'
import AyudaConsigna from './modules/consigna/AyudaConsigna'
import Consignas from './modules/consigna/Consignas'
import RedOpticas from './modules/consigna/RedOpticas'
import CatalogoZN from './modules/catalogo/CatalogoZN'
import Colab from './modules/colab/Colab'
import ColabRedireccion from './modules/colab/ColabRedireccion'
import MiCatalogo from './modules/catalogo/MiCatalogo'
import Postventa from './modules/postventa/Postventa'
import PedidosUSAAdmin from './modules/usa/PedidosUSAAdmin'
import MarcaBlancaPedidos from './modules/pedidos/MarcaBlancaPedidos'
import StockUSAAdmin from './modules/usa/StockUSAAdmin'
import ProteccionPublica from './modules/catalogo/ProteccionPublica'
import LandingProximamente from './modules/landings/LandingProximamente'
import LandingBienvenida from './modules/landings/LandingBienvenida'
import LandingCanje from './modules/landings/LandingCanje'
import Reconocer from './modules/landings/Reconocer'
import LandingModelo from './modules/landings/LandingModelo'
import QrExhibidor from './modules/landings/QrExhibidor'
import PreciosML from './modules/mercadolibre/PreciosML'
import FinanzasHub from './modules/finanzas/FinanzasHub'
import Pretest from './modules/visionlab/Pretest'
import VisionLabPanel from './modules/visionlab/VisionLabPanel'
import InformeProfesional from './modules/visionlab/InformeProfesional'
import Rostro from './modules/visionlab/rostro/Rostro'
import Lab, { CalcePagina } from './modules/visionlab/Lab'
import RedOftalmo from './modules/visionlab/RedOftalmo'

interface NavItem {
  to: string
  label: string
  grupo?: string // subtítulo dentro del menú Gestión
}

const NAV_ICONS: Record<string, LucideIcon> = {
  '/hoy': CalendarDays,
  '/cartera': Users,
  '/envios': Send,
  '/pedidos': ShoppingCart,
  '/resultados': TrendingUp,
  '/marketing': Megaphone,
  '/pedidos/stock': Package,
  '/mercadolibre/precios': Tag,
  '/pedidos/dashboard': PieChart,
  '/pedidos/cobranzas': Wallet,
  '/pedidos/clientes': BookUser,
  '/actividad-admin': Eye,
  '/actividad-admin/marketing': Palette,
  '/gestion-clientes': UserPlus,
  '/produccion': Factory,
  '/tienda': Store,
  '/publicidad': BarChart3,
  '/vision-lab': ScanEye,
  '/envios-ecom': Truck,
  '/liquidacion': Banknote,
  '/produccion/costeo': Calculator,
  '/produccion/generar': Factory,
  '/produccion/pedidos': Factory,
  '/ventas-historico': TrendingUp,
  '/finanzas': Landmark,
  '/cobros': Banknote,
  '/consignas': Package,
  '/red-opticas': Store,
  '/marca-blanca-pedidos': Tag,
  '/pedidos/muestrario': Briefcase,
  '/gastos': Car,
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
        { to: '/devoluciones', label: 'Devoluciones' },
        { to: '/pedidos/stock', label: 'Stock' },
      ],
      secundarios: [],
      menu: [],
    }
  if (rol === 'logistica')
    return { principales: [{ to: '/pedidos', label: 'Entregas' }], secundarios: [], menu: [] }
  // Usuario USA: circuito 100% independiente (stock/pedidos USA). No ve nada de Argentina.
  if (rol === 'usa')
    return {
      principales: [
        { to: '/usa-pedidos', label: 'USA Orders' },
        { to: '/usa-stock', label: 'USA Stock' },
      ],
      secundarios: [],
      menu: [],
    }
  // Usuario de solo-contenido: únicamente la carpeta de material de marketing, nada más.
  if (rol === 'contenido')
    return { principales: [{ to: '/marketing', label: 'Contenido' }], secundarios: [], menu: [] }
  // Prospección social (piloto): solo la Cola de prospección + Guiones + Marketing (material). Nada más.
  if (rol === 'social')
    return { principales: [{ to: '/prospeccion-social', label: 'Prospección' }, { to: '/guiones', label: 'Guiones' }, { to: '/marketing', label: 'Material' }, { to: '/condiciones', label: 'Condiciones' }], secundarios: [], menu: [] }
  // Revendedor: Mis ópticas (las compartidas, solo lectura), Cartera (su zona), Pedidos (solo los suyos)
  // y Marketing (material para vender). Nada más.
  if (rol === 'revendedor')
    return { principales: [{ to: '/mis-opticas', label: 'Mis ópticas' }, { to: '/mi-catalogo', label: 'Catálogo' }, { to: '/cartera', label: 'Cartera' }, { to: '/pedidos', label: 'Pedidos' }, { to: '/marketing', label: 'Marketing' }], secundarios: [{ to: '/guiones', label: 'Guiones' }], menu: [] }
  // Rol financiero: solo el tablero de tesorería. No ve pedidos ni carteras comerciales.
  // Postventa: lo de después de la venta, en 6 accesos (Postventa, Catálogo, Devoluciones,
  // Envíos, Pedidos, Conversaciones). No ve plata: ni cobranzas ni finanzas.
  if (rol === 'postventa')
    return {
      principales: [
        { to: '/postventa', label: 'Postventa' },
        { to: '/mi-catalogo', label: 'Catálogo' },
        { to: '/devoluciones', label: 'Devoluciones (NC)' },
        { to: '/envios-ecom', label: 'Envíos' },
        { to: '/pedidos', label: 'Pedidos' },
        { to: '/conversaciones', label: 'Conversaciones' },
      ],
      secundarios: [],
      menu: [],
    }

  if (rol === 'financiero')
    return { principales: [{ to: '/finanzas', label: 'Finanzas' }, { to: '/cobros', label: 'Cobros' }], secundarios: [], menu: [] }
  if (rol === 'administracion')
    return {
      principales: [
        { to: '/mi-tanda', label: 'Mi tanda' },
        { to: '/pedidos', label: 'Facturación' },
        { to: '/pedidos/cobranzas', label: 'Cobranzas' },
        { to: '/cobros', label: 'Cobros' },
      ],
      secundarios: [
        { to: '/cartera', label: 'Cartera' },
        { to: '/panel-resultados', label: 'Resultados' },
        { to: '/pedidos/dashboard', label: 'Dashboard' },
        { to: '/pedidos/clientes', label: 'Clientes' },
        { to: '/devoluciones', label: 'Devoluciones (NC)' },
        { to: '/conversaciones', label: 'Conversaciones' },
        { to: '/liquidacion', label: 'Liquidación' },
        { to: '/gastos', label: 'Gastos de auto' },
        { to: '/consignas', label: 'Consignas' },
        { to: '/marca-blanca-pedidos', label: 'Marca blanca' },
        { to: '/red-opticas', label: 'Red de ópticas' },
        { to: '/finanzas', label: 'Finanzas' },
        { to: '/envios-ecom', label: 'Envíos' },
        { to: '/prospeccion-social', label: 'Cola de prospección' },
        { to: '/condiciones', label: 'Condiciones' },
      ],
      menu: [],
    }
  // Envíos ya no está en el menú: se abre como popup desde Cartera (la ruta sigue viva
  // por si hace falta volver a la vista completa con la cola del día).
  const principales: NavItem[] = [
    { to: '/hoy', label: 'Agenda' },
    { to: '/panel-resultados', label: 'Resultados' },
    { to: '/cartera', label: 'Cartera' },
    { to: '/pedidos', label: 'Pedidos' },
  ]
  const secundarios: NavItem[] = [
    { to: '/gestion-clientes', label: 'Mis clientes' },
    { to: '/pedidos/muestrario', label: 'Muestrario' },
    { to: '/resultados', label: 'Asistente' },
    { to: '/envios-ecom', label: 'Envíos' },
    { to: '/marketing', label: 'Marketing' },
    { to: '/guiones', label: 'Guiones' },
    { to: '/condiciones', label: 'Condiciones' },
    { to: '/conversaciones', label: 'Conversaciones' },
    { to: '/red-opticas', label: 'Red de ópticas' },
  ]
  const menu: NavItem[] = []
  // La tanda diaria la trabaja todo el que prospecta: es su primera pantalla del día,
  // y al lado el resultado de lo que ya mandó (quién abrió el catálogo o la propuesta).
  // Van juntas y arriba: en secundarios quedaban dentro de "Más" y no las encontraban.
  if (['vendedor', 'admin'].includes(rol))
    principales.unshift({ to: '/mi-tanda', label: 'Mi tanda' }, { to: '/seguimiento', label: 'Seguimiento' })
  // El vendedor cobra sus propios pedidos: ve la misma solapa que administración,
  // pero acotada a su cartera.
  if (rol === 'vendedor') secundarios.push({ to: '/pedidos/cobranzas', label: 'Cobranzas' }, { to: '/cobros', label: 'Cobros' }, { to: '/ventas-historico', label: 'Ventas' })
  // Cada vendedor abre su catálogo personal (su token): lo que arme ahí queda a su nombre.
  if (rol === 'vendedor') principales.push({ to: '/mi-catalogo', label: 'Catálogo' })
  // Los de campo cargan nafta, peajes y estacionamiento contra sus check-ins.
  if (rol === 'vendedor' && ['Adrian', 'Bruno', 'Lola'].includes(codigo ?? '')) secundarios.push({ to: '/gastos', label: 'Gastos de auto' })
  if (rol === 'vendedor' && codigo === 'Corporativo') menu.push({ to: '/actividad-admin', label: 'Equipo' }, { to: '/consignas', label: 'Consignas' })
  // Ulises (prospección de zona CABA): su herramienta principal es la cola de prospección social (todas las zonas).
  if (rol === 'vendedor' && codigo === 'Ulises') principales.push({ to: '/prospeccion-social', label: 'Prospección social' })
  if (rol === 'admin') {
    secundarios.push({ to: '/pedidos/stock', label: 'Stock' }, { to: '/consignas', label: 'Consignas' }, { to: '/marca-blanca-pedidos', label: 'Marca blanca' })
    const V = 'Ventas y clientes', M = 'Marketing y redes', P = 'Producción y canales', F = 'Plata', E = 'Equipo'
    menu.push(
      { to: '/pedidos/dashboard', label: 'Dashboard', grupo: V },
      { to: '/pedidos/clientes', label: 'Clientes', grupo: V },
      { to: '/pedidos/cobranzas', label: 'Cobranzas', grupo: V },
      { to: '/conversaciones', label: 'Conversaciones (bot)', grupo: V },
      { to: '/envios-ecom', label: 'Envíos', grupo: V },
      { to: '/devoluciones', label: 'Devoluciones (ingreso + NC)', grupo: V },
      { to: '/postventa', label: 'Postventa', grupo: V },
      { to: '/publicidad', label: 'Publicidad / ROAS', grupo: M },
      { to: '/panel-canales', label: 'Panel de canales (maqueta)', grupo: M },
      { to: '/actividad-admin/marketing', label: 'Piezas de marketing', grupo: M },
      { to: '/creadores', label: 'Creadores (administradoras)', grupo: M },
      { to: '/influencers', label: 'Influencers de Instagram', grupo: M },
      { to: '/opticas-instagram', label: 'Ópticas de Instagram', grupo: M },
      { to: '/prospeccion-social', label: 'Cola de prospección social', grupo: M },
      { to: '/vision-lab', label: 'Vision Lab (rostro · calce · visión)', grupo: M },
      { to: '/produccion', label: 'Producción (órdenes y costos)', grupo: P },
      { to: '/tienda', label: 'Tienda Shopify', grupo: P },
      { to: '/mercadolibre/precios', label: 'Precios Mercado Libre', grupo: P },
      { to: '/finanzas', label: 'Finanzas (tesorería)', grupo: F },
      { to: '/cobros', label: 'Cobros (alias / QR propio)', grupo: F },
      { to: '/gastos', label: 'Gastos de auto (campo)', grupo: F },
      { to: '/actividad-admin', label: 'Equipo', grupo: E },
      { to: '/accesos', label: 'Accesos y usuarios', grupo: E }
    )
  }
  return { principales, secundarios, menu }
}

function homeFor(rol: Rol): string {
  if (rol === 'produccion') return '/produccion'
  if (rol === 'contenido') return '/marketing'
  if (rol === 'social') return '/prospeccion-social'
  if (rol === 'financiero') return '/finanzas'
  if (rol === 'postventa') return '/postventa'
  if (rol === 'revendedor') return '/mis-opticas'
  if (rol === 'deposito' || rol === 'logistica' || rol === 'administracion' || rol === 'tienda') return '/pedidos'
  if (rol === 'usa') return '/usa-pedidos'
  return '/hoy'
}

function Login() {
  const { signInWithEmail, signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [modo, setModo] = useState<'pass' | 'mail'>('pass')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    if (modo === 'mail') {
      const { error: err } = await signInWithEmail(email.trim())
      setSending(false)
      if (err) setError(err)
      else setSent(true)
    } else {
      const { error: err } = await signInWithPassword(email.trim(), password)
      setSending(false)
      if (err) setError(err)
      // Si entra bien, el listener de sesión re-renderiza la app ya logueada.
    }
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
            {modo === 'pass' && (
              <input
                type="password"
                required
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-white border border-black/10 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {sending ? (modo === 'pass' ? 'Entrando...' : 'Enviando...') : modo === 'pass' ? 'Entrar' : 'Enviarme el link de acceso'}
            </button>
            <button
              type="button"
              onClick={() => { setModo(modo === 'pass' ? 'mail' : 'pass'); setError(null) }}
              className="w-full text-xs text-muted underline"
            >
              {modo === 'pass' ? '¿No tenés contraseña? Entrá con un link por mail' : 'Entrar con email y contraseña'}
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
  { value: 'vendedor:Ulises', label: 'Ulises (prospección CABA)' },
  { value: 'vendedor:Bruno', label: 'Bruno (CABA/oeste)' },
  { value: 'vendedor:Lola', label: 'Lola (CABA norte/GBA norte)' },
  { value: 'vendedor:Corporativo', label: 'Corporativo' },
  { value: 'revendedor', label: 'Revendedor Cuyo/SF' },
  { value: 'social', label: 'Prospección social (piloto)' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'produccion', label: 'Producción' },
  { value: 'tienda', label: 'Tienda online' },
  { value: 'logistica', label: 'Logística' },
  { value: 'administracion', label: 'Administración' },
  { value: 'postventa', label: 'Postventa' },
  { value: 'usa', label: 'USA' },
  { value: 'financiero', label: 'Financiero' },
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

// Cada uno se cambia su propia contraseña. La que le da el admin al darlo de alta es
// provisoria; acá la reemplaza por una suya sin pasar por nadie.
function MiClave() {
  const [abierto, setAbierto] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  function cerrar() {
    setAbierto(false)
    setP1(''); setP2(''); setMsg(null); setListo(false)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (p1.length < 8) { setMsg('La contraseña necesita al menos 8 caracteres.'); return }
    if (p1 !== p2) { setMsg('Las dos contraseñas no coinciden.'); return }
    setGuardando(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    setGuardando(false)
    if (error) { setMsg(error.message); return }
    setListo(true)
    setP1(''); setP2('')
  }

  return (
    <>
      <button onClick={() => setAbierto(true)} className="text-xs text-muted underline">
        Mi clave
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={cerrar}>
          <div className="bg-white rounded-lg w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold tracking-tight">Cambiar mi contraseña</p>
            {listo ? (
              <>
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-4">
                  Listo. La próxima vez entrá con esta contraseña nueva.
                </p>
                <div className="flex justify-end mt-4">
                  <button onClick={cerrar} className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium">
                    Cerrar
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={guardar} className="mt-4 space-y-3">
                <input type="password" autoFocus placeholder="Contraseña nueva" value={p1}
                  onChange={(e) => setP1(e.target.value)}
                  className="w-full rounded-md border border-black/10 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20" />
                <input type="password" placeholder="Repetila" value={p2}
                  onChange={(e) => setP2(e.target.value)}
                  className="w-full rounded-md border border-black/10 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20" />
                {msg && <p className="text-sm text-red-600">{msg}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={cerrar} className="px-3 py-1.5 text-sm text-muted">Cancelar</button>
                  <button type="submit" disabled={guardando}
                    className="rounded-md bg-brand text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Menú "Más / Gestión": buscador, subgrupos y alto máximo con scroll, así nunca queda
// nada por afuera de la pantalla. Si los secundarios ya están en la barra de escritorio,
// acá solo se muestran en celular.
function MenuMas({ secundarios, secEnBarra, menu, onClose }: {
  secundarios: NavItem[]; secEnBarra: boolean; menu: NavItem[]; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function fuera(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-menu-mas]')) onClose()
    }
    function esc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const filtro = sinTildes(q.trim())
  const pasa = (it: NavItem) => !filtro || sinTildes(it.label).includes(filtro)
  // Secciones: primero los accesos de "Más" (sin título si no hay Gestión), después Gestión por grupo.
  const secciones: { titulo: string; items: NavItem[]; soloCelular: boolean }[] = []
  if (secundarios.length) secciones.push({ titulo: menu.length ? 'Accesos' : '', items: secundarios.filter(pasa), soloCelular: secEnBarra })
  const grupos = new Map<string, NavItem[]>()
  for (const it of menu.filter(pasa)) {
    const titulo = it.grupo ?? 'Gestión'
    grupos.set(titulo, [...(grupos.get(titulo) ?? []), it])
  }
  for (const [titulo, items] of grupos) secciones.push({ titulo, items, soloCelular: false })
  const visibles = secciones.filter((s) => s.items.length)
  const resultados = visibles.flatMap((s) => s.items)
  const total = secundarios.length + menu.length
  const ancho = menu.length > 12 ? 'md:w-[560px]' : 'md:w-64'

  return (
    <div ref={ref}
      className={`absolute bottom-full right-2 left-2 md:left-auto mb-2 bg-white border border-black/10 rounded-xl shadow-lg ${ancho} max-h-[calc(100dvh-140px)] flex flex-col`}>
      {total > 8 && (
        <div className="p-2 border-b border-black/5">
          <div className="flex items-center gap-2 rounded-lg border border-black/10 px-2.5 focus-within:ring-2 focus-within:ring-brand/20">
            <Search size={14} className="text-faint shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              autoFocus={window.matchMedia('(pointer: fine)').matches}
              onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) { navigate(resultados[0].to); onClose() } }}
              placeholder="Buscar sección…"
              className="w-full py-1.5 text-sm bg-transparent focus:outline-none placeholder:text-faint" />
          </div>
        </div>
      )}
      <div className={`overflow-y-auto overscroll-contain p-2 ${menu.length > 12 ? 'md:columns-2 md:gap-2' : ''}`}>
        {visibles.map((s) => (
          <div key={s.titulo || '_'} className={`break-inside-avoid mb-1 ${s.soloCelular ? 'md:hidden' : ''}`}>
            {s.titulo && <p className="text-[10px] text-faint uppercase tracking-wide px-3 pt-2 pb-1">{s.titulo}</p>}
            {s.items.map((it) => {
              const Icono = iconoDe(it.to, it.label)
              return (
                <NavLink key={it.to} to={it.to} onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${isActive ? 'text-brandDark font-semibold bg-gold/10' : 'text-ink hover:bg-black/[0.03]'}`
                  }>
                  <Icono size={16} strokeWidth={1.75} className="shrink-0" />
                  <span className="truncate">{it.label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
        {resultados.length === 0 && <p className="text-sm text-faint px-3 py-4 text-center">Nada con “{q}”.</p>}
      </div>
    </div>
  )
}

function Layout() {
  const { vendedor, signOut, rolEfectivo, codigoEfectivo, viewAs, setViewAs, cuentas, setCuenta } = useAuth()
  const location = useLocation()
  // En escritorio, Cartera usa todo el ancho del monitor para ver todos los datos sin scroll
  const anchoAmplio = location.pathname === '/cartera' || location.pathname === '/finanzas'
  const esAdminReal = vendedor?.rol === 'admin'
  const rol = rolEfectivo
  const nav = navConfig(rol, codigoEfectivo)
  const [menuOpen, setMenuOpen] = useState(false)
  const hayMenu = nav.menu.length > 0 || nav.secundarios.length > 0
  const esVendedorOAdmin = rol === 'vendedor' || rol === 'admin'
  // En escritorio los secundarios van en la barra solo si entran todos; si no, pasan al
  // menú (antes se iban de pantalla por el costado y no se veían).
  const secEnBarra = nav.principales.length + nav.secundarios.length <= 9
  const enMenu = [...nav.secundarios, ...nav.menu].some((it) => it.to === location.pathname)
    && !nav.principales.some((it) => it.to === location.pathname)

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
          <InstalarApp nombre="Orbital Suite" que="la Suite"
            bajada="Queda con el ícono de Orbital en el celular o la compu y abre la Suite directo, sin navegador." />
          <ThemeToggle />
          <MiClave />
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
                codigoEfectivo === 'Adrian' || codigoEfectivo === 'Bruno' || codigoEfectivo === 'Lola' ? <AgendaCampo />
                : codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian' ? <ProspeccionCampo />
                : rol === 'admin' ? <AgendaEquipo />
                : <AgendaDelDia />
              } />
              <Route path="/cartera" element={<Cartera />} />
              <Route path="/cargar" element={<CargarActividad />} />
              <Route path="/resultados" element={<MisResultados />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/pedidos/nuevo" element={<NuevoPedido />} />
              <Route path="/pedidos/escanear" element={<Escanear />} />
              <Route path="/pedidos/muestrario" element={<Muestrario />} />
              <Route path="/envios" element={<Envios />} />
              <Route path="/gestion-clientes" element={<GestionClientes />} />
            </>
          )}
          {(rol === 'contenido' || rol === 'social') && <Route path="/marketing" element={<Marketing />} />}
          {(rol === 'revendedor' || rol === 'vendedor' || rol === 'postventa') && <Route path="/mi-catalogo" element={<MiCatalogo />} />}
          {(rol === 'admin' || rol === 'postventa') && <Route path="/postventa" element={<Postventa />} />}
          {rol === 'administracion' && <Route path="/cartera" element={<Cartera />} />}
          {rol === 'revendedor' && (
            <>
              <Route path="/mis-opticas" element={<MisOpticas />} />
              <Route path="/cartera" element={<Cartera />} />
              <Route path="/marketing" element={<Marketing />} />
            </>
          )}
          {rol !== 'contenido' && <Route path="/pedidos" element={<Pedidos />} />}
          {(rol === 'usa' || rol === 'admin') && (
            <>
              <Route path="/usa-pedidos" element={<PedidosUSAAdmin />} />
              <Route path="/usa-stock" element={<StockUSAAdmin />} />
            </>
          )}
          {(rol === 'admin' || rol === 'administracion' || rol === 'deposito' || rol === 'postventa') && <Route path="/devoluciones" element={<Devoluciones />} />}
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
          {(rol === 'admin' || rol === 'tienda') && <Route path="/mercadolibre/precios" element={<PreciosML />} />}
          {rol === 'admin' && <Route path="/publicidad" element={<Publicidad />} />}
          {rol === 'admin' && <Route path="/panel-canales" element={<PanelCanales />} />}
          {rol === 'admin' && <Route path="/creadores" element={<div className="max-w-6xl mx-auto px-4 py-6"><CreadoresSuite /></div>} />}
          {rol === 'admin' && <Route path="/influencers" element={<div className="max-w-4xl mx-auto px-4 py-6"><ColabInfluencers /></div>} />}
          {rol === 'admin' && <Route path="/vision-lab" element={<div className="max-w-4xl mx-auto px-4 py-6"><VisionLabPanel /></div>} />}
          {rol === 'admin' && <Route path="/vision-lab/pretest" element={<Pretest origen="suite" />} />}
          {rol === 'admin' && <Route path="/vision-lab/rostro" element={<Rostro enSuite />} />}
          {rol === 'admin' && <Route path="/vision-lab/perfil" element={<Lab enSuite />} />}
          {rol === 'admin' && <Route path="/vision-lab/calce" element={<CalcePagina enSuite />} />}
          {rol === 'admin' && <Route path="/vision-lab/red" element={<div className="max-w-4xl mx-auto px-4 py-6"><RedOftalmo /></div>} />}
          {rol === 'admin' && <Route path="/opticas-instagram" element={<div className="max-w-4xl mx-auto px-4 py-6"><OpticasInstagram /></div>} />}
          {(rol === 'admin' || codigoEfectivo === 'Corporativo') && (
            <Route path="/actividad-admin" element={<AdminActividad />} />
          )}
          {rol === 'admin' && <Route path="/actividad-admin/marketing" element={<AdminMarketing />} />}
          {(rol === 'admin' || rol === 'administracion' || codigoEfectivo === 'Corporativo') && <Route path="/agenda-equipo" element={<AgendaEquipo />} />}
          <Route path="/conversaciones" element={<Conversaciones />} />
          <Route path="/derivaciones" element={<Conversaciones />} />
          <Route path="/guiones" element={<GuionesContacto />} />
          {['vendedor', 'admin', 'social', 'administracion'].includes(rol) && <Route path="/condiciones" element={<CondicionesComerciales />} />}
          <Route path="/envio-catalogo" element={<EnvioCatalogo />} />
          {rol !== 'revendedor' && <Route path="/prospeccion-social" element={<ProspeccionSocial />} />}
          {rol !== 'revendedor' && <Route path="/mi-tanda" element={<MiTanda />} />}
          {rol !== 'revendedor' && <Route path="/seguimiento" element={<Seguimiento />} />}
          {rol !== 'revendedor' && <Route path="/panel-resultados" element={<PanelResultados />} />}
          {rol === 'admin' && <Route path="/accesos" element={<Usuarios />} />}
          {(rol === 'admin' || rol === 'administracion' || (rol === 'vendedor' && ['Adrian', 'Bruno', 'Lola'].includes(codigoEfectivo))) && <Route path="/gastos" element={<GastosAuto />} />}
          {(rol === 'admin' || rol === 'administracion') && <Route path="/liquidacion" element={<Liquidacion />} />}
          {(rol === 'admin' || rol === 'administracion' || codigoEfectivo === 'Corporativo') && <Route path="/consignas" element={<Consignas />} />}
          {(rol === 'admin' || rol === 'administracion') && <Route path="/marca-blanca-pedidos" element={<MarcaBlancaPedidos />} />}
          {['admin', 'administracion', 'postventa', 'vendedor'].includes(rol) && <Route path="/red-opticas" element={<RedOpticas />} />}
          {(rol === 'admin' || rol === 'administracion' || rol === 'financiero') && <Route path="/finanzas" element={<FinanzasHub />} />}
          {['admin', 'administracion', 'financiero', 'vendedor'].includes(rol) && <Route path="/cobros" element={<PanelCobros />} />}
          {(rol === 'admin' || rol === 'administracion' || rol === 'vendedor') && <Route path="/ventas-historico" element={<DashboardVentas />} />}
          {(rol === 'admin' || rol === 'administracion' || codigoEfectivo === 'Corporativo') && <Route path="/mapa-zonas" element={<MapaZonas />} />}
          <Route path="/envios-ecom" element={<EnviosEcom />} />

          <Route path="*" element={<Navigate to={homeFor(rol)} replace />} />
        </Routes>
      </main>
      <CoachFlotante />
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-black/10 max-w-6xl mx-auto w-full left-0 right-0 z-20">
        {menuOpen && (
          <MenuMas
            secundarios={nav.secundarios}
            secEnBarra={secEnBarra}
            menu={nav.menu}
            onClose={() => setMenuOpen(false)}
          />
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
                  `hidden ${secEnBarra ? 'md:flex' : ''} flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold whitespace-nowrap px-2 border-t-2 ${
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
              data-menu-mas
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex-1 md:flex-none md:px-6 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold whitespace-nowrap px-2 border-t-2 ${
                enMenu ? 'text-ink border-gold' : menuOpen ? 'text-ink border-transparent' : 'text-faint border-transparent'
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
  // Landings públicas de campañas (Meta), sin login. URL linda: ver.orbitaleyewear.com.ar/<slug>
  // Triple Protección: /proteccion o /tripleproteccion (o subdominio proteccion.)
  if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/proteccion') || window.location.pathname.startsWith('/tripleproteccion') || window.location.hostname.startsWith('proteccion.'))) {
    return (
      <ToastProvider>
        <ProteccionPublica />
      </ToastProvider>
    )
  }
  // Pack de Bienvenida (incorporación de ópticas nuevas a la red)
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/bienvenida')) {
    return (
      <ToastProvider>
        <LandingBienvenida />
      </ToastProvider>
    )
  }
  // Plan Canje (renovación de stock para clientes activos)
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/canje')) {
    return (
      <ToastProvider>
        <LandingCanje />
      </ToastProvider>
    )
  }
  // Reconocer un anteojo con la cámara → landing del modelo para el cliente final
  if (typeof window !== 'undefined' && /^\/reconocer\/?$/.test(window.location.pathname)) {
    return <Reconocer />
  }
  // QR para el exhibidor de la óptica (modelos destacados con 3D) → /modelo/<MODELO>?v=3d
  if (typeof window !== 'undefined' && /^\/ar-qr\/?$/.test(window.location.pathname)) {
    return <QrExhibidor />
  }
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/modelo/')) {
    return <LandingModelo />
  }
  // Campañas con ruta reservada (contenido a definir) → placeholder branded
  if (typeof window !== 'undefined') {
    const CAMPANAS: Record<string, string> = {
      '/dia-de-la-madre': 'Día de la Madre',
    }
    const slug = Object.keys(CAMPANAS).find((p) => window.location.pathname.startsWith(p))
    if (slug) {
      return (
        <ToastProvider>
          <LandingProximamente titulo={CAMPANAS[slug]} />
        </ToastProvider>
      )
    }
  }
  // Orbital Vision Lab · Estudio de rostro: escaneo facial → forma del rostro, talle y armazones que le van (público).
  if (typeof window !== 'undefined' && /^\/lab\/rostro\/?$/.test(window.location.pathname)) {
    return <Rostro />
  }
  // Orbital Vision Lab · Tu perfil visual: /lab sin parámetros = las tres herramientas (rostro, calce, chequeo);
  // /lab/calce = la medición de calce sola. /lab?o=… (QR de las ópticas) y ?src= siguen abriendo el chequeo visual.
  if (typeof window !== 'undefined' && /^\/lab\/?$/.test(window.location.pathname) && !window.location.search) {
    return <Lab />
  }
  if (typeof window !== 'undefined' && /^\/lab\/calce\/?$/.test(window.location.pathname)) {
    return <CalcePagina />
  }
  // Orbital Vision Lab: pretest visual público (tienda: ?src=tienda · QR en la óptica: ?o=<cod>) y /lab/buscar (solo ópticas / oftalmólogos).
  if (typeof window !== 'undefined' && /^\/lab(\/pretest|\/buscar)?\/?$/.test(window.location.pathname)) {
    return <Pretest />
  }
  // /lab/informe#…: lo que ve el óptico u oftalmólogo al escanear el QR del informe (datos en el fragmento, sin nombre).
  if (typeof window !== 'undefined' && /^\/lab\/informe\/?$/.test(window.location.pathname)) {
    return <InformeProfesional />
  }
  // Colaboradores (influencers): panel por clave (Orbital / administrador / promotor).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/colab')) {
    return <Colab />
  }
  // Link público de un promotor: genera el código de descuento único y manda a la tienda.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/r/')) {
    return <ColabRedireccion />
  }
  // Página de cobro pública: datos para transferir sin recargo (link / QR propio que manda el vendedor).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/cobro/')) {
    return <CobroPublico />
  }
  // Catálogo B2B público: ruta independiente del login por mail (acceso con clave propia).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/catalogo')) {
    return (
      <ToastProvider>
        <CatalogoPublico />
      </ToastProvider>
    )
  }
  // Cobranding ZN: selección de colección SIN precios (modelo + color), no genera pedido.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/zn')) {
    return (
      <ToastProvider>
        <CatalogoZN />
      </ToastProvider>
    )
  }
  // Ayuda de consigna en su propia ventana (se abre desde el panel).
  if (typeof window !== 'undefined' && /^\/consigna\/ayuda\/?$/.test(window.location.pathname)) {
    return (
      <ToastProvider>
        <AyudaConsigna />
      </ToastProvider>
    )
  }
  // Central de consigna por sucursales (cliente madre): stock por sucursal, movimientos y devoluciones. Acceso por token.
  if (typeof window !== 'undefined' && /^\/consigna\/?$/.test(window.location.pathname)) {
    return (
      <ToastProvider>
        <CentralConsigna />
      </ToastProvider>
    )
  }
  // Catálogo USA (independiente): stock Miami, USD, inglés, login propio.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/usa')) {
    return (
      <ToastProvider>
        <CatalogoUSA />
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
