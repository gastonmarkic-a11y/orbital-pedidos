import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Actividad, ObjetivoMes } from '../../lib/types'
import { monthKey, habilesTranscurridos, habilesDelMes } from '../../lib/dates'
import { clasificarVoz } from './voz'
import ProgressBar from './ProgressBar'

export default function MisResultados() {
  const { vendedor, codigoEfectivo } = useAuth()
  const [objetivo, setObjetivo] = useState<ObjetivoMes | null>(null)
  const [acts, setActs] = useState<Actividad[]>([])
  const [vencidos, setVencidos] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!vendedor) return
    const mes = monthKey()
    Promise.all([
      supabase.from('objetivos_mes').select('*').eq('vendedor', codigoEfectivo).eq('mes_anio', mes).maybeSingle(),
      supabase.from('actividad_diaria').select('*').eq('vendedor', codigoEfectivo).gte('fecha', `${mes}-01`),
      supabase
        .from('clientes')
        .select('cod', { count: 'exact', head: true })
        .eq('vendedor_asignado', codigoEfectivo)
        .lt('proxima_agenda_fecha', new Date().toISOString().slice(0, 10)),
    ]).then(([obj, act, venc]) => {
      setObjetivo(obj.data as ObjetivoMes | null)
      setActs((act.data as Actividad[]) ?? [])
      setVencidos(venc.count ?? 0)
      setLoading(false)
    })
  }, [vendedor, codigoEfectivo])

  if (loading) return <p className="text-sm text-muted p-4">Cargando resultados...</p>

  const contactos = new Set(acts.map((a) => a.cod_cliente).filter(Boolean)).size
  const propuestas = acts.filter((a) => a.propuesta_enviada_id).length
  const ventas = acts.filter((a) => (a.unidades_vendidas ?? 0) > 0).length
  const habilesT = habilesTranscurridos()
  const habilesM = habilesDelMes()
  const proyPropuestas = habilesM > 0 ? Math.round((propuestas / Math.max(habilesT, 1)) * habilesM) : 0
  const proyVentas = habilesM > 0 ? Math.round((ventas / Math.max(habilesT, 1)) * habilesM) : 0

  const porPropuesta: Record<string, number> = {}
  for (const a of acts) {
    if (!a.propuesta_enviada_id) continue
    const k = String(a.propuesta_enviada_id)
    porPropuesta[k] = (porPropuesta[k] ?? 0) + 1
  }

  const voces = acts
    .filter((a) => a.voz_cliente_nota)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 15)

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">Mis Resultados · {monthKey()}</h2>

      {vencidos > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
          ⚠ Tenés {vencidos} contactos con fecha de agenda vencida sin actividad nueva.
        </div>
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
        <ProgressBar label="Contactos trabajados" real={contactos} objetivo={objetivo?.objetivo_contactos ?? 0} />
        <ProgressBar label="Propuestas enviadas" real={propuestas} objetivo={objetivo?.objetivo_propuestas ?? 0} />
        <ProgressBar label="Ventas cerradas" real={ventas} objetivo={objetivo?.objetivo_ventas ?? 0} />
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-2">Proyección al ritmo actual</p>
        <p className="text-xs text-faint">
          Día hábil {habilesT} de {habilesM} del mes.
        </p>
        <p className="text-sm text-ink mt-1">
          Propuestas proyectadas: <b>{proyPropuestas}</b>{' '}
          {objetivo && (proyPropuestas >= (objetivo.objetivo_propuestas ?? 0) ? '✅ en línea' : '⚠ por debajo del objetivo')}
        </p>
        <p className="text-sm text-ink">
          Ventas proyectadas: <b>{proyVentas}</b>{' '}
          {objetivo && (proyVentas >= (objetivo.objetivo_ventas ?? 0) ? '✅ en línea' : '⚠ por debajo del objetivo')}
        </p>
      </div>

      {Object.keys(porPropuesta).length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted mb-2">Por tipo de propuesta</p>
          {Object.entries(porPropuesta).map(([id, n]) => (
            <p key={id} className="text-sm text-ink">
              Propuesta #{id}: {n}
            </p>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted mb-1">La voz del cliente este mes</p>
        <p className="text-[11px] text-faint mb-3">
          Lo que dijeron los clientes en cada contacto, para leer entre los números.
        </p>
        {voces.length === 0 ? (
          <p className="text-sm text-faint">Todavía no cargaste notas de clientes este mes.</p>
        ) : (
          <div className="space-y-2">
            {voces.map((a) => {
              const tema = clasificarVoz(a.voz_cliente_nota)
              return (
                <div key={a.id} className="border-l-2 border-brand/30 pl-3">
                  <p className="text-xs text-faint">
                    {new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ·{' '}
                    {a.nombre_comercio}
                  </p>
                  <p className="text-sm text-ink">📝 {a.voz_cliente_nota}</p>
                  {tema && (
                    <span className="inline-block mt-1 text-[10px] text-brandDark bg-brand/10 rounded-full px-2 py-0.5">
                      {tema.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
