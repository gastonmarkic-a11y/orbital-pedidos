// ── Colaboradores: tipos, formatos y generador de copies ─────────────────────
// Tres niveles, el rol lo define la clave (?k=):
//   orbital    → ve y da de alta ADMINISTRADORES
//   admin      → da de alta sus INFLUENCERS (promotores) y ve sus números
//   influencer → toma el copy + su link de cada anteojo y ve su dashboard

export const BASE = 'https://ver.orbitaleyewear.com.ar'
export const ACENTO = '#0004FF'
export const CLAVE_KEY = 'orbital_colab_clave'
export const VISITANTE_KEY = 'orbital_colab_visitante'

export type Rol = 'orbital' | 'admin' | 'influencer'
export type Entrada = {
  rol: Rol; id: number; nombre: string
  pct?: number; pct_descuento?: number; ref?: string; admin?: string
}

export type Red = { red: string; usuario: string; url?: string; seguidores?: string }

export type Numeros = { links: number; clicks: number; pedidos: number; neto: number; com_inf: number; com_adm: number }

export type Influencer = Numeros & {
  id: number; nombre: string; ref: string; clave: string
  email: string | null; telefono: string | null; redes: Red[]; nota: string | null
  activo: boolean; pct: number; pct_descuento: number; created_at: string
  admin_id: number; admin: string
}

export type Admin = Omit<Numeros, 'links'> & {
  id: number; nombre: string; clave: string; email: string | null; telefono: string | null
  nota: string | null; pct: number; activo: boolean; created_at: string
  influencers: number; influencers_activos: number; links: number
}

export type Color = {
  product_id: number; handle: string; color: string | null; imagen: string | null
  price: number | null; compare_at: number | null; sku: string | null; tipo: string | null
  tratamiento: string | null
}
export type Modelo = {
  modelo: string; linea: string | null; tipos: string[]; descripcion: string | null
  nuevo: boolean; best: boolean; precio_desde: number | null; colores: Color[]
}

export type MiLink = {
  id: number; codigo: string; modelo: string; handle: string; color: string | null; imagen: string | null
  red: string; formato: string; url_pub: string | null; activo: boolean; created_at: string
  clicks: number; pedidos: number; neto: number; com: number
}

export type SerieMes = { periodo: string; clicks: number; pedidos: number; pendientes: number; neto: number; com_inf: number; com_adm: number }
export type Resumen = {
  rol: Rol; hay_datos: boolean
  serie: SerieMes[]
  top: { modelo: string; links: number; clicks: number; pedidos: number; neto: number }[]
  redes: { red: string; links: number; clicks: number; pedidos: number; neto: number }[]
  posts: { id: number; codigo: string; modelo: string; red: string; formato: string; url_pub: string | null; created_at: string; influencer: string; clicks: number; pedidos: number; neto: number }[]
  influencers: (Omit<Numeros, 'links'> & { id: number; nombre: string; activo: boolean; admin: string; links: number })[]
  admins: (Omit<Numeros, 'links'> & { id: number; nombre: string; activo: boolean; influencers: number })[]
}
export type FilaLiq = {
  order_name: string; fecha: string; influencer: string; admin: string; modelo: string
  estado: 'pagado' | 'pendiente' | 'cancelado' | 'reembolsado'; unidades: number
  total_cliente: number; neto: number; com_inf: number; com_adm: number | null
  red: string | null; formato: string | null
}

export const REDES = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X' },
  { id: 'otra', label: 'Otra' },
]
export const FORMATOS = [
  { id: 'historia', label: 'Historia' },
  { id: 'post', label: 'Posteo' },
  { id: 'reel', label: 'Reel' },
  { id: 'video', label: 'Video' },
  { id: 'otro', label: 'Otro' },
]
export const labelRed = (id: string) => REDES.find((r) => r.id === id)?.label ?? id
export const labelFormato = (id: string) => FORMATOS.find((r) => r.id === id)?.label ?? id

export const linkPublico = (codigo: string) => `${BASE}/r/${codigo}`
export const linkPanel = (clave: string) => `${BASE}/colab?k=${clave}`

export const kAr = (n: number | null | undefined) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR')
export const kM = (n: number) =>
  Math.abs(n) >= 1_000_000 ? '$' + (n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M' : kAr(n)
export const nAr = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('es-AR')
export const mesCorto = (p: string) => {
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const [y, m] = p.split('-')
  return `${M[+m - 1]} ${y.slice(2)}`
}
export const mesLargo = (p: string) => {
  const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const [y, m] = p.split('-')
  return `${M[+m - 1]} ${y}`
}
export const periodoActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function copiar(txt: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(txt)
    return true
  } catch {
    const t = document.createElement('textarea')
    t.value = txt
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(t)
    return ok
  }
}

// ── Copies por anteojo ───────────────────────────────────────────────────────
// Salen de lo que la tienda ya publica (descripción, ficha, color) para que el
// influencer tenga data real del anteojo y no invente. Sin IA: plantillas.

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

export function partesColor(color: string | null) {
  const [armazon, lente] = (color ?? '').split('/').map((s) => s.trim())
  return { armazon: armazon || null, lente: lente || null }
}

function ficha(desc: string) {
  const campo = (k: string) => {
    const m = desc.match(new RegExp(`${k}:\\s*(.+?)(?=\\s*(?:Frente:|Varillas:|Medidas:|Fabricad|Garant|\\n|$))`, 'i'))
    return m ? m[1].trim().replace(/[.·]\s*$/, '') : null
  }
  return { frente: campo('Frente'), varillas: campo('Varillas'), medidas: campo('Medidas') }
}

