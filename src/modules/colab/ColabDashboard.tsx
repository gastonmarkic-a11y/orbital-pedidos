// ── Dashboard de colaboradores (mismo diseño que el de ZN) ────────────────────
// Un solo componente para los tres niveles, con lo que corresponde a cada uno:
//   influencer → su 15%, sus links/posteos y qué anteojos rinden
//   admin      → su 5% + el ranking de sus promotores
//   orbital    → venta total, las dos comisiones y el ranking de administradores
// Mientras no haya clicks se muestra un ejemplo CON cartel; con el primero, lo real.
import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, CANALES, Resumen, Rol, FilaLiq, kAr, kM, nAr, mesCorto, mesLargo, labelRed, labelFormato, periodoActual } from './colabUtil'

const EJEMPLO: Resumen = {
  rol: 'influencer', hay_datos: false,
  serie: [
    { periodo: '2026-04', clicks: 820, pedidos: 14, pendientes: 1, neto: 1_540_000, com_inf: 231_000, com_adm: 77_000 },
    { periodo: '2026-05', clicks: 1_140, pedidos: 21, pendientes: 2, neto: 2_310_000, com_inf: 346_500, com_adm: 115_500 },
    { periodo: '2026-06', clicks: 990, pedidos: 17, pendientes: 0, neto: 1_870_000, com_inf: 280_500, com_adm: 93_500 },
    { periodo: '2026-07', clicks: 1_560, pedidos: 29, pendientes: 3, neto: 3_190_000, com_inf: 478_500, com_adm: 159_500 },
    { periodo: '2026-08', clicks: 1_930, pedidos: 36, pendientes: 2, neto: 3_960_000, com_inf: 594_000, com_adm: 198_000 },
    { periodo: '2026-09', clicks: 740, pedidos: 12, pendientes: 1, neto: 1_320_000, com_inf: 198_000, com_adm: 66_000 },
  ],
  top: [
    { modelo: 'PARIS', links: 4, clicks: 1_210, pedidos: 24, neto: 2_640_000 },
    { modelo: 'AUGUSTA', links: 3, clicks: 860, pedidos: 15, neto: 1_650_000 },
    { modelo: 'EMMEN', links: 2, clicks: 540, pedidos: 9, neto: 990_000 },
    { modelo: 'LONDRES', links: 2, clicks: 410, pedidos: 6, neto: 660_000 },
  ],
  redes: [
    { red: 'instagram', links: 8, clicks: 2_480, pedidos: 44, neto: 4_840_000 },
    { red: 'tiktok', links: 3, clicks: 1_120, pedidos: 14, neto: 1_540_000 },
  ],
  posts: [
    { id: 1, codigo: 'ej1', modelo: 'PARIS', red: 'instagram', formato: 'reel', url_pub: null, created_at: '2026-08-14', influencer: 'Ejemplo', clicks: 780, pedidos: 16, neto: 1_760_000 },
    { id: 2, codigo: 'ej2', modelo: 'AUGUSTA', red: 'tiktok', formato: 'video', url_pub: null, created_at: '2026-08-20', influencer: 'Ejemplo', clicks: 640, pedidos: 10, neto: 1_100_000 },
    { id: 3, codigo: 'ej3', modelo: 'PARIS', red: 'instagram', formato: 'historia', url_pub: null, created_at: '2026-08-03', influencer: 'Ejemplo', clicks: 430, pedidos: 8, neto: 880_000 },
    { id: 4, codigo: 'ej4', modelo: 'EMMEN', red: 'instagram', formato: 'post', url_pub: null, created_at: '2026-08-26', influencer: 'Ejemplo', clicks: 290, pedidos: 5, neto: 550_000 },
  ],
  influencers: [], admins: [],
}

const C_RED: Record<string, string> = { instagram: '#c13584', tiktok: '#111827', youtube: '#dc2626', facebook: '#2a78d6', x: '#525252', otra: '#8d8a82' }

