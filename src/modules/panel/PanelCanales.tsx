// ── PANEL DE CANALES (maqueta con DATOS DE EJEMPLO) ─────────────────────────
// Vista única de los canales de Orbital: campañas, integraciones, publicaciones
// en Shopify y Mercado Libre, ventas y los parámetros que gobiernan cada canal.
//
// ⚠️ TODO lo que se muestra sale de la constante DEMO de más abajo. No hay una
// sola consulta a la base: es una maqueta para acordar QUÉ mirar antes de
// cablear los datos. Cuando se apruebe el layout, cada bloque de DEMO se
// reemplaza por su fuente real (anotada en el comentario de cada bloque).
import { useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts'
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, TrendingUp, TrendingDown,
  Table2, BarChart3, Store, ShoppingBag, Building2, ExternalLink, Camera, Music2,
} from 'lucide-react'

// ── Paleta de series (validada para daltonismo, ΔE CVD 9.2 / normal 24.0) ────
// Un color por canal, siempre el mismo canal el mismo color en todo el panel.
const CANAL = {
  b2b: { label: 'B2B mayorista', color: '#2a78d6', icon: Building2 },
  shopify: { label: 'Shopify', color: '#eb6834', icon: ShoppingBag },
  ml: { label: 'Mercado Libre', color: '#1baf7a', icon: Store },
} as const
type CanalKey = keyof typeof CANAL

// Estados: color reservado + SIEMPRE ícono y texto, nunca color solo.
const ESTADO = {
  ok: { color: '#0ca30c', icon: CheckCircle2, label: 'OK' },
  atencion: { color: '#fab219', icon: AlertTriangle, label: 'Atención' },
  demora: { color: '#ec835a', icon: Clock, label: 'Demorado' },
  error: { color: '#d03b3b', icon: XCircle, label: 'Error' },
} as const
type EstadoKey = keyof typeof ESTADO

const SUP = '#ffffff' // color de superficie: los 2px de separación entre marcas

// Redes donde publica ZN.
const RED = {
  ig: { label: 'Instagram', icon: Camera },
  tk: { label: 'TikTok', icon: Music2 },
} as const
type RedKey = keyof typeof RED

// Orgánico vs paga se dibuja por ÉNFASIS, no con dos colores de igual peso:
// el orgánico es el sujeto del estudio, la paga es el punto de comparación.
const ORG = '#4a3aa7'   // acento (violeta de la paleta categórica)
const PAGA = '#8d8a82'  // gris de segundo plano