function oracion(desc: string, re: RegExp) {
  const o = desc.split(/(?<=\.)\s+/).find((s) => re.test(s))
  return o ? o.trim() : null
}

export type Copies = {
  intro: string | null
  datos: string[]
  destacados: string[]
  historia: string
  posteo: string
  guion: string
  precio: number | null
  precioRef: number | null
  precioCodigo: number | null
}

export function copiesDe(m: Modelo, c: Color, pct: number, link?: string | null): Copies {
  const desc = (m.descripcion ?? '').replace(/\s+\n/g, '\n')
  const { armazon, lente } = partesColor(c.color)
  const esSol = (c.tipo ?? m.tipos[0]) === 'SOL'
  const f = ficha(desc)
  const plano = desc.replace(/\n/g, ' ')
  // intro = lo que describe el anteojo, sin la ficha técnica
  const cuerpo = plano.split(/Frente:|Medidas:/i)[0].trim()
  const oraciones = cuerpo.split(/(?<=\.)\s+/).filter((s) => s.length > 20)
  const intro = oraciones.slice(0, 2).join(' ') || null

  const destacados: string[] = []
  const material = f.frente || (/xylon/i.test(plano) ? 'Xylon®' : /acetato/i.test(plano) ? 'Acetato' : /nylon|pa12/i.test(plano) ? 'Nylon PA12' : null)
  if (/xylon/i.test(material ?? '')) destacados.push('Xylon® súper liviano y flexible')
  else if (material) destacados.push(material)
  if (lente && /polariz/i.test(lente)) destacados.push('lente polarizado (chau reflejos)')
  if (lente && /espej/i.test(lente)) destacados.push('lente espejado')
  if (lente && /antirref/i.test(lente)) destacados.push('lente antirreflex')
  if (esSol || /uv\s?400/i.test(plano)) destacados.push('protección UV400')
  if (/high definition/i.test(plano)) destacados.push('cristales High Definition')
  if (/altas? graduaci/i.test(plano)) destacados.push('admite receta de alta graduación')

  const datos: string[] = []
  datos.push(esSol ? 'Anteojo de sol' : 'Armazón para receta')
  if (m.linea) datos.push(`Línea ${m.linea === 'Hi end' ? 'Hi End' : m.linea}`)
  if (armazon) datos.push(`Armazón: ${armazon}`)
  if (lente) datos.push(`Lente: ${lente}`)
  if (f.frente) datos.push(`Frente: ${f.frente}`)
  if (f.varillas) datos.push(`Varillas: ${f.varillas}`)
  if (c.tratamiento && !/uv\s?400/i.test(c.tratamiento)) datos.push(`Tratamiento: ${c.tratamiento}`)
  if (esSol || /uv\s?400/i.test(plano)) datos.push('Protección UV400')
  if (/high definition/i.test(plano)) datos.push('Cristales base 2 High Definition')
  if (f.medidas) datos.push(`Medidas: ${f.medidas}`)
  const gar = oracion(plano, /garant/i)
  if (gar) datos.push(gar.replace(/\.$/, ''))
  const fab = oracion(plano, /fabricad/i)
  if (fab) datos.push(fab.replace(/\.$/, ''))

  const precio = c.price ?? null
  const precioRef = c.compare_at && c.price && c.compare_at > c.price ? c.compare_at : null
  const precioCodigo = precio ? Math.round(precio * (1 - pct / 100)) : null

  const nombre = titulo(m.modelo)
  const tag = m.modelo.replace(/[^A-Za-z0-9]/g, '')
  const donde = link ?? '👉 link en mi historia'
  const colorTxt = [armazon, lente && `lente ${lente.toLowerCase()}`].filter(Boolean).join(' con ')

  const historia = [
    `Mis ${nombre} de Orbital 🕶️`,
    colorTxt ? colorTxt.charAt(0).toUpperCase() + colorTxt.slice(1) : null,
    `${pct}% OFF exclusivo con mi link 👇`,
  ].filter(Boolean).join('\n')

  const posteo = [
    `${nombre}${colorTxt ? ` · ${colorTxt}` : ''} ✨`,
    intro,
    destacados.length ? `✔ ${destacados.slice(0, 4).join('\n✔ ')}` : null,
    `🎁 Con mi link tenés ${pct}% OFF extra sobre el precio de la web. Es un código único, solo para vos.`,
    donde,
    `#OrbitalEyewear #${tag} ${esSol ? '#AnteojosDeSol' : '#AnteojosDeReceta'} #HechoEnArgentina`,
  ].filter(Boolean).join('\n\n')

  const guion = [
    'Guion de 15 segundos (Reel / TikTok)',
    '0–3 s · Mostralo en la mano: "Miren lo que me llegó".',
    `3–8 s · Ponételo y mirá a cámara. Texto en pantalla: "${nombre}${lente ? ` · ${lente}` : ''}".`,
    `8–12 s · Detalle de cerca${destacados.length ? `: ${destacados.slice(0, 2).join(' + ')}` : ''}.`,
    `12–15 s · Cierre: "${pct}% OFF con mi link, es un código único". Sumá el sticker de enlace.`,
  ].join('\n')

  return { intro, datos, destacados, historia, posteo, guion, precio, precioRef, precioCodigo }
}
