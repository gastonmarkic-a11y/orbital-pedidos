import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { formatPrecio } from '../../lib/format'
import RoasChart from './RoasChart'
import BibliotecasAnuncios from './BibliotecasAnuncios'
import RankingProductos from './RankingProductos'
import GastoVentasChart from './GastoVentasChart'
import VisitasConversionesChart from './VisitasConversionesChart'

// Panel de Inteligencia Publicitaria — FASE 1: SOLO LECTURA.
// Nada de lo que se ve acá modifica una campaña en Meta. El "ecualizador" recalcula
// las sugerencias en vivo dentro del navegador para poder tantear umbrales sin riesgo.

interface Insight {
  fecha: string
  campaign_id: string
  campaign_name: string
  ad_id: string
  spend: number
  clicks: number
  impressions: number
  ctr: number | null
  frequency: number | null
  purchases_meta: number
  revenue_meta: number
}

interface DiaRoas {
  fecha: string
  spend_meta: number
  spend_b2c: number
  spend_b2b: number
  ventas_shopify_linea: number
  ventas_shopify_outlet: number
  pedidos_shopify: number
  revenue_meta: number
  roas_real: number | null
  roas_meta: number | null
}

interface CampanaCfg {
  campaign_id: string
  campaign_name: string | null
  tipo: 'b2c' | 'b2b' | 'sin_clasificar'
}

interface MotorCfg {
  break_even_roas: number
  roas_objetivo: number
  cpa_max: number
  min_conversiones: number
  ventana_dias: number
  max_cambio_pct: number
  cooldown_dias: number
  freq_fatiga: number
  factor_correccion: number
}

const TIPO_LABEL: Record<string, string> = {
  b2c: '🛍 B2C',
  b2b: '🏢 B2B',
  sin_clasificar: '❓ Sin clasificar',
}

function fmt(n: number | null | undefined, dec = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toFixed(dec)
}

function diaCorto(fecha: string): string {
  const [, m, d] = fecha.split('-')
  return `${d}/${m}`
}

