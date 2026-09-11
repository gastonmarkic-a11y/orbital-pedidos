// ── Dashboard de colaboradores (mismo diseño que el de ZN) ────────────────────
// Un solo componente para los tres niveles, con lo que corresponde a cada uno:
//   influencer → su 15%, sus links/posteos y qué anteojos rinden
//   admin      → su 5% + el ranking de sus promotores
//   orbital    → venta total, las dos comisiones y el ranking de administradores
// Mientras no haya clicks se muestra un ejemplo CON cartel; con el primero, lo real.
import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, Resumen, Rol, FilaLiq, kAr, kM, nAr, mesCorto, mesLargo, labelRed, labelFormato, periodoActual } from './colabUtil'

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

export default function ColabDashboard({ clave, rol, pctInf, pctAdm, adminId }: {
  clave: string; rol: Rol; pctInf?: number; pctAdm?: number; adminId?: number | null
}) {
  const [r, setR] = useState<Resumen | null>(null)
  const [actualizando, setActualizando] = useState(false)

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

  if (!r) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  const ult = r.serie[r.serie.length - 1]
  const prev = r.serie[r.serie.length - 2]
  // El número grande es lo que cobra cada nivel; Orbital ve la venta total.
  const principal = (s?: typeof ult) => !s ? 0 : rol === 'influencer' ? s.com_inf : rol === 'admin' ? s.com_adm : s.neto
  const delta = prev && principal(prev) ? (principal(ult) / principal(prev) - 1) * 100 : null
  const maxMes = Math.max(...r.serie.map((s) => s.neto), 1)
  const etiquetaPrincipal = rol === 'influencer' ? `Tu ${pctInf ?? 15}%` : rol === 'admin' ? `Tu ${pctAdm ?? 5}%` : 'Venta neta'
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
        {rol !== 'influencer' && (
          <button onClick={actualizar} disabled={actualizando}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50">
            <RefreshCw size={12} className={actualizando ? 'animate-spin' : ''} /> Actualizar ventas
          </button>
        )}
      </div>

      {!r.hay_datos && (
        <div className="mb-4 rounded-xl border border-dashed border-black/25 bg-white p-3 text-[11px] flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-neutral-500" />
          <span><b>Números de ejemplo.</b> Todavía no hay toques en ningún link. Con el primero, la pantalla usa los datos reales sola.</span>
        </div>
      )}

      {/* La plata primero */}
      <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">{etiquetaPrincipal} · {ult ? mesCorto(ult.periodo) : ''}</div>
            <div className="text-[32px] font-bold leading-none mt-1">{kAr(principal(ult))}</div>
            {delta != null && (
              <div className="text-[11px] mt-1" style={{ color: delta >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs {mesCorto(prev.periodo)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-5 text-[11px]">
            {([
              rol !== 'orbital' ? ['Venta neta', kAr(ult?.neto)] : ['Influencers', kAr(ult?.com_inf)],
              rol === 'orbital' ? ['Administradores', kAr(ult?.com_adm)] : null,
              ['Toques', nAr(ult?.clicks)],
              ['Pedidos', nAr(ult?.pedidos)],
            ].filter(Boolean) as [string, string][]).map(([k, v]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div>
                <div className="font-bold">{v}</div>
              </div>
            ))}
          </div>
        </div>
        {(ult?.pendientes ?? 0) > 0 && (
          <p className="text-[10px] opacity-60 mt-2">+ {ult.pendientes} pedido{ult.pendientes === 1 ? '' : 's'} esperando el pago (se suman cuando se acredita).</p>
        )}
      </div>

      {/* Embudo en escalones */}
      <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Del link a la venta</h2>
        <p className="text-[10px] text-neutral-500 mb-3">{ult ? mesLargo(ult.periodo) : ''}</p>
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide">Toques al link</div>
            <div className="text-[10px] text-neutral-500">cada uno recibe su código único</div>
          </div>
          <div className="text-[20px] font-bold tabular-nums leading-none">{nAr(ult?.clicks)}</div>
        </div>
        <div className="flex items-center gap-2 py-1 pl-3">
          <span className="w-px h-4 bg-black/15" />
          <span className="text-[10px] text-neutral-500">compró el <b className="text-black">{conv.toFixed(1)}%</b></span>
        </div>
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide">Pedidos pagados</div>
            <div className="text-[10px] text-neutral-500">con el código de tu link</div>
          </div>
          <div className="text-[20px] font-bold tabular-nums leading-none">{nAr(ult?.pedidos)}</div>
        </div>
      </div>

      {/* Evolución mensual */}
      <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Venta neta por mes</h2>
        <p className="text-[10px] text-neutral-500 mb-3">Sin IVA y sin envío. Arriba de cada barra, {rol === 'orbital' ? 'la venta' : 'tu comisión'}.</p>
        <div className="flex items-end gap-2 h-44">
          {r.serie.map((s) => (
            <div key={s.periodo} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className="text-[9px] font-bold mb-1 tabular-nums">{kM(rol === 'orbital' ? s.neto : principal(s))}</div>
              <div className="w-full rounded-t-[4px]" style={{ background: ACENTO, height: `${(s.neto / maxMes) * 100}%`, minHeight: s.neto ? 2 : 0 }} />
              <div className="text-[9px] text-neutral-500 mt-1">{mesCorto(s.periodo)}</div>
            </div>
          ))}
        </div>
      </div>

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
                      {rol === 'influencer' && <div className="text-[9px] text-neutral-400">tu {pctInf ?? 15}%: {kAr(p.neto * (pctInf ?? 15) / 100)}</div>}
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

      {rol === 'influencer' && <Liquidacion clave={clave} rol={rol} pctInf={pctInf} pctAdm={pctAdm} compacta />}

      <p className="text-[10px] text-neutral-400 mt-4 leading-relaxed">
        Cuenta la venta de los pedidos que usan un código generado por un link (se genera uno único por persona que lo toca).
        Venta neta = productos después de descuentos y devoluciones, sin IVA y sin envío. Solo suman los pedidos pagados;
        los cancelados y reembolsados no. Las comisiones se liquidan sobre ese neto, sin IVA.
      </p>
    </>
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

export function Liquidacion({ clave, rol, pctInf, pctAdm, adminId, compacta }: {
  clave: string; rol: Rol; pctInf?: number; pctAdm?: number; adminId?: number | null; compacta?: boolean
}) {
  const [periodo, setPeriodo] = useState(periodoActual())
  const [filas, setFilas] = useState<FilaLiq[] | null>(null)
  useEffect(() => {
    setFilas(null)
    supabase.rpc('colab_liquidacion', { p_clave: clave, p_periodo: periodo, p_admin: adminId ?? null })
      .then(({ data }) => setFilas((data as FilaLiq[]) ?? []))
  }, [clave, periodo, adminId])

  const meses = Array.from({ length: 6 }, (_, i) => {
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
          ? <Kpi k={`Tu ${pctInf ?? 15}%`} v={kAr(cInf)} fuerte />
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
                  <span>{new Date(f.fecha).toLocaleDateString('es-AR')}{rol !== 'influencer' ? ` · ${f.influencer}` : ''}{f.red ? ` · ${labelRed(f.red)}` : ''}</span>
                  <span>neto <b className="text-black">{kAr(f.neto)}</b>
                    {' · '}{rol === 'admin' ? `tu ${pctAdm ?? 5}%` : `inf.`} <b className="text-black">{kAr(rol === 'admin' ? f.com_adm : f.com_inf)}</b>
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

function Kpi({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: fuerte ? '#111827' : '#F5F5F7', color: fuerte ? 'white' : undefined }}>
      <div className="text-[9px] uppercase tracking-wide opacity-60">{k}</div>
      <div className="text-[14px] font-bold tabular-nums">{v}</div>
    </div>
  )
}