const arsM = (n: number) => '$' + (n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M'
const ent = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
const pct = (n: number) => (n > 0 ? '+' : '') + n.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%'

// ════════════════════════════════════════════════════════════════════════════
// DATOS DE EJEMPLO — reemplazar bloque por bloque cuando se apruebe el layout
// ════════════════════════════════════════════════════════════════════════════
const DEMO = {
  // → real: v_ventas_cartera_mes + v_ventas_ecom_mes + ventas_ml
  ventas: [
    { mes: 'abr 26', b2b: 168_400_000, shopify: 21_300_000, ml: 6_900_000 },
    { mes: 'may 26', b2b: 181_200_000, shopify: 24_800_000, ml: 8_400_000 },
    { mes: 'jun 26', b2b: 174_900_000, shopify: 26_100_000, ml: 9_700_000 },
    { mes: 'jul 26', b2b: 196_500_000, shopify: 29_400_000, ml: 12_600_000 },
    { mes: 'ago 26', b2b: 208_700_000, shopify: 31_900_000, ml: 15_200_000 },
    { mes: 'sep 26', b2b: 92_300_000, shopify: 14_100_000, ml: 7_800_000 },
  ],
  // → real: RPC de KPIs del mes en curso vs mes anterior
  kpis: [
    { k: 'Facturación del mes', v: arsM(114_200_000), d: 12.4, spark: [168, 181, 175, 197, 209, 114], nota: 'sep 26 en curso · 3 de 22 días' },
    { k: 'Unidades', v: ent(4_180), d: 8.1, spark: [6100, 6600, 6300, 7200, 7600, 4180], nota: 'solo producto, sin insumos' },
    { k: 'Ticket promedio', v: '$27.320', d: -3.2, spark: [28, 29, 28, 27.6, 27.9, 27.3], nota: 'ARS neto sin IVA' },
    { k: 'ROAS general', v: '4,2x', d: 18.6, spark: [3.1, 3.4, 3.2, 3.7, 3.9, 4.2], nota: 'inversión paga / venta atribuida' },
  ],
  // → real: tabla de campañas + insights de Meta/Google/ML Ads
  campanas: [
    { nombre: 'Triple Protección · prospecting', canal: 'shopify' as CanalKey, estado: 'ok' as EstadoKey, inv: 2_400_000, alcance: 412_000, clicks: 9_840, conv: 214, roas: 5.1, meta: 4 },
    { nombre: 'Lead Ads ópticas B2B', canal: 'b2b' as CanalKey, estado: 'ok' as EstadoKey, inv: 1_150_000, alcance: 186_000, clicks: 4_120, conv: 138, roas: 6.8, meta: 4 },
    { nombre: 'Product Ads · pantallas', canal: 'ml' as CanalKey, estado: 'atencion' as EstadoKey, inv: 780_000, alcance: 94_000, clicks: 3_260, conv: 71, roas: 2.9, meta: 4 },
    { nombre: 'Remarketing carrito 7d', canal: 'shopify' as CanalKey, estado: 'ok' as EstadoKey, inv: 460_000, alcance: 38_000, clicks: 2_910, conv: 96, roas: 8.4, meta: 4 },
    { nombre: 'Catálogo B2B · reactivación', canal: 'b2b' as CanalKey, estado: 'demora' as EstadoKey, inv: 320_000, alcance: 21_000, clicks: 640, conv: 12, roas: 1.6, meta: 4 },
  ],
  // → real: shopify_productos / ml_publicables (motivo_bloqueo)
  publicaciones: {
    shopify: { total: 486, activas: 391, pausadas: 34, sinStock: 41, bloqueadas: 20 },
    ml: { total: 214, activas: 113, pausadas: 40, sinStock: 26, bloqueadas: 35 },
  },
  // → real: ml_publicables.motivo_bloqueo agrupado
  bloqueos: [
    { motivo: 'Sin foto de producto', shopify: 12, ml: 23 },
    { motivo: 'Stock por debajo del mínimo', shopify: 6, ml: 9 },
    { motivo: 'Precio bajo el piso', shopify: 2, ml: 0 },
    { motivo: 'Línea ZN excluida del canal', shopify: 0, ml: 3 },
  ],
  // → real: shopify_stores / ml_cuentas / crons de pg_cron
  integraciones: [
    { app: 'Shopify · orbitaluniverse', estado: 'ok' as EstadoKey, sync: 'hace 6 min', detalle: 'shopify-import cada 15 min · 0 errores', pend: 0 },
    { app: 'Mercado Libre · ORBITALEYEWEAR', estado: 'ok' as EstadoKey, sync: 'hace 12 min', detalle: 'ml-sync cada 30 min · 1 escritura', pend: 0 },
    { app: 'Meta Lead Ads', estado: 'ok' as EstadoKey, sync: 'hace 41 min', detalle: 'webhook-meta-leads · 4 leads hoy', pend: 4 },
    { app: 'Tango · Novedades para pedidos', estado: 'atencion' as EstadoKey, sync: 'hace 3 días', detalle: 'export manual, no automático', pend: 18 },
    { app: 'Bot IRIS · WhatsApp', estado: 'ok' as EstadoKey, sync: 'hace 2 min', detalle: '31 conversaciones abiertas', pend: 7 },
    { app: 'Token Mercado Libre', estado: 'demora' as EstadoKey, sync: 'vence en 1h 40m', detalle: 'refresh de un solo uso · rota solo', pend: 0 },
  ],
  // → real: ml_config + app_config
  parametros: [
    { p: 'Precio piso ML', v: '$79.000', nota: 'inclusive · debajo no publica' },
    { p: 'Stock mínimo ML', v: '> 10 u', nota: 'exclusivo' },
    { p: 'Stock publicado máx.', v: '20 u', nota: 'no expone el stock real' },
    { p: 'Reponer cuando ML baja a', v: '2 u', nota: 'evita reescribir en cada corrida' },
    { p: 'Buffer anti-sobreventa', v: '2 u', nota: 'colchón entre los 3 canales' },
    { p: 'Sincroniza precio a ML', v: 'No', nota: 'precio ML se maneja a mano' },
    { p: 'Modo lectura ml-sync', v: 'No', nota: 'escribe en producción' },
    { p: 'Línea ZN en ML', v: 'Excluida', nota: '8 modelos · 25 SKU' },
  ],
  // ── ORGÁNICO ZN ───────────────────────────────────────────────────────────
  // Cada posteo de Zaira necesita DOS links: el de la publicación (para verla y
  // medirla en la red) y el de derivación a la tienda, siempre con UTM, porque
  // sin UTM la venta entra como "directo" y el posteo no se puede acreditar.
  // → real: tabla nueva `zn_posts` + sesiones/pedidos por utm_content (Shopify) y
  //   visitas/ventas por publicación (ML)
  organicoZN: [
    { fecha: '01/09', red: 'ig' as RedKey, tipo: 'Reel', modelo: 'ADELAIDA', destino: 'shopify' as CanalKey,
      pub: 'https://instagram.com/reel/EJEMPLO-zn-01', der: 'orbitaleyewear.com.ar/products/adelaida?utm_source=ig_zn…',
      alcance: 412_000, clicks: 9_240, pedidos: 386, ventas: 6_820_000, dev: 310_000 },
    { fecha: '29/08', red: 'ig' as RedKey, tipo: 'Historia', modelo: '5TH AVENUE', destino: 'shopify' as CanalKey,
      pub: 'https://instagram.com/stories/EJEMPLO-zn-02', der: 'orbitaleyewear.com.ar/products/5th-avenue?utm_source=ig_zn…',
      alcance: 168_000, clicks: 4_110, pedidos: 142, ventas: 2_940_000, dev: 96_000 },
    { fecha: '26/08', red: 'tk' as RedKey, tipo: 'Video', modelo: 'BUENOS AIRES I', destino: 'ml' as CanalKey,
      pub: 'https://tiktok.com/@zn/video/EJEMPLO-03', der: 'articulo.mercadolibre.com.ar/MLA-EJEMPLO-buenos-aires',
      alcance: 286_000, clicks: 6_380, pedidos: 171, ventas: 3_610_000, dev: 0 },
    { fecha: '22/08', red: 'ig' as RedKey, tipo: 'Post', modelo: 'CENTRAL PARK', destino: 'shopify' as CanalKey,
      pub: 'https://instagram.com/p/EJEMPLO-zn-04', der: 'orbitaleyewear.com.ar/products/central-park?utm_source=ig_zn…',
      alcance: 124_000, clicks: 2_640, pedidos: 88, ventas: 1_490_000, dev: 74_000 },
    { fecha: '18/08', red: 'tk' as RedKey, tipo: 'Video', modelo: 'WYNWOOD', destino: 'ml' as CanalKey,
      pub: 'https://tiktok.com/@zn/video/EJEMPLO-05', der: 'articulo.mercadolibre.com.ar/MLA-EJEMPLO-wynwood',
      alcance: 96_000, clicks: 1_730, pedidos: 47, ventas: 980_000, dev: 0 },
    { fecha: '14/08', red: 'ig' as RedKey, tipo: 'Reel', modelo: 'LONDRES', destino: 'shopify' as CanalKey,
      pub: 'https://instagram.com/reel/EJEMPLO-zn-06', der: 'orbitaleyewear.com.ar/products/londres?utm_source=ig_zn…',
      alcance: 74_000, clicks: 1_180, pedidos: 29, ventas: 560_000, dev: 28_000 },
  ],
  // Base de la liquidación de ZN: 10% sobre la venta NETA atribuida.
  // Es el número que se acuerda con ella, así que la definición tiene que estar
  // escrita y ser reproducible fila por fila.
  // → real: pedidos con utm_source=ig_zn/tk_zn dentro de la ventana de atribución,
  //   menos devoluciones y cancelados, neto sin IVA
  liquidacionZN: {
    periodo: 'agosto 2026',
    pct: 10,
    ventana: '7 días desde el click',
    estado: 'A liquidar' as const,
  },
  // Comparación orgánico vs paga. ROAS NO entra: el orgánico no tiene costo de
  // medios, así que dividir por cero infla cualquier lectura. Se comparan las
  // métricas que sí miden lo mismo en las dos fuentes.
  // → real: sesiones/pedidos por utm_source en Shopify + insights de Meta
  vsPaga: {
    inversionPaga: 4_300_000,
    metricas: [
      { m: 'Ventas atribuidas', org: 16_400_000, paga: 12_900_000, fmt: 'ars' as const },
      { m: 'Clicks al link', org: 25_280, paga: 16_870, fmt: 'ent' as const },
      { m: 'Conversión click → pedido', org: 3.4, paga: 1.9, fmt: 'pct' as const },
      { m: 'Venta por cada 1.000 impresiones', org: 14_300, paga: 9_800, fmt: 'ars0' as const },
    ],
  },
  // → real: ventas_hist_modelo + ventas_shopify_hist + ventas_ml
  topModelos: [
    { modelo: 'LONG BEACH', b2b: 412, shopify: 186, ml: 143 },
    { modelo: 'ADELAIDA', b2b: 388, shopify: 121, ml: 42 },
    { modelo: '5TH AVENUE', b2b: 296, shopify: 164, ml: 88 },
    { modelo: 'ROMA', b2b: 271, shopify: 74, ml: 119 },
    { modelo: 'CENTRAL PARK', b2b: 244, shopify: 96, ml: 37 },
  ],
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function BannerDemo() {
  return (
    <div className="rounded-xl border border-dashed border-black/25 bg-[#F7F5F0] px-4 py-3 flex items-start gap-3">
      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-muted" />
      <div className="text-[12px] leading-snug">
        <b>Maqueta con datos de ejemplo.</b> Ningún número de esta pantalla es real: salen de una
        constante en el código, no de la base. Sirve para acordar qué se mira y cómo, antes de
        cablear las fuentes. Cada bloque tiene anotada su fuente real.
      </div>
    </div>
  )
}

// Sparkline: 2px, sin ejes ni grilla — es contexto del número, no un gráfico.
function Spark({ datos, color }: { datos: number[]; color: string }) {
  const min = Math.min(...datos), max = Math.max(...datos)
  const rango = max - min || 1
  const pts = datos.map((v, i) => `${(i / (datos.length - 1)) * 100},${28 - ((v - min) / rango) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-7" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function KpiTile({ k, v, d, spark, nota }: typeof DEMO.kpis[number]) {
  const sube = d >= 0
  const Icono = sube ? TrendingUp : TrendingDown
  return (
    <div className="bg-white rounded-xl p-3 border border-black/10">
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="flex items-end justify-between gap-2 mt-0.5">
        <div className="text-[22px] font-bold leading-none text-ink">{v}</div>
        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold"
          style={{ color: sube ? ESTADO.ok.color : ESTADO.error.color }}>
          <Icono size={12} />{pct(d)}
        </span>
      </div>
      <Spark datos={spark} color={sube ? ESTADO.ok.color : ESTADO.error.color} />
      <div className="text-[10px] text-faint leading-snug">{nota}</div>
    </div>
  )
}

function Leyenda() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {(Object.keys(CANAL) as CanalKey[]).map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CANAL[c].color }} />
          {CANAL[c].label}
        </span>
      ))}
    </div>
  )
}

// Ventas por canal: columnas APILADAS. Agrupadas no sirve acá — B2B es un orden
// de magnitud más grande y deja a Shopify y ML como rayitas ilegibles. Apilado
// muestra el total (altura) y la mezcla (tramos) sin perder los canales chicos.
// El total va etiquetado arriba de cada columna; la vista de tabla da los
// números exactos y cubre el aviso de contraste del verde sobre fondo claro.
function VentasCanal() {
  const [vista, setVista] = useState<'grafico' | 'tabla'>('grafico')
  const total = (r: typeof DEMO.ventas[number]) => r.b2b + r.shopify + r.ml
  const datos = DEMO.ventas.map((r) => ({ ...r, total: total(r) }))
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[13px] font-bold text-ink">Ventas por canal</h2>
          <p className="text-[11px] text-muted">Facturación mensual en pesos, neto sin IVA. Septiembre en curso.</p>
        </div>
        <div className="flex bg-[#F1EDE4] rounded-lg p-0.5 shrink-0">
          {([['grafico', BarChart3], ['tabla', Table2]] as const).map(([v, Ic]) => (
            <button key={v} onClick={() => setVista(v)} aria-label={v}
              className={`px-2.5 py-1 rounded-md ${vista === v ? 'bg-brand text-white' : 'text-muted'}`}>
              <Ic size={13} />
            </button>
          ))}
        </div>
      </div>

      {vista === 'grafico' ? (
        <>
          {/* Leyenda propia: la de recharts reordena las series en el apilado y
              dejaba de coincidir con el orden de los tramos. */}
          <div className="mb-2"><Leyenda /></div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datos} margin={{ top: 18, right: 4, left: -18, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6E6A61' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => (v ? v / 1_000_000 + 'M' : '0')} tick={{ fontSize: 10, fill: '#9B968B' }}
                  axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  formatter={(v, n) => [arsM(Number(v) || 0), CANAL[n as CanalKey]?.label ?? String(n)]}
                  contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)' }} />
                {/* El stroke del color de la superficie ES la separación de 2px entre tramos. */}
                {(Object.keys(CANAL) as CanalKey[]).map((c, i, arr) => (
                  <Bar key={c} dataKey={c} stackId="v" fill={CANAL[c].color} maxBarSize={34}
                    stroke={SUP} strokeWidth={2}
                    radius={i === arr.length - 1 ? [4, 4, 0, 0] : undefined}>
                    {i === arr.length - 1 && (
                      <LabelList dataKey="total" position="top" offset={8}
                        formatter={(v: unknown) => arsM(Number(v) || 0)}
                        style={{ fontSize: 10, fill: '#17171C', fontWeight: 700 }} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-faint mt-1">
            El número arriba de cada columna es el total del mes. Pasá el mouse para ver canal por canal;
            el ícono de tabla muestra los mismos números en texto.
          </p>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted border-b border-black/10">
                <th className="py-1.5 font-medium">Mes</th>
                {(Object.keys(CANAL) as CanalKey[]).map((c) => (
                  <th key={c} className="py-1.5 font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ background: CANAL[c].color }} />{CANAL[c].label}
                    </span>
                  </th>
                ))}
                <th className="py-1.5 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {DEMO.ventas.map((r) => (
                <tr key={r.mes} className="border-b border-black/5">
                  <td className="py-1.5">{r.mes}</td>
                  <td className="py-1.5 text-right tabular-nums">{arsM(r.b2b)}</td>
                  <td className="py-1.5 text-right tabular-nums">{arsM(r.shopify)}</td>
                  <td className="py-1.5 text-right tabular-nums">{arsM(r.ml)}</td>
                  <td className="py-1.5 text-right tabular-nums font-bold">{arsM(total(r))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Publicaciones: parte-sobre-total por estado. Barra apilada en HTML para tener
// los 2px de separación reales y el número escrito al lado de cada tramo.
const TRAMOS = [
  { k: 'activas' as const, label: 'Activas', color: ESTADO.ok.color },
  { k: 'pausadas' as const, label: 'Pausadas', color: ESTADO.atencion.color },
  { k: 'sinStock' as const, label: 'Sin stock', color: ESTADO.demora.color },
  { k: 'bloqueadas' as const, label: 'Bloqueadas', color: ESTADO.error.color },
]

function BarraPublicaciones({ d }: { d: typeof DEMO.publicaciones.shopify }) {
  return (
    <>
      <div className="flex gap-[2px] h-4 rounded-md overflow-hidden mt-2" style={{ background: SUP }}>
        {TRAMOS.map((t) => (
          <div key={t.k} style={{ background: t.color, width: `${(d[t.k] / d.total) * 100}%` }}
            title={`${t.label}: ${d[t.k]}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
        {TRAMOS.map((t) => (
          <div key={t.k} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: t.color }} />
            <span className="text-muted flex-1">{t.label}</span>
            <b className="tabular-nums text-ink">{d[t.k]}</b>
          </div>
        ))}
      </div>
    </>
  )
}