export default function ColabDashboard({ clave, rol, pctInf, pctAdm, adminId, coleccion, pctResto, restoDesde }: {
  clave: string; rol: Rol; pctInf?: number; pctAdm?: number; adminId?: number | null
  coleccion?: boolean   // promotor de colección: cuenta toda la venta de la colección, sin cupón
  pctResto?: number | null; restoDesde?: string | null   // colección: % de lo que no trae el promotor y desde cuándo
}) {
  const [r, setR] = useState<Resumen | null>(null)
  const [actualizando, setActualizando] = useState(false)
  // vista: 'YYYY-MM' (un mes), 'acum' o 'comparar'. Arranca en el mes en curso.
  const [vista, setVista] = useState('')
  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')
  const [origenes, setOrigenes] = useState<Resumen['origenes'] | null>(null)

  const cargar = () =>
    supabase.rpc('colab_resumen', { p_clave: clave, p_admin: adminId ?? null }).then(({ data }) => {
      const d = data as Resumen | null
      setR(d && d.hay_datos ? d : { ...EJEMPLO, rol, influencers: d?.influencers ?? [], admins: d?.admins ?? [] })
    })
  useEffect(() => { cargar() }, [clave, adminId])

  async function actualizar() {
    setActualizando(true)
    await supabase.functions.invoke('colab-ventas-sync', { body: { clave } })
    await cargar()
    setActualizando(false)
  }

  // ── Período: un mes, el acumulado o dos meses comparados ──
  // Meses con algo (desde el primero con toques o ventas); el mes en curso siempre está.
  const serie = r?.serie ?? []
  const primero = serie.findIndex((s) => s.clicks || s.pedidos || s.pendientes || Number(s.neto))
  const meses = primero < 0 ? serie.slice(-1) : serie.slice(primero)
  const ultP = serie[serie.length - 1]?.periodo ?? ''
  const vistaOk = vista === 'acum' || vista === 'comparar' || meses.some((s) => s.periodo === vista)
  const modo: 'mes' | 'acum' | 'comparar' = vista === 'acum' ? 'acum' : vista === 'comparar' ? 'comparar' : 'mes'
  const mesSel = modo === 'mes' && vistaOk ? vista : ultP
  const mesA = meses.some((s) => s.periodo === cmpA) ? cmpA : meses[Math.max(0, meses.length - 2)]?.periodo ?? ultP
  const mesB = meses.some((s) => s.periodo === cmpB) ? cmpB : ultP
  const rango: [string, string] = modo === 'acum' ? [meses[0]?.periodo ?? ultP, ultP] : [mesSel, mesSel]

  useEffect(() => {
    if (!r || modo === 'comparar') return
    if (!r.hay_datos) { setOrigenes(r.origenes ?? []); return }
    setOrigenes(null)
    supabase.rpc('colab_origenes', { p_clave: clave, p_desde: rango[0], p_hasta: rango[1], p_admin: adminId ?? null })
      .then(({ data }) => setOrigenes((data as Resumen['origenes']) ?? []))
  }, [r, modo, rango[0], rango[1]])

  if (!r) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  type Fila = typeof r.serie[number]
  const sumar = (filas: Fila[]): Fila => filas.reduce((a, s) => ({
    periodo: a.periodo, clicks: a.clicks + Number(s.clicks || 0), pedidos: a.pedidos + Number(s.pedidos || 0),
    pendientes: a.pendientes + Number(s.pendientes || 0), neto: a.neto + Number(s.neto || 0),
    com_inf: a.com_inf + Number(s.com_inf || 0), com_adm: a.com_adm + Number(s.com_adm || 0),
    com_pend: Number(a.com_pend || 0) + Number(s.com_pend || 0),
  }), { periodo: rango[0], clicks: 0, pedidos: 0, pendientes: 0, neto: 0, com_inf: 0, com_adm: 0, com_pend: 0 })
  const fila = (p: string) => serie.find((s) => s.periodo === p) ?? sumar([])
  const ult = modo === 'acum' ? sumar(meses) : fila(mesSel)
  const iSel = serie.findIndex((s) => s.periodo === mesSel)
  const prev = modo === 'mes' && iSel > 0 && meses.some((s) => s.periodo === serie[iSel - 1].periodo) ? serie[iSel - 1] : undefined
  const nombrePeriodo = modo === 'acum'
    ? `acumulado ${meses.length > 1 ? `${mesCorto(meses[0].periodo)} – ${mesCorto(ultP)}` : mesCorto(ultP)}`
    : mesCorto(mesSel)
  const nombrePeriodoLargo = modo === 'acum' ? nombrePeriodo : mesLargo(mesSel)
  // El número grande es lo que cobra cada nivel; Orbital ve la venta total.
  const principal = (s?: Fila) => !s ? 0 : rol === 'influencer' ? s.com_inf : rol === 'admin' ? s.com_adm : s.neto
  const delta = prev && principal(prev) ? (principal(ult) / principal(prev) - 1) * 100 : null
  // Colección con comisión doble: pctInf por todo lo orgánico (links, redes, directo),
  // pctResto solo por anuncios pagos de Meta, para pedidos desde restoDesde.
  const doble = rol === 'influencer' && !!coleccion && pctResto != null && !!restoDesde
  const desdeMes = doble ? restoDesde!.slice(0, 7) : ''
  // % de un origen en el período elegido; null si el período mezcla las dos reglas (acumulado)
  const pctCanal = (canal: string): number | null => {
    if (!doble || canal !== 'meta' || rango[1] < desdeMes) return pctInf ?? 10
    return rango[0] >= desdeMes ? pctResto! : null
  }
  const etiquetaPrincipal = rol === 'influencer' ? (doble ? 'Tu comisión' : `Tu ${pctInf ?? 10}%`) : rol === 'admin' ? `Tu ${pctAdm ?? 5}%` : 'Venta neta'
  const conv = ult && ult.clicks ? (ult.pedidos / ult.clicks) * 100 : 0

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Dashboard</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            {rol === 'influencer' ? 'Cómo rinde lo que publicás, mes a mes, por posteo y por anteojo.'
              : rol === 'admin' ? 'Lo que generan tus promotores y tu comisión.'
              : 'Todos los administradores y sus promotores.'}
          </p>
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
          <select value={modo === 'mes' ? mesSel : vista} onChange={(e) => setVista(e.target.value)} aria-label="Período"
            className="rounded-lg border border-black/10 px-2.5 py-1.5 text-[12px] font-semibold bg-white">
            {[...meses].reverse().map((s) => (
              <option key={s.periodo} value={s.periodo}>{s.periodo === ultP ? `Este mes · ${mesLargo(s.periodo)}` : mesLargo(s.periodo)}</option>
            ))}
            {meses.length > 1 && <option value="acum">Acumulado</option>}
            {meses.length > 1 && <option value="comparar">Comparar meses</option>}
          </select>
          {rol !== 'influencer' && (
            <button onClick={actualizar} disabled={actualizando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50">
              <RefreshCw size={12} className={actualizando ? 'animate-spin' : ''} /> Actualizar ventas
            </button>
          )}
        </div>
      </div>

      {modo === 'comparar' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-neutral-500">Comparar</span>
          <select value={mesA} onChange={(e) => setCmpA(e.target.value)} aria-label="Primer mes"
            className="rounded-lg border border-black/10 px-2.5 py-1.5 font-semibold bg-white">
            {[...meses].reverse().map((s) => <option key={s.periodo} value={s.periodo}>{mesLargo(s.periodo)}</option>)}
          </select>
          <span className="text-neutral-500">con</span>
          <select value={mesB} onChange={(e) => setCmpB(e.target.value)} aria-label="Segundo mes"
            className="rounded-lg border border-black/10 px-2.5 py-1.5 font-semibold bg-white">
            {[...meses].reverse().map((s) => <option key={s.periodo} value={s.periodo}>{mesLargo(s.periodo)}</option>)}
          </select>
        </div>
      )}

      {!r.hay_datos && (
        <div className="mb-4 rounded-xl border border-dashed border-black/25 bg-white p-3 text-[11px] flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-neutral-500" />
          <span><b>Números de ejemplo.</b> Todavía no hay toques en ningún link. Con el primero, la pantalla usa los datos reales sola.</span>
        </div>
      )}

      {/* Comparar dos meses: lado a lado, con la diferencia */}
      {modo === 'comparar' && (() => {
        const a = fila(mesA), b = fila(mesB)
        const filas: [string, number, number, 'plata' | 'n'][] = [
          [etiquetaPrincipal, principal(a), principal(b), 'plata'],
          ...(rol !== 'orbital' ? [['Venta neta', a.neto, b.neto, 'plata'] as [string, number, number, 'plata']] : []),
          ['Pedidos pagados', a.pedidos, b.pedidos, 'n'],
          ['Toques', a.clicks, b.clicks, 'n'],
        ]
        return (
          <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 items-baseline text-[12px]">
              <span />
              <span className="text-[10px] uppercase tracking-[0.14em] opacity-60 text-right">{mesCorto(mesA)}</span>
              <span className="text-[10px] uppercase tracking-[0.14em] opacity-60 text-right">{mesCorto(mesB)}</span>
              <span className="text-[10px] uppercase tracking-[0.14em] opacity-60 text-right">Cambio</span>
              {filas.map(([k, va, vb, tipo], i) => {
                const d = va ? (vb / va - 1) * 100 : null
                return (
                  <Fragment key={k}>
                    <span className={i === 0 ? 'font-bold' : 'opacity-70'}>{k}</span>
                    <span className={`text-right tabular-nums ${i === 0 ? 'text-[18px] font-bold' : 'font-semibold'}`}>{tipo === 'plata' ? kAr(va) : nAr(va)}</span>
                    <span className={`text-right tabular-nums ${i === 0 ? 'text-[18px] font-bold' : 'font-semibold'}`}>{tipo === 'plata' ? kAr(vb) : nAr(vb)}</span>
                    <span className="text-right tabular-nums text-[11px]" style={{ color: d == null ? 'rgba(255,255,255,0.5)' : d >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                      {d == null ? (vb ? 'nuevo' : '—') : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%`}
                    </span>
                  </Fragment>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* La plata primero */}
      {modo !== 'comparar' && <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">{etiquetaPrincipal} · {nombrePeriodo}</div>
            <div className="text-[32px] font-bold leading-none mt-1">{kAr(principal(ult))}</div>
            {delta != null && (
              <div className="text-[11px] mt-1" style={{ color: delta >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs {mesCorto(prev!.periodo)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-5 text-[11px]">
            {([
              rol !== 'orbital' ? ['Venta neta', kAr(ult?.neto), 'sin IVA ni envío'] : ['Influencers', kAr(ult?.com_inf), ''],
              rol === 'orbital' ? ['Administradores', kAr(ult?.com_adm), ''] : null,
              ['Toques', nAr(ult?.clicks), 'aperturas de tus links'],
              ['Pedidos', nAr(ult?.pedidos), 'pagados'],
            ].filter(Boolean) as [string, string, string][]).map(([k, v, d]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div>
                <div className="font-bold">{v}</div>
                {d && <div className="text-[9px] opacity-50">{d}</div>}
              </div>
            ))}
          </div>
        </div>
        {/* Cómo se arma el número: orgánicas vs anuncios pagos de Meta */}
        {doble && origenes && origenes.length > 0 && (() => {
          const g = (meta: boolean) => origenes.filter((o) => (o.canal === 'meta') === meta).reduce(
            (a, o) => ({ n: a.n + Number(o.pedidos || 0), neto: a.neto + Number(o.neto || 0), com: a.com + Number(o.com_inf || 0) }),
            { n: 0, neto: 0, com: 0 })
          const org = g(false), meta = g(true), pm = pctCanal('meta')
          const fila = (k: string, que: string, pct: number | null, x: typeof org) => (
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div><b>{k}</b> <span className="opacity-60">· {x.n} pedido{x.n === 1 ? '' : 's'} · venta {kAr(x.neto)}{pct != null ? ` × ${pct}%` : ''}</span></div>
                <div className="text-[9px] opacity-50">{que}</div>
              </div>
              <b className="tabular-nums shrink-0">{kAr(x.com)}</b>
            </div>
          )
          return (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-1 text-[11px]">
              {fila('Ventas orgánicas', 'tu link, redes, publicaciones de Orbital o de otros, compras directas en la tienda', pctInf ?? 10, org)}
              {fila('Anuncios de Meta', 'solo las que llegan por publicidad paga de Orbital en Instagram y Facebook', pm, meta)}
              <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-white/10">
                <div><b>Total cobrado</b><div className="text-[9px] opacity-50">pedidos con el pago acreditado</div></div>
                <b className="tabular-nums">{kAr(org.com + meta.com)}</b>
              </div>
              {(ult?.pendientes ?? 0) > 0 && (
                <>
                  <div className="flex items-baseline justify-between gap-3 opacity-70">
                    <div><b>+ Pendientes de pago</b> <span>· {ult.pendientes} pedido{ult.pendientes === 1 ? '' : 's'}</span>
                      <div className="text-[9px] opacity-70">compras hechas que todavía no se pagaron (ej. transferencias); suman cuando se acredita</div></div>
                    <b className="tabular-nums">{kAr(ult.com_pend ?? 0)}</b>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-white/10">
                    <div><b>Total si se pagan todos</b><div className="text-[9px] opacity-50">si alguno se cancela, no suma</div></div>
                    <b className="tabular-nums">{kAr(org.com + meta.com + Number(ult.com_pend ?? 0))}</b>
                  </div>
                </>
              )}
            </div>
          )
        })()}
        {!doble && (ult?.pendientes ?? 0) > 0 && (
          <p className="text-[10px] opacity-60 mt-2">
            Además hay {ult.pendientes} pedido{ult.pendientes === 1 ? '' : 's'} esperando el pago (por ejemplo, transferencias):
            {' '}<b>no están incluidos</b> en este número. Se suman solos cuando se acredita el pago.
          </p>
        )}
      </div>}

      {doble && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl p-3 text-white" style={{ background: ACENTO }}>
            <div className="text-[22px] font-bold leading-none">{pctInf ?? 10}%</div>
            <div className="text-[11px] font-bold mt-1">Ventas orgánicas</div>
            <div className="text-[10px] opacity-80">Tus links, Instagram y otras redes, publicaciones de Orbital o de otros, y compras directas en la tienda.</div>
          </div>
          <div className="rounded-xl p-3 bg-white border border-black/10">
            <div className="text-[22px] font-bold leading-none">{pctResto}%</div>
            <div className="text-[11px] font-bold mt-1">Ventas por anuncios de Meta</div>
            <div className="text-[10px] text-neutral-500">Solo las que llegan por publicidad paga de Orbital en Instagram y Facebook. Desde el {new Date(`${restoDesde}T12:00:00`).toLocaleDateString('es-AR')}.</div>
          </div>
        </div>
      )}

      {/* Curva de venta: todos los meses, con el período elegido marcado */}
      {meses.length > 1 && (
        <CurvaVentas meses={meses} marcados={modo === 'comparar' ? [mesA, mesB] : modo === 'acum' ? meses.map((s) => s.periodo) : [mesSel]}
          valor={rol === 'orbital' ? (s) => s.neto : principal} etiqueta={rol === 'orbital' ? 'Venta neta' : etiquetaPrincipal}
          onElegir={(p) => setVista(p)} />
      )}

      {/* Embudo en escalones */}
      {modo !== 'comparar' && <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Del link a la venta</h2>
        <p className="text-[10px] text-neutral-500 mb-3">{nombrePeriodoLargo}</p>
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide">Toques al link</div>
            <div className="text-[10px] text-neutral-500">{coleccion ? 'personas que abrieron tus links' : 'cada uno recibe su código único'}</div>
          </div>
          <div className="text-[20px] font-bold tabular-nums leading-none">{nAr(ult?.clicks)}</div>
        </div>
        <div className="flex items-center gap-2 py-1 pl-3">
          <span className="w-px h-4 bg-black/15" />
          <span className="text-[10px] text-neutral-500">{coleccion ? 'y en la tienda' : <>compró el <b className="text-black">{conv.toFixed(1)}%</b></>}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide">Pedidos pagados</div>
            <div className="text-[10px] text-neutral-500">{coleccion ? 'de tu colección: por tu link, anuncios de Orbital o directo en la tienda' : 'con el código de tu link'}</div>
          </div>
          <div className="text-[20px] font-bold tabular-nums leading-none">{nAr(ult?.pedidos)}</div>
        </div>
      </div>}

      {/* De dónde vienen las ventas del período */}
      {modo !== 'comparar' && origenes && origenes.length > 0 && (() => {
        const tot = origenes.reduce((a, o) => a + Number(o.neto || 0), 0) || 1
        return (
          <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
            <h2 className="text-[12px] font-bold uppercase tracking-wide">De dónde vienen las ventas</h2>
            <p className="text-[10px] text-neutral-500 mb-3">{nombrePeriodoLargo} · pedidos pagados.{coleccion ? ' Todas suman a tu comisión.' : ''}</p>
            <div className="flex gap-[2px] h-3 rounded-full overflow-hidden bg-[#F5F5F7]">
              {origenes.map((o) => (
                <div key={o.canal} style={{ width: `${(Number(o.neto) / tot) * 100}%`, background: CANALES[o.canal]?.color ?? '#8d8a82' }} />
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {origenes.map((o) => (
                <div key={o.canal} className="flex items-start justify-between gap-3 text-[11px]">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style={{ background: CANALES[o.canal]?.color ?? '#8d8a82' }} />
                    <div className="min-w-0">
                      <div className="font-bold">{CANALES[o.canal]?.label ?? o.canal}</div>
                      <div className="text-[10px] text-neutral-500">{CANALES[o.canal]?.det}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="font-bold">{kAr(o.neto)}</div>
                    <div className="text-[9px] text-neutral-500">
                      {o.pedidos} pedido{o.pedidos === 1 ? '' : 's'}{rol === 'influencer' ? ` · ${pctCanal(o.canal) != null ? `tu ${pctCanal(o.canal)}%` : 'tu comisión'}: ${kAr(o.com_inf)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Anuncios de Orbital en Meta que llevan a lo del promotor. Sin inversión: eso queda en los paneles internos. */}
      {r.meta && r.meta.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Anuncios de Orbital con {coleccion ? 'tu colección' : 'tus anteojos'}</h2>
          <p className="text-[10px] text-neutral-500 mb-3">Publicidad que Orbital hace en Instagram y Facebook y lleva a {coleccion ? 'tu colección' : 'tus anteojos'}. Números desde que arrancó cada campaña.</p>
          <div className="space-y-2">
            {r.meta.map((c) => (
              <div key={c.campaign_id} className="rounded-lg border border-black/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wide">{c.nombre}</div>
                    {c.desde && <div className="text-[10px] text-neutral-500">desde el {new Date(`${c.desde}T12:00:00`).toLocaleDateString('es-AR')}</div>}
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={c.activo ? { background: '#E3F4EC', color: '#047857' } : { background: '#F3F4F6', color: '#6b7280' }}>
                    {c.activo ? '● Activo' : '❚❚ Pausado'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[10px]">
                  {([
                    ['Impresiones', nAr(c.impresiones)],
                    ['Clics', nAr(c.clicks)],
                    ['Pedidos', nAr(c.pedidos)],
                    rol === 'influencer' ? [doble ? 'Tu comisión' : `Tu ${pctInf ?? 10}%`, kAr(c.com_inf)] : ['Venta neta', kAr(c.neto)],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[9px] uppercase tracking-wide text-neutral-400">{k}</div>
                      <div className="font-bold tabular-nums">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranking de administradores (Orbital) */}
      {rol === 'orbital' && r.admins.length > 0 && (
        <Ranking titulo="Administradores" sub="Venta neta acumulada de todos sus promotores."
          filas={r.admins.map((a) => ({
            k: a.id, nombre: a.nombre, apagado: !a.activo, neto: a.neto,
            det: `${a.influencers} promotores · ${nAr(a.clicks)} toques · ${a.pedidos} pedidos`,
            der: `inf ${kAr(a.com_inf)} · adm ${kAr(a.com_adm)}`,
          }))} />
      )}

      {/* Ranking de promotores (admin y Orbital) */}
      {rol !== 'influencer' && r.influencers.length > 0 && (
        <Ranking titulo="Promotores" sub="Quién genera más venta."
          filas={r.influencers.map((i) => ({
            k: i.id, nombre: i.nombre, apagado: !i.activo, neto: i.neto,
            det: `${rol === 'orbital' ? i.admin + ' · ' : ''}${i.links} links · ${nAr(i.clicks)} toques · ${i.pedidos} pedidos`,
            der: rol === 'admin' ? `tu ${pctAdm ?? 5}%: ${kAr(i.com_adm)}` : `inf ${kAr(i.com_inf)}`,
          }))} />
      )}

      {/* Qué posteos rinden más */}
      {r.posts.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Qué publicaciones rinden más</h2>
          <p className="text-[10px] text-neutral-500 mb-3">Cada link es una publicación. Sirve para saber qué repetir: red, formato y anteojo.</p>
          <div className="space-y-2">
            {r.posts.slice(0, 12).map((p, i) => {
              const maxP = Math.max(...r.posts.map((x) => x.neto), 1)
              const c = p.clicks ? (p.pedidos / p.clicks) * 100 : 0
              return (
                <div key={p.id} className="rounded-lg border border-black/10 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="text-[11px] font-bold text-neutral-300 tabular-nums mt-0.5">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wide">{p.modelo}</span>
                          <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white" style={{ background: C_RED[p.red] ?? '#8d8a82' }}>{labelRed(p.red)}</span>
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          {labelFormato(p.formato)}{rol !== 'influencer' ? ` · ${p.influencer}` : ''}
                          {p.url_pub && <> · <a href={p.url_pub} target="_blank" rel="noopener noreferrer" className="underline">ver publicación</a></>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-bold tabular-nums leading-none">{kM(p.neto)}</div>
                      {rol === 'influencer' && <div className="text-[9px] text-neutral-400">tu {pctInf ?? 10}%: {kAr(p.neto * (pctInf ?? 10) / 100)}</div>}
                    </div>
                  </div>
                  <div className="h-2 rounded-r-[4px] mt-1.5" style={{ background: C_RED[p.red] ?? '#8d8a82', width: `${(p.neto / maxP) * 100}%`, minWidth: 2 }} />
                  <div className="flex gap-4 text-[9px] text-neutral-500 mt-1">
                    <span>Toques <b className="text-black">{nAr(p.clicks)}</b></span>
                    <span>Pedidos <b className="text-black">{p.pedidos}</b></span>
                    <span>Conversión <b className="text-black">{c.toFixed(1)}%</b></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Por red */}
      {r.redes.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Por red social</h2>
          <div className="grid gap-2 sm:grid-cols-2 mt-3">
            {r.redes.map((x) => (
              <div key={x.red} className="rounded-lg border border-black/10 p-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_RED[x.red] ?? '#8d8a82' }} />
                  <span className="text-[11px] font-bold">{labelRed(x.red)}</span>
                  <span className="ml-auto text-[12px] font-bold tabular-nums">{kM(x.neto)}</span>
                </div>
                <div className="flex gap-3 text-[9px] text-neutral-500 mt-1">
                  <span>{x.links} links</span><span>{nAr(x.clicks)} toques</span><span>{x.pedidos} pedidos</span>
                  <span>{x.clicks ? ((x.pedidos / x.clicks) * 100).toFixed(1) : '0.0'}% conv.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Qué anteojos rinden más */}
      {r.top.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Qué anteojos rinden más</h2>
          <div className="space-y-2.5 mt-3">
            {r.top.slice(0, 10).map((t) => {
              const maxT = Math.max(...r.top.map((x) => x.neto), 1)
              return (
                <div key={t.modelo}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="font-bold uppercase tracking-wide">{t.modelo}</span>
                    <span className="tabular-nums text-neutral-500">{nAr(t.clicks)} toques · {t.pedidos} ped. · <b className="text-black">{kAr(t.neto)}</b></span>
                  </div>
                  <div className="h-3 rounded-r-[4px]" style={{ background: ACENTO, width: `${(t.neto / maxT) * 100}%`, minWidth: 2 }} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rol === 'influencer' && <Liquidacion clave={clave} rol={rol} pctInf={pctInf} pctAdm={pctAdm} doble={doble} compacta
        mesesDisponibles={[...meses].reverse().map((s) => s.periodo)} periodoSel={modo === 'mes' ? mesSel : modo === 'comparar' ? mesB : ultP} />}

      <p className="text-[10px] text-neutral-400 mt-4 leading-relaxed">
        {doble
          ? `Cuenta toda venta de tu colección en la tienda desde el lanzamiento. Desde el ${new Date(`${restoDesde}T12:00:00`).toLocaleDateString('es-AR')}, todo lo orgánico (tus links, redes, publicaciones de Orbital o de otros y compras directas) va al ${pctInf ?? 10}%; solo lo que entra por anuncios pagos de Meta va al ${pctResto}%. `
          : coleccion
          ? 'Cuenta toda venta de tu colección en la tienda desde el lanzamiento, entre o no por tu link. '
          : 'Cuenta la venta de los pedidos que usan un código generado por un link (se genera uno único por persona que lo toca). '}
        Venta neta = productos después de descuentos y devoluciones, sin IVA y sin envío. Solo suman los pedidos pagados;
        los cancelados y reembolsados no. Las comisiones se liquidan sobre ese neto, sin IVA.
      </p>
    </>
  )
}

// ── Curva de venta mensual ──
// Una sola serie (venta neta o comisión): línea + área suave, punto por mes, el período elegido
// en el color de acento. Pasar el dedo/mouse muestra el mes; tocar un punto lo elige.
type MesSerie = Resumen['serie'][number]
function CurvaVentas({ meses, marcados, valor, etiqueta, onElegir }: {
  meses: MesSerie[]; marcados: string[]; valor: (s: MesSerie) => number; etiqueta: string; onElegir: (p: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 170, padL = 8, padR = 8, padT = 28, padB = 26
  const vals = meses.map((s) => Number(valor(s)) || 0)
  const max = Math.max(...vals, 1)
  const x = (i: number) => padL + (meses.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (meses.length - 1))
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const linea = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${linea} L${x(vals.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`
  const h = hover != null ? meses[hover] : null
  const totalAcum = vals.reduce((a, v) => a + v, 0)
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Curva de venta</h2>
        <span className="text-[10px] text-neutral-500">{etiqueta} acumulada: <b className="text-black tabular-nums">{kAr(totalAcum)}</b></span>
      </div>
      <p className="text-[10px] text-neutral-500 mb-2">{etiqueta} por mes, sin IVA ni envío. Tocá un mes para verlo.</p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
          aria-label={`${etiqueta} por mes: ${meses.map((s, i) => `${mesLargo(s.periodo)} ${kAr(vals[i])}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}>
          <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
          <path d={area} fill={ACENTO} opacity={0.08} />
          <path d={linea} fill="none" stroke={ACENTO} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT - 6} y2={H - padB} stroke="rgba(0,0,0,0.25)" strokeWidth={1} strokeDasharray="3 3" />}
          {meses.map((s, i) => {
            const on = marcados.includes(s.periodo)
            return (
              <g key={s.periodo}>
                <circle cx={x(i)} cy={y(vals[i])} r={on ? 6 : 4} fill={on ? ACENTO : '#ffffff'} stroke={on ? '#ffffff' : ACENTO} strokeWidth={2} />
                {on && <text x={x(i)} y={y(vals[i]) - 12} textAnchor={i === 0 ? 'start' : i === meses.length - 1 ? 'end' : 'middle'}
                  fontSize={12} fontWeight={700} fill="#111827">{kM(vals[i])}</text>}
                <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === meses.length - 1 ? 'end' : 'middle'}
                  fontSize={11} fill={on ? '#111827' : '#6b7280'} fontWeight={on ? 700 : 400}>{mesCorto(s.periodo)}</text>
                {/* zona de toque más grande que el punto */}
                <rect x={x(i) - (W - padL - padR) / Math.max(meses.length - 1, 1) / 2} y={0}
                  width={(W - padL - padR) / Math.max(meses.length - 1, 1)} height={H} fill="transparent" style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover(i)} onClick={() => onElegir(s.periodo)} />
              </g>
            )
          })}
        </svg>
        {h && hover != null && (
          <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-[#111827] text-white px-2.5 py-1.5 text-[10px] leading-snug shadow"
            style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}>
            <div className="font-bold">{mesLargo(h.periodo)}</div>
            <div className="tabular-nums">{etiqueta}: <b>{kAr(vals[hover])}</b></div>
            <div className="tabular-nums opacity-80">Venta neta {kAr(h.neto)} · {h.pedidos} pedido{h.pedidos === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Ranking({ titulo, sub, filas }: {
  titulo: string; sub: string
  filas: { k: number; nombre: string; apagado: boolean; neto: number; det: string; der: string }[]
}) {
  const max = Math.max(...filas.map((f) => f.neto), 1)
  return (
    <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wide">{titulo}</h2>
      <p className="text-[10px] text-neutral-500 mb-3">{sub}</p>
      <div className="space-y-2.5">
        {filas.map((f) => (
          <div key={f.k} className={f.apagado ? 'opacity-50' : ''}>
            <div className="flex justify-between gap-2 text-[11px] mb-0.5">
              <span className="font-bold truncate">{f.nombre}{f.apagado ? ' · inactivo' : ''}</span>
              <span className="tabular-nums font-bold shrink-0">{kAr(f.neto)}</span>
            </div>
            <div className="h-2.5 rounded-r-[4px]" style={{ background: ACENTO, width: `${(f.neto / max) * 100}%`, minWidth: 2 }} />
            <div className="flex justify-between gap-2 text-[9px] text-neutral-500 mt-0.5">
              <span className="truncate">{f.det}</span><span className="shrink-0">{f.der}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Liquidación: pedido por pedido, para poder reconstruir el total ──
const ESTADO: Record<FilaLiq['estado'], { t: string; c: string }> = {
  pagado: { t: 'Pagado', c: '#059669' },
  pendiente: { t: 'Esperando pago', c: '#b45309' },
  cancelado: { t: 'Cancelado', c: '#6b7280' },
  reembolsado: { t: 'Reembolsado', c: '#6b7280' },
}

export function Liquidacion({ clave, rol, pctInf, pctAdm, adminId, doble, compacta, mesesDisponibles, periodoSel }: {
  clave: string; rol: Rol; pctInf?: number; pctAdm?: number; adminId?: number | null; doble?: boolean; compacta?: boolean
  mesesDisponibles?: string[]   // desde el dashboard: solo los meses con datos (si no, los últimos 6)
  periodoSel?: string           // mes elegido arriba en el dashboard: la liquidación lo sigue
}) {
  const [periodo, setPeriodo] = useState(periodoSel ?? periodoActual())
  useEffect(() => { if (periodoSel) setPeriodo(periodoSel) }, [periodoSel])
  const [filas, setFilas] = useState<FilaLiq[] | null>(null)
  useEffect(() => {
    setFilas(null)
    supabase.rpc('colab_liquidacion', { p_clave: clave, p_periodo: periodo, p_admin: adminId ?? null })
      .then(({ data }) => setFilas((data as FilaLiq[]) ?? []))
  }, [clave, periodo, adminId])

  const meses = mesesDisponibles?.length ? mesesDisponibles : Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const pagadas = (filas ?? []).filter((f) => f.estado === 'pagado')
  const neto = pagadas.reduce((a, f) => a + Number(f.neto || 0), 0)
  const cInf = pagadas.reduce((a, f) => a + Number(f.com_inf || 0), 0)
  const cAdm = pagadas.reduce((a, f) => a + Number(f.com_adm || 0), 0)

  // Totales por promotor (admin / Orbital)
  const porInf = new Map<string, { neto: number; inf: number; adm: number; n: number; admin: string }>()
  for (const f of pagadas) {
    const x = porInf.get(f.influencer) ?? { neto: 0, inf: 0, adm: 0, n: 0, admin: f.admin }
    x.neto += Number(f.neto || 0); x.inf += Number(f.com_inf || 0); x.adm += Number(f.com_adm || 0); x.n++
    porInf.set(f.influencer, x)
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Liquidación</h2>
          <p className="text-[10px] text-neutral-500">Pedido por pedido. Comisión sobre el neto sin IVA.</p>
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="rounded-lg border border-black/10 px-2 py-1 text-[11px] bg-white">
          {meses.map((m) => <option key={m} value={m}>{mesLargo(m)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Kpi k="Venta neta" v={kAr(neto)} />
        {rol === 'influencer'
          ? <Kpi k={doble ? 'Tu comisión' : `Tu ${pctInf ?? 10}%`} v={kAr(cInf)} fuerte />
          : <Kpi k={`Influencers`} v={kAr(cInf)} fuerte={rol === 'orbital'} />}
        {rol === 'influencer'
          ? <Kpi k="Pedidos" v={String(pagadas.length)} />
          : <Kpi k={rol === 'admin' ? `Tu ${pctAdm ?? 5}%` : 'Administradores'} v={kAr(cAdm)} fuerte={rol === 'admin'} />}
      </div>

      {!compacta && rol !== 'influencer' && porInf.size > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-wide text-neutral-400">
              <th className="py-1 pr-2">Promotor</th>{rol === 'orbital' && <th className="pr-2">Admin</th>}
              <th className="pr-2 text-right">Ped.</th><th className="pr-2 text-right">Neto</th>
              <th className="pr-2 text-right">Influencer</th><th className="text-right">Admin</th>
            </tr></thead>
            <tbody>
              {[...porInf.entries()].sort((a, b) => b[1].neto - a[1].neto).map(([n, x]) => (
                <tr key={n} className="border-t border-black/5">
                  <td className="py-1.5 pr-2 font-semibold">{n}</td>{rol === 'orbital' && <td className="pr-2">{x.admin}</td>}
                  <td className="pr-2 text-right tabular-nums">{x.n}</td>
                  <td className="pr-2 text-right tabular-nums">{kAr(x.neto)}</td>
                  <td className="pr-2 text-right tabular-nums">{kAr(x.inf)}</td>
                  <td className="text-right tabular-nums">{kAr(x.adm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!filas ? <p className="text-[11px] text-neutral-400">Cargando…</p>
        : filas.length === 0 ? <p className="text-[11px] text-neutral-400">Sin pedidos con código en {mesLargo(periodo)}.</p>
        : (
          <div className="space-y-1.5">
            {filas.map((f) => (
              <div key={f.order_name} className="rounded-lg border border-black/10 px-2.5 py-2 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="font-bold">{f.order_name} · {f.modelo}</span>
                  <span className="text-[10px] font-bold" style={{ color: ESTADO[f.estado]?.c }}>{ESTADO[f.estado]?.t ?? f.estado}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3 text-[10px] text-neutral-500 mt-0.5">
                  <span>{new Date(f.fecha).toLocaleDateString('es-AR')}{rol !== 'influencer' ? ` · ${f.influencer}` : ''}{origenFila(f)}</span>
                  <span>neto <b className="text-black">{kAr(f.neto)}</b>
                    {' · '}{rol === 'admin' ? `tu ${pctAdm ?? 5}%` : rol === 'influencer' ? `tu ${f.pct ?? pctInf ?? 10}%` : `inf.`} <b className="text-black">{kAr(rol === 'admin' ? f.com_adm : f.com_inf)}</b>
                    {rol === 'orbital' && <> · adm. <b className="text-black">{kAr(f.com_adm)}</b></>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

// "· Tu link · Instagram" / "· Anuncio ORBITAL x ZAIRA · 40% OFF" / "· Directo en la tienda"
function origenFila(f: FilaLiq) {
  if (!f.canal) return f.red ? ` · ${labelRed(f.red)}` : ''
  if (f.canal === 'link') return ` · Tu link${f.red ? ` · ${labelRed(f.red)}` : ''}`
  if (f.canal === 'meta' && f.campana) return ` · Anuncio ${f.campana}`
  return ` · ${CANALES[f.canal]?.label ?? f.canal}`
}

function Kpi({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: fuerte ? '#111827' : '#F5F5F7', color: fuerte ? 'white' : undefined }}>
      <div className="text-[9px] uppercase tracking-wide opacity-60">{k}</div>
      <div className="text-[14px] font-bold tabular-nums">{v}</div>
    </div>
  )
}