export default function Publicidad() {
  const toast = useToast()
  const [insights, setInsights] = useState<Insight[]>([])
  const [dias, setDias] = useState<DiaRoas[]>([])
  const [campanas, setCampanas] = useState<CampanaCfg[]>([])
  const [cfg, setCfg] = useState<MotorCfg | null>(null)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [autoFactor, setAutoFactor] = useState(true)

  async function cargar() {
    const [ri, rd, rc, rm] = await Promise.all([
      supabase.from('meta_insights').select('*').order('fecha', { ascending: false }),
      supabase.from('roas_diario').select('*').order('fecha', { ascending: false }).limit(90),
      supabase.from('campanas_config').select('*'),
      supabase.from('motor_config').select('*').eq('id', 'principal').maybeSingle(),
    ])
    setInsights((ri.data as Insight[]) ?? [])
    setDias((rd.data as DiaRoas[]) ?? [])
    setCampanas((rc.data as CampanaCfg[]) ?? [])
    if (rm.data) setCfg(rm.data as MotorCfg)
    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  const tipoDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campanas) m.set(c.campaign_id, c.tipo)
    return m
  }, [campanas])

  // Totales del período con datos (los días sin ventas todavía —hoy— distorsionan el promedio)
  const totales = useMemo(() => {
    const conDatos = dias.filter((d) => d.pedidos_shopify > 0)
    const spendB2C = conDatos.reduce((a, d) => a + Number(d.spend_b2c || d.spend_meta), 0)
    const spendB2B = conDatos.reduce((a, d) => a + Number(d.spend_b2b || 0), 0)
    const ventas = conDatos.reduce((a, d) => a + Number(d.ventas_shopify_linea) + Number(d.ventas_shopify_outlet), 0)
    const revMeta = conDatos.reduce((a, d) => a + Number(d.revenue_meta), 0)
    const pedidos = conDatos.reduce((a, d) => a + d.pedidos_shopify, 0)
    return {
      spendB2C,
      spendB2B,
      ventas,
      revMeta,
      pedidos,
      roasReal: spendB2C > 0 ? ventas / spendB2C : null,
      roasMeta: spendB2C > 0 ? revMeta / spendB2C : null,
      // Cuánto de lo que Meta se atribuye es real. <1 = Meta infla.
      factorAuto: revMeta > 0 ? ventas / revMeta : 1,
      dias: conDatos.length,
    }
  }, [dias])

  const factorEfectivo = autoFactor ? totales.factorAuto : Number(cfg?.factor_correccion ?? 1)

  // Agregado por campaña dentro de la ventana elegida + qué sugeriría el motor.
  // Todo se recalcula acá en el navegador: mover un control no toca nada del servidor.
  const posiciones = useMemo(() => {
    if (!cfg) return []
    const corte = new Date(Date.now() - cfg.ventana_dias * 86400000).toISOString().slice(0, 10)
    const porCampana = new Map<
      string,
      { nombre: string; spend: number; conv: number; rev: number; freqMax: number; clicks: number; impr: number; ads: Set<string> }
    >()
    for (const i of insights) {
      if (i.fecha < corte) continue
      const acc = porCampana.get(i.campaign_id) ?? {
        nombre: i.campaign_name,
        spend: 0,
        conv: 0,
        rev: 0,
        freqMax: 0,
        clicks: 0,
        impr: 0,
        ads: new Set<string>(),
      }
      acc.spend += Number(i.spend) || 0
      acc.conv += Number(i.purchases_meta) || 0
      acc.rev += Number(i.revenue_meta) || 0
      acc.freqMax = Math.max(acc.freqMax, Number(i.frequency) || 0)
      acc.clicks += Number(i.clicks) || 0
      acc.impr += Number(i.impressions) || 0
      acc.ads.add(i.ad_id)
      porCampana.set(i.campaign_id, acc)
    }

    return [...porCampana.entries()]
      .map(([id, c]) => {
        const tipo = (tipoDe.get(id) ?? 'sin_clasificar') as CampanaCfg['tipo']
        const cpa = c.conv > 0 ? c.spend / c.conv : null
        const roasCrudo = c.spend > 0 ? c.rev / c.spend : null
        const roas = roasCrudo !== null ? roasCrudo * factorEfectivo : null
        const ctr = c.impr > 0 ? (c.clicks / c.impr) * 100 : null

        let sugerencia = 'sin_accion'
        let motivo = ''
        let tono: 'ok' | 'alerta' | 'peligro' | 'neutro' = 'neutro'

        if (tipo === 'b2b') {
          motivo = 'Campaña B2B: su conversión es lead con cierre diferido, no venta en la tienda. No se evalúa con ROAS de Shopify.'
        } else if (c.freqMax >= cfg.freq_fatiga) {
          sugerencia = 'refrescar_creativo'
          motivo = `Frecuencia ${fmt(c.freqMax, 1)} ≥ ${cfg.freq_fatiga}: el creativo se está quemando`
          tono = 'alerta'
        } else if (c.conv < cfg.min_conversiones) {
          motivo = `Solo ${c.conv} conversiones en ${cfg.ventana_dias}d (mínimo ${cfg.min_conversiones}). Sin señal suficiente: no se opera.`
        } else if (cpa !== null && cpa > cfg.cpa_max) {
          sugerencia = 'pausar'
          motivo = `CPA ${formatPrecio(cpa)} supera el máximo de ${formatPrecio(cfg.cpa_max)}`
          tono = 'peligro'
        } else if (roas !== null && roas < cfg.break_even_roas) {
          sugerencia = 'pausar'
          motivo = `ROAS ${fmt(roas)} por debajo del break-even ${cfg.break_even_roas}`
          tono = 'peligro'
        } else if (roas !== null && roas >= cfg.roas_objetivo) {
          sugerencia = `subir_budget_${cfg.max_cambio_pct}`
          motivo = `ROAS ${fmt(roas)} ≥ objetivo ${cfg.roas_objetivo} con ${c.conv} conversiones`
          tono = 'ok'
        } else {
          motivo = `ROAS ${fmt(roas)} entre break-even y objetivo: dejar correr`
        }

        return { id, tipo, ...c, cpa, roas, ctr, sugerencia, motivo, tono }
      })
      .sort((a, b) => b.spend - a.spend)
  }, [insights, cfg, tipoDe, factorEfectivo])

  async function cambiarTipo(campaign_id: string, tipo: CampanaCfg['tipo']) {
    setCampanas((prev) => prev.map((c) => (c.campaign_id === campaign_id ? { ...c, tipo } : c)))
    const { error } = await supabase
      .from('campanas_config')
      .update({ tipo, actualizado_en: new Date().toISOString() })
      .eq('campaign_id', campaign_id)
    if (error) {
      toast('No se pudo guardar la clasificación: ' + error.message, 'error')
      cargar()
      return
    }
    toast('Clasificación guardada. El ROAS se recalcula en el próximo sync.', 'success')
  }

  async function guardarConfig() {
    if (!cfg) return
    setGuardando(true)
    const { error } = await supabase
      .from('motor_config')
      .update({ ...cfg, factor_correccion: factorEfectivo, actualizado_en: new Date().toISOString() })
      .eq('id', 'principal')
    setGuardando(false)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    toast('✓ Parámetros guardados', 'success')
  }

  async function sincronizar() {
    setSincronizando(true)
    const { error } = await supabase.functions.invoke('meta-insights-sync')
    setSincronizando(false)
    if (error) {
      toast('No se pudo sincronizar: ' + error.message, 'error')
      return
    }
    await cargar()
    toast('✓ Datos actualizados desde Meta', 'success')
  }

  function setCfgCampo(campo: keyof MotorCfg, valor: number) {
    setCfg((prev) => (prev ? { ...prev, [campo]: valor } : prev))
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando datos de Meta…</p>

  if (insights.length === 0)
    return (
      <div className="space-y-3 text-ink">
        <h1 className="text-xl font-semibold">📊 Inteligencia Publicitaria</h1>
        <div className="border border-[#C8A96E] bg-[#FBF7EE] rounded-lg p-4 text-sm space-y-2">
          <p className="font-semibold">Todavía no hay datos de Meta</p>
          <p>La conexión está armada pero no se sincronizó ninguna campaña. Probá con el botón de abajo.</p>
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="px-3 py-2 rounded-lg bg-[#15151A] text-white text-sm disabled:opacity-50"
          >
            {sincronizando ? 'Sincronizando…' : '↻ Traer datos de Meta'}
          </button>
        </div>
      </div>
    )

  const sinClasificar = posiciones.filter((p) => p.tipo === 'sin_clasificar').length

  return (
    <div className="space-y-5 text-ink">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">📊 Inteligencia Publicitaria</h1>
          <p className="text-xs text-muted mt-0.5">
            Solo lectura — nada de acá modifica campañas en Meta. Datos de los últimos {totales.dias} días con ventas.
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          className="px-3 py-2 rounded-lg bg-[#15151A] text-white text-sm disabled:opacity-50"
        >
          {sincronizando ? 'Sincronizando…' : '↻ Actualizar desde Meta'}
        </button>
      </div>

      {/* ---- El número que Meta no te da ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <div className="text-2xl font-semibold">{fmt(totales.roasReal)}</div>
          <div className="text-xs text-muted mt-0.5">ROAS real</div>
          <div className="text-[10px] text-faint mt-1">ventas de tu base ÷ gasto B2C</div>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <div className="text-2xl font-semibold text-amber-600">{fmt(totales.roasMeta)}</div>
          <div className="text-xs text-muted mt-0.5">ROAS según Meta</div>
          <div className="text-[10px] text-faint mt-1">
            {totales.roasMeta && totales.roasReal
              ? `infla ${fmt(((totales.roasMeta - totales.roasReal) / totales.roasReal) * 100, 0)}%`
              : '—'}
          </div>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <div className="text-2xl font-semibold">{formatPrecio(totales.spendB2C)}</div>
          <div className="text-xs text-muted mt-0.5">Gasto B2C</div>
          <div className="text-[10px] text-faint mt-1">
            {totales.spendB2B > 0 ? `+ ${formatPrecio(totales.spendB2B)} en B2B` : 'sin gasto B2B en el período'}
          </div>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <div className="text-2xl font-semibold">{formatPrecio(totales.ventas)}</div>
          <div className="text-xs text-muted mt-0.5">Ventas reales</div>
          <div className="text-[10px] text-faint mt-1">{totales.pedidos} pedidos en la tienda</div>
        </div>
      </div>

      {sinClasificar > 0 && (
        <div className="border border-[#C8A96E] bg-[#FBF7EE] rounded-lg p-3 text-sm">
          Hay <b>{sinClasificar}</b> campaña{sinClasificar !== 1 ? 's' : ''} sin clasificar. Marcá cuáles son B2B en la
          tabla de abajo: mientras tanto se las cuenta como B2C y su gasto se divide contra las ventas de la tienda, lo
          que <b>subestima el ROAS</b> si en realidad son de prospección.
        </div>
      )}

      {/* ---- Histórico ---- */}
      <RoasChart dias={dias} roasObjetivo={cfg?.roas_objetivo} breakEven={cfg?.break_even_roas} />

      {/* ---- Gasto vs Ventas ---- */}
      <GastoVentasChart dias={dias} />

      {/* ---- Visitas, conversiones e inversión ---- */}
      <VisitasConversionesChart insights={insights} />

      {/* ---- Ganadores y perdedores ---- */}
      <RankingProductos insights={insights} />

      {/* ---- Ecualizador ---- */}
      {cfg && (
        <div className="bg-white border border-black/10 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold">🎛 Ecualizador del motor</h2>
              <p className="text-[11px] text-muted mt-0.5">
                Movés los valores y la columna “Qué haría el motor” se recalcula al instante. No ejecuta nada.
              </p>
            </div>
            <button
              onClick={guardarConfig}
              disabled={guardando}
              className="px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar parámetros'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Control
              label="Break-even ROAS"
              ayuda="Debajo de esto perdés plata. Sale de tu margen: margen 60% → 1.67"
              valor={cfg.break_even_roas}
              min={0.5}
              max={5}
              step={0.05}
              onChange={(v) => setCfgCampo('break_even_roas', v)}
            />
            <Control
              label="ROAS objetivo"
              ayuda="A partir de acá conviene meterle más presupuesto"
              valor={cfg.roas_objetivo}
              min={1}
              max={10}
              step={0.1}
              onChange={(v) => setCfgCampo('roas_objetivo', v)}
            />
            <Control
              label="CPA máximo"
              ayuda="Costo por venta que ya no tolerás"
              valor={cfg.cpa_max}
              min={5000}
              max={300000}
              step={5000}
              formato={formatPrecio}
              onChange={(v) => setCfgCampo('cpa_max', v)}
            />
            <Control
              label="Mínimo de conversiones"
              ayuda="Guarda anti-ruido: sin esta cantidad en la ventana, el motor no opina"
              valor={cfg.min_conversiones}
              min={1}
              max={30}
              step={1}
              dec={0}
              onChange={(v) => setCfgCampo('min_conversiones', v)}
            />
            <Control
              label="Ventana de análisis (días)"
              ayuda="Cuántos días mira para decidir"
              valor={cfg.ventana_dias}
              min={1}
              max={7}
              step={1}
              dec={0}
              onChange={(v) => setCfgCampo('ventana_dias', v)}
            />
            <Control
              label="Frecuencia de fatiga"
              ayuda="Arriba de esto el creativo se quema y hay que refrescarlo"
              valor={cfg.freq_fatiga}
              min={1.5}
              max={6}
              step={0.1}
              onChange={(v) => setCfgCampo('freq_fatiga', v)}
            />
          </div>

          <div className="border-t border-black/5 pt-3">
            <label className="flex items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={autoFactor}
                onChange={(e) => setAutoFactor(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <b className="text-ink">Corregir el sesgo de Meta automáticamente</b> — factor{' '}
                <b className="text-ink">{fmt(factorEfectivo)}</b>. Meta se atribuye ventas que no causó; este factor
                ajusta el ROAS por campaña usando la diferencia real del período. Sin esto, el motor decidiría con el
                número inflado.
                <br />
                <span className="text-faint">
                  Lo correcto de verdad es medir por campaña con UTMs — esto es una aproximación honesta mientras tanto.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ---- Campañas como posiciones ---- */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Campañas · ventana de {cfg?.ventana_dias} día{cfg?.ventana_dias !== 1 ? 's' : ''}</h2>
        <div className="border border-black/10 rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#F1EDE4]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Campaña</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Tipo</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Gasto</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Conv.</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">CPA</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">ROAS</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">CTR</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Frec.</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Qué haría el motor</th>
              </tr>
            </thead>
            <tbody>
              {posiciones.map((p) => (
                <tr key={p.id} className="border-t border-black/5 align-top hover:bg-[#F1EDE4]/50 transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.nombre}</div>
                    <div className="text-[10px] text-faint">{p.ads.size} anuncios</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.tipo}
                      onChange={(e) => cambiarTipo(p.id, e.target.value as CampanaCfg['tipo'])}
                      className={`text-xs rounded-lg border px-2 py-1 ${
                        p.tipo === 'sin_clasificar' ? 'border-[#C8A96E] bg-[#FBF7EE]' : 'border-black/10 bg-white'
                      }`}
                    >
                      {Object.entries(TIPO_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatPrecio(p.spend)}</td>
                  <td className="px-3 py-2 text-right">{p.conv}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{p.cpa ? formatPrecio(p.cpa) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(p.roas)}</td>
                  <td className="px-3 py-2 text-right">{p.ctr ? fmt(p.ctr, 1) + '%' : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.freqMax, 1)}</td>
                  <td className="px-3 py-2 min-w-[260px]">
                    <span
                      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        p.tono === 'ok'
                          ? 'bg-emerald-50 text-emerald-700'
                          : p.tono === 'peligro'
                            ? 'bg-red-50 text-red-700'
                            : p.tono === 'alerta'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-black/5 text-muted'
                      }`}
                    >
                      {p.sugerencia === 'sin_accion'
                        ? 'sin acción'
                        : p.sugerencia.startsWith('subir_budget')
                          ? `↑ subir ${cfg?.max_cambio_pct}%`
                          : p.sugerencia === 'pausar'
                            ? '⏸ pausar'
                            : '🔄 refrescar creativo'}
                    </span>
                    <div className="text-[11px] text-muted mt-1">{p.motivo}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Día por día ---- */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Día por día — ROAS real vs lo que reporta Meta</h2>
        <div className="border border-black/10 rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#F1EDE4]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Día</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Gasto B2C</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Ventas reales</th>
                <th className="px-3 py-2 text-right font-semibold">Pedidos</th>
                <th className="px-3 py-2 text-right font-semibold">ROAS real</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">ROAS Meta</th>
                <th className="px-3 py-2 text-right font-semibold">Gap</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const real = d.roas_real === null ? null : Number(d.roas_real)
                const meta = d.roas_meta === null ? null : Number(d.roas_meta)
                const gap = real !== null && meta !== null && real > 0 ? ((meta - real) / real) * 100 : null
                const sinVentas = d.pedidos_shopify === 0
                return (
                  <tr
                    key={d.fecha}
                    className={`border-t border-black/5 transition-colors hover:bg-[#F1EDE4]/50 ${sinVentas ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {diaCorto(d.fecha)}
                      {sinVentas && <span className="text-[10px] text-faint ml-1">(en curso)</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatPrecio(Number(d.spend_b2c || d.spend_meta))}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatPrecio(Number(d.ventas_shopify_linea) + Number(d.ventas_shopify_outlet))}
                    </td>
                    <td className="px-3 py-2 text-right">{d.pedidos_shopify}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(real)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{fmt(meta)}</td>
                    <td className="px-3 py-2 text-right">
                      {gap !== null ? (
                        <span className={gap > 25 ? 'text-red-600 font-medium' : 'text-muted'}>+{fmt(gap, 0)}%</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-faint">
          El “gap” es cuánto se cuelga Meta por encima de las ventas reales de tu base. Los días en curso (sin ventas
          cargadas todavía) van en gris y no cuentan para los totales.
        </p>
      </div>

      {/* ---- Bibliotecas de anuncios ---- */}
      <BibliotecasAnuncios />
    </div>
  )
}

function Control({
  label,
  ayuda,
  valor,
  min,
  max,
  step,
  dec = 2,
  formato,
  onChange,
}: {
  label: string
  ayuda: string
  valor: number
  min: number
  max: number
  step: number
  dec?: number
  formato?: (n: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink">{label}</span>
        <span className="text-sm font-semibold text-brandDark tabular-nums">
          {formato ? formato(valor) : Number(valor).toFixed(dec)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 accent-[#C8A96E]"
      />
      <span className="block text-[10px] text-faint mt-0.5">{ayuda}</span>
    </label>
  )
}
