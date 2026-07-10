import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Actividad, ObjetivoMes, Vendedor } from '../../lib/types'
import { monthKey } from '../../lib/dates'
import { clasificarVoz } from './voz'
import ProgressBar from './ProgressBar'

interface FilaVendedor {
  vendedor: Vendedor
  objetivo: ObjetivoMes | null
  contactosTrabajados: number
  propuestas: number
  ventas: number
  vencidos: number
}

export default function AdminActividad() {
  const [filas, setFilas] = useState<FilaVendedor[]>([])
  const [temas, setTemas] = useState<{ label: string; count: number; ejemplo: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const mes = monthKey()
    const hoy = new Date().toISOString().slice(0, 10)
    async function cargar() {
      const { data: vend } = await supabase.from('vendedores').select('*').eq('activo', true).neq('rol', 'admin')
      const vendedores = ((vend as Vendedor[]) ?? []).filter(
        (v) => v.codigo !== 'Corporativo' && v.rol === 'vendedor'
      )
      const { data: objs } = await supabase.from('objetivos_mes').select('*').eq('mes_anio', mes)
      const { data: acts } = await supabase.from('actividad_diaria').select('*').gte('fecha', `${mes}-01`)
      const { data: notas } = await supabase
        .from('actividad_diaria')
        .select('voz_cliente_nota')
        .not('voz_cliente_nota', 'is', null)

      const rows: FilaVendedor[] = []
      for (const v of vendedores) {
        const actos = ((acts as Actividad[]) ?? []).filter((a) => a.vendedor === v.codigo)
        const { count } = await supabase
          .from('clientes')
          .select('cod', { count: 'exact', head: true })
          .eq('vendedor_asignado', v.codigo)
          .lt('proxima_agenda_fecha', hoy)
        rows.push({
          vendedor: v,
          objetivo: ((objs as ObjetivoMes[]) ?? []).find((o) => o.vendedor === v.codigo) ?? null,
          contactosTrabajados: new Set(actos.map((a) => a.cod_cliente).filter(Boolean)).size,
          propuestas: actos.filter((a) => a.propuesta_enviada_id).length,
          ventas: actos.filter((a) => (a.unidades_vendidas ?? 0) > 0).length,
          vencidos: count ?? 0,
        })
      }
      setFilas(rows)

      const porTema: Record<string, { count: number; ejemplo: string }> = {}
      for (const n of (notas as { voz_cliente_nota: string | null }[]) ?? []) {
        const t = clasificarVoz(n.voz_cliente_nota)
        if (t) {
          if (!porTema[t.label]) porTema[t.label] = { count: 0, ejemplo: n.voz_cliente_nota ?? '' }
          porTema[t.label].count++
        }
      }
      setTemas(
        Object.entries(porTema)
          .map(([label, d]) => ({ label, count: d.count, ejemplo: d.ejemplo }))
          .sort((a, b) => b.count - a.count)
      )
      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando vista admin...</p>

  const maxTema = Math.max(...temas.map((t) => t.count), 1)

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Vista Admin · {monthKey()}</h2>
        <Link to="/actividad-admin/marketing" className="text-xs font-medium text-brandDark">
          Gestionar piezas de marketing →
        </Link>
      </div>

      {filas.map((f) => (
        <div key={f.vendedor.codigo} className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">{f.vendedor.nombre}</p>
            {f.vencidos > 0 && (
              <span className="text-[10px] bg-red-50 text-red-700 rounded-full px-2 py-0.5">{f.vencidos} vencidos</span>
            )}
          </div>
          <ProgressBar label="Contactos trabajados" real={f.contactosTrabajados} objetivo={f.objetivo?.objetivo_contactos ?? 0} />
          <ProgressBar label="Propuestas enviadas" real={f.propuestas} objetivo={f.objetivo?.objetivo_propuestas ?? 0} />
          <ProgressBar label="Ventas cerradas" real={f.ventas} objetivo={f.objetivo?.objetivo_ventas ?? 0} />
        </div>
      ))}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink mb-1">Voz del cliente — temas frecuentes</p>
        <p className="text-[11px] text-faint mb-3">
          Clasificación automática de lo que dicen los clientes en cada contacto, para detectar problemas o fortalezas.
        </p>
        {temas.length === 0 ? (
          <p className="text-sm text-faint">Todavía no hay suficientes notas de clientes clasificables.</p>
        ) : (
          <div className="space-y-2">
            {temas.map((t) => (
              <div key={t.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink font-medium">{t.label}</span>
                  <span className="text-faint">{t.count}</span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full bg-brand rounded-full" style={{ width: `${(t.count / maxTema) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