function Publicaciones() {
  const canales: { c: CanalKey; d: typeof DEMO.publicaciones.shopify }[] = [
    { c: 'shopify', d: DEMO.publicaciones.shopify },
    { c: 'ml', d: DEMO.publicaciones.ml },
  ]
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Productos publicados</h2>
      <p className="text-[11px] text-muted mb-3">Estado de las publicaciones en cada canal y por qué no se publican las demás.</p>

      <div className="grid gap-4 md:grid-cols-2">
        {canales.map(({ c, d }) => {
          const Ic = CANAL[c].icon
          return (
            <div key={c} className="rounded-lg border border-black/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ink">
                  <Ic size={14} style={{ color: CANAL[c].color }} />{CANAL[c].label}
                </span>
                <span className="text-[11px] text-muted"><b className="text-ink">{d.total}</b> SKU</span>
              </div>
              <BarraPublicaciones d={d} />
            </div>
          )
        })}
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Motivo de bloqueo</div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted border-b border-black/10">
              <th className="py-1.5 font-medium">Motivo</th>
              <th className="py-1.5 font-medium text-right">Shopify</th>
              <th className="py-1.5 font-medium text-right">Mercado Libre</th>
            </tr>
          </thead>
          <tbody>
            {DEMO.bloqueos.map((b) => (
              <tr key={b.motivo} className="border-b border-black/5">
                <td className="py-1.5">{b.motivo}</td>
                <td className="py-1.5 text-right tabular-nums">{b.shopify || '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{b.ml || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Medidor de ROAS contra el objetivo: una razón contra un límite.
function MedidorRoas({ roas, meta }: { roas: number; meta: number }) {
  const llena = Math.min(1, roas / (meta * 2))
  const color = roas >= meta ? ESTADO.ok.color : roas >= meta * 0.7 ? ESTADO.atencion.color : ESTADO.error.color
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="tabular-nums font-bold" style={{ color }}>{roas.toLocaleString('es-AR', { minimumFractionDigits: 1 })}x</span>
      <span className="relative w-14 h-1.5 rounded-full bg-black/10 overflow-hidden shrink-0">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ background: color, width: `${llena * 100}%` }} />
        <span className="absolute inset-y-0 w-[2px] bg-ink/50" style={{ left: '50%' }} title={`Objetivo ${meta}x`} />
      </span>
    </div>
  )
}

function Campanas() {
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Campañas activas</h2>
      <p className="text-[11px] text-muted mb-3">
        La marca en el medidor es el objetivo de ROAS ({DEMO.campanas[0].meta}x). Verde llega, amarillo cerca, rojo no llega.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted border-b border-black/10">
              <th className="py-1.5 font-medium">Campaña</th>
              <th className="py-1.5 font-medium">Canal</th>
              <th className="py-1.5 font-medium">Estado</th>
              <th className="py-1.5 font-medium text-right">Inversión</th>
              <th className="py-1.5 font-medium text-right">Alcance</th>
              <th className="py-1.5 font-medium text-right">Clicks</th>
              <th className="py-1.5 font-medium text-right">Conv.</th>
              <th className="py-1.5 font-medium text-right">CPA</th>
              <th className="py-1.5 font-medium text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {DEMO.campanas.map((c) => {
              const E = ESTADO[c.estado], Ie = E.icon
              return (
                <tr key={c.nombre} className="border-b border-black/5">
                  <td className="py-1.5 font-medium text-ink">{c.nombre}</td>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1 text-muted">
                      <span className="w-2 h-2 rounded-sm" style={{ background: CANAL[c.canal].color }} />
                      {CANAL[c.canal].label}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1" style={{ color: E.color }}>
                      <Ie size={12} /><span className="text-ink">{E.label}</span>
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{arsM(c.inv)}</td>
                  <td className="py-1.5 text-right tabular-nums">{ent(c.alcance)}</td>
                  <td className="py-1.5 text-right tabular-nums">{ent(c.clicks)}</td>
                  <td className="py-1.5 text-right tabular-nums">{ent(c.conv)}</td>
                  <td className="py-1.5 text-right tabular-nums">${ent(Math.round(c.inv / c.conv))}</td>
                  <td className="py-1.5"><MedidorRoas roas={c.roas} meta={c.meta} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Integraciones() {
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Aplicaciones e integraciones</h2>
      <p className="text-[11px] text-muted mb-3">Qué está conectado, cuándo sincronizó por última vez y qué quedó pendiente.</p>
      <div className="divide-y divide-black/5">
        {DEMO.integraciones.map((i) => {
          const E = ESTADO[i.estado], Ie = E.icon
          return (
            <div key={i.app} className="py-2 flex items-center gap-3">
              <Ie size={15} className="shrink-0" style={{ color: E.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-ink truncate">{i.app}</div>
                <div className="text-[10px] text-muted truncate">{i.detalle}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] text-ink">{E.label}</div>
                <div className="text-[10px] text-faint">{i.sync}</div>
              </div>
              {i.pend > 0 && (
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold text-ink tabular-nums">
                  {i.pend} pend.
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Orgánico vs paga: small multiples. Un mini gráfico por métrica, cada uno con
// SU escala — meter pesos y porcentajes en un mismo eje sería mentir.
function VsPaga() {
  const fmt = (v: number, f: 'ars' | 'ars0' | 'ent' | 'pct') =>
    f === 'ars' ? arsM(v) : f === 'ars0' ? '$' + ent(v) : f === 'pct' ? v.toLocaleString('es-AR', { minimumFractionDigits: 1 }) + '%' : ent(v)
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Orgánico de ZN vs pauta de Meta</h2>
      <p className="text-[11px] text-muted">
        El orgánico <b>no tiene costo de medios</b>, así que no se puede comparar por ROAS (dividir por cero infla
        cualquier lectura). Estas cuatro métricas sí miden lo mismo en las dos fuentes.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ORG }} />Orgánico ZN
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PAGA }} />Meta paga · {arsM(DEMO.vsPaga.inversionPaga)} invertidos
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {DEMO.vsPaga.metricas.map((x) => {
          const max = Math.max(x.org, x.paga)
          const gana = x.org > x.paga
          return (
            <div key={x.m} className="rounded-lg border border-black/10 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted leading-tight">{x.m}</span>
                <span className="text-[10px] font-bold shrink-0" style={{ color: gana ? ORG : PAGA }}>
                  {gana ? 'gana orgánico' : 'gana paga'} · {((Math.max(x.org, x.paga) / Math.min(x.org, x.paga) - 1) * 100).toFixed(0)}%
                </span>
              </div>
              {([['Orgánico ZN', x.org, ORG], ['Meta paga', x.paga, PAGA]] as const).map(([lbl, v, col]) => (
                <div key={lbl} className="mt-1.5">
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-muted">{lbl}</span>
                    <b className="tabular-nums text-ink">{fmt(v, x.fmt)}</b>
                  </div>
                  <div className="h-2.5 rounded-r-[4px]" style={{ background: col, width: `${(v / max) * 100}%` }} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Posteos de ZN: la pieza clave es que cada fila tenga los DOS links —
// la publicación y la derivación con UTM.
const L = DEMO.liquidacionZN

function OrganicoZN() {
  const t = DEMO.organicoZN.reduce((a, p) => ({
    alcance: a.alcance + p.alcance, clicks: a.clicks + p.clicks,
    pedidos: a.pedidos + p.pedidos, ventas: a.ventas + p.ventas, dev: a.dev + p.dev,
  }), { alcance: 0, clicks: 0, pedidos: 0, ventas: 0, dev: 0 })
  const neta = t.ventas - t.dev
  const comision = neta * (L.pct / 100)
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[13px] font-bold text-ink">Publicaciones orgánicas de ZN</h2>
          <p className="text-[11px] text-muted">
            Cada posteo con su link de publicación, su link de derivación y la venta que generó.
            Esta tabla <b>es la base de la liquidación</b>.
          </p>
        </div>
        <div className="flex gap-4 text-[11px] shrink-0">
          {[['Alcance', ent(t.alcance)], ['Clicks', ent(t.clicks)], ['Pedidos', ent(t.pedidos)], ['Venta neta', arsM(neta)]].map(([k, v]) => (
            <div key={k}>
              <div className="text-[9px] uppercase tracking-wide text-faint">{k}</div>
              <div className="font-bold text-ink tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Liquidación: el número que se acuerda con Zaira ── */}
      <div className="mt-3 rounded-xl p-3 md:p-4 text-white" style={{ background: ORG }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">
              Liquidación ZN · {L.periodo} · {L.pct}% sobre la venta neta
            </div>
            <div className="text-[34px] font-bold leading-none mt-1">{arsM(comision)}</div>
            <div className="text-[11px] opacity-80 mt-0.5">{L.estado}</div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
            {[
              ['Venta bruta atribuida', arsM(t.ventas)],
              ['− Devoluciones y cancelados', '−' + arsM(t.dev)],
              ['= Base neta', arsM(neta)],
              [`× ${L.pct}%`, arsM(comision)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wide opacity-60">{k}</div>
                <div className="font-bold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[10px] opacity-80 mt-3 pt-2 border-t border-white/20 leading-relaxed">
          <b>Cómo se calcula la base neta:</b> pedidos con el UTM de ZN dentro de la ventana de atribución
          ({L.ventana}), a precio neto <b>sin IVA</b> y <b>sin el envío</b>, menos devoluciones y pedidos
          cancelados del período. Cada fila de abajo muestra su propio aporte, así el total se puede
          reconstruir posteo por posteo.
        </div>
      </div>

      {/* 15 columnas: en pantalla angosta la tabla scrollea, no se apiña. */}
      <div className="overflow-x-auto mt-3">
        <table className="w-full min-w-[940px] text-[11px]">
          <thead>
            <tr className="text-left text-muted border-b border-black/10">
              <th className="py-1.5 font-medium">Fecha</th>
              <th className="py-1.5 font-medium">Red</th>
              <th className="py-1.5 font-medium">Pieza</th>
              <th className="py-1.5 font-medium">Modelo</th>
              <th className="py-1.5 font-medium">Publicación</th>
              <th className="py-1.5 font-medium">Deriva a</th>
              <th className="py-1.5 font-medium text-right">Alcance</th>
              <th className="py-1.5 font-medium text-right">Clicks</th>
              <th className="py-1.5 font-medium text-right">Pedidos</th>
              <th className="py-1.5 font-medium text-right">Conv.</th>
              <th className="py-1.5 font-medium text-right">Venta bruta</th>
              <th className="py-1.5 font-medium text-right">Devol.</th>
              <th className="py-1.5 font-medium text-right">Venta neta</th>
              <th className="py-1.5 font-medium text-right" style={{ color: ORG }}>{L.pct}% ZN</th>
            </tr>
          </thead>
          <tbody>
            {DEMO.organicoZN.map((p) => {
              const Ir = RED[p.red].icon
              const Ic = CANAL[p.destino].icon
              return (
                <tr key={p.pub} className="border-b border-black/5">
                  <td className="py-1.5 tabular-nums">{p.fecha}</td>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1 text-muted"><Ir size={12} />{RED[p.red].label}</span>
                  </td>
                  <td className="py-1.5">{p.tipo}</td>
                  <td className="py-1.5 font-medium text-ink">{p.modelo}</td>
                  <td className="py-1.5">
                    <a href={p.pub} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline decoration-black/20 hover:decoration-ink">
                      Ver posteo <ExternalLink size={10} />
                    </a>
                  </td>
                  <td className="py-1.5">
                    <a href={'https://' + p.der.replace('…', '')} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline decoration-black/20 hover:decoration-ink"
                      title={p.der}>
                      <Ic size={12} style={{ color: CANAL[p.destino].color }} />
                      {p.destino === 'ml' ? 'Mercado Libre' : 'Shopify'} <ExternalLink size={10} />
                    </a>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{ent(p.alcance)}</td>
                  <td className="py-1.5 text-right tabular-nums">{ent(p.clicks)}</td>
                  <td className="py-1.5 text-right tabular-nums">{ent(p.pedidos)}</td>
                  <td className="py-1.5 text-right tabular-nums">{((p.pedidos / p.clicks) * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-right tabular-nums">{arsM(p.ventas)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{p.dev ? '−' + arsM(p.dev) : '—'}</td>
                  <td className="py-1.5 text-right tabular-nums font-bold text-ink">{arsM(p.ventas - p.dev)}</td>
                  <td className="py-1.5 text-right tabular-nums font-bold" style={{ color: ORG }}>
                    {arsM((p.ventas - p.dev) * (L.pct / 100))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-lg bg-[#F7F5F0] p-3 text-[10px] leading-relaxed text-muted">
        <b className="text-ink">Para que esto se pueda medir</b>, el link de derivación tiene que llevar UTM siempre.
        Convención propuesta:
        <code className="block mt-1 text-[10px] text-ink break-all">
          ?utm_source=ig_zn &nbsp;·&nbsp; utm_medium=organic &nbsp;·&nbsp; utm_campaign=zn_cobranding &nbsp;·&nbsp; utm_content=&lt;id del posteo&gt;
        </code>
        <span className="block mt-1">
          Sin UTM la venta entra como “directo” y el posteo no se puede acreditar. En Mercado Libre no van UTM:
          el link sale del <b>Programa de Colaboradores</b>, que atribuye por sí mismo si el artículo convirtió o no.
        </span>
      </div>
    </div>
  )
}

function TopModelos() {
  const max = Math.max(...DEMO.topModelos.map((m) => m.b2b + m.shopify + m.ml))
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Modelos más vendidos</h2>
      <p className="text-[11px] text-muted mb-1">Unidades del mes, apiladas por canal.</p>
      <div className="mb-3"><Leyenda /></div>
      <div className="space-y-2.5">
        {DEMO.topModelos.map((m) => {
          const t = m.b2b + m.shopify + m.ml
          return (
            <div key={m.modelo}>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="font-medium text-ink">{m.modelo}</span>
                <span className="tabular-nums text-muted">{ent(t)} u</span>
              </div>
              <div className="flex gap-[2px] h-3" style={{ width: `${(t / max) * 100}%`, background: SUP }}>
                {(Object.keys(CANAL) as CanalKey[]).map((c, i, arr) => (
                  <div key={c} style={{
                    background: CANAL[c].color,
                    width: `${(m[c] / t) * 100}%`,
                    borderRadius: i === arr.length - 1 ? '0 4px 4px 0' : i === 0 ? '4px 0 0 4px' : 0,
                  }} title={`${CANAL[c].label}: ${m[c]} u`} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Parametros() {
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <h2 className="text-[13px] font-bold text-ink">Parámetros de los canales</h2>
      <p className="text-[11px] text-muted mb-3">
        Las reglas que deciden qué se publica y con cuánto stock. Se editan sin tocar código.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO.parametros.map((p) => (
          <div key={p.p} className="rounded-lg bg-[#F7F5F0] p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted leading-tight">{p.p}</div>
            <div className="text-[15px] font-bold text-ink leading-tight mt-0.5">{p.v}</div>
            <div className="text-[10px] text-faint leading-snug">{p.nota}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Panel ───────────────────────────────────────────────────────────────────
export default function PanelCanales() {
  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-[16px] font-bold text-ink">Panel de canales</h1>
        <p className="text-[11px] text-muted">B2B mayorista · Shopify · Mercado Libre en una sola pantalla.</p>
      </div>

      <BannerDemo />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {DEMO.kpis.map((k) => <KpiTile key={k.k} {...k} />)}
      </div>

      <VentasCanal />

      {/* El orgánico de ZN va arriba de la pauta: es la hipótesis a probar. */}
      <VsPaga />
      <OrganicoZN />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Publicaciones />
        <Integraciones />
      </div>

      <Campanas />

      <div className="grid gap-4 lg:grid-cols-2">
        <TopModelos />
        <Parametros />
      </div>
    </div>
  )
}
