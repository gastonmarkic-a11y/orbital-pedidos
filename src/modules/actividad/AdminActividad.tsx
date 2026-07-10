import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { Actividad, ObjetivoMes, Propuesta, Vendedor } from '../../lib/types'
import { monthKey } from '../../lib/dates'
import { clasificarVoz } from './voz'
import ProgressBar from './ProgressBar'
import { useAuth } from '../../lib/auth'

interface FilaVendedor {
  codigo: string
  nombre: string
  esProspeccion: boolean
  metricas: { label: string; real: number; objetivo: number }[]
  vencidos: number
}

/** Códigos que forman el equipo de Prospección (Luna + Damián) */
const PROSPECCION = ['Marketing', 'ProspeccionVenta', 'Damian']

export default function AdminActividad() {
  const { rolEfectivo } = useAuth()
  const [filas, setFilas] = useState<FilaVendedor[]>([])
  const [temas, setTemas] = useState<{ label: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const mes = monthKey()
    const hoy = new Date().toISOString().slice(0, 10)
    async function cargar() {
      const [{ data: vend }, { data: objs }, { data: props }] = await Promise.all([
        supabase.from('vendedores').select('*').eq('activo', true),
        supabase.from('objetivos_mes').select('*').eq('mes_anio', mes),
        supabase.from('propuestas_julio').select('*'),
      ])
      const acts = await fetchPaged<Actividad>(() =>
        supabase.from('actividad_diaria').select('*').gte('fecha', `${mes}-01`).order('id')
      )
      const notas = await fetchPaged<{ voz_cliente_nota: string | null }>(() =>
        supabase.from('actividad_diaria').select('voz_cliente_nota').not('voz_cliente_nota', 'is', null).order('id')
      )
      const objetivos = (objs as ObjetivoMes[]) ?? []
      const propuestas = (props as Propuesta[]) ?? []
      // Propuestas válidas para prospección: Bienvenida, Plan Canje o Preventa
      const propValidas = new Set(
        propuestas.filter((p) => /bienvenida|canje|preventa/i.test(p.nombre)).map((p) => p.id)
      )

      const rows: FilaVendedor[] = []

      // Vendedores de campo (Adrián y Martín): objetivos de julio como estaban
      const campo = ((vend as Vendedor[]) ?? []).filter(
        (v) => v.rol === 'vendedor' && !PROSPECCION.includes(v.codigo) && v.codigo !== 'Corporativo'
      )
      for (const v of campo) {
        const actos = acts.filter((a) => a.vendedor === v.codigo)
        const obj = objetivos.find((o) => o.vendedor === v.codigo)
        const { count } = await supabase
          .from('clientes')
          .select('cod', { count: 'exact', head: true })
          .eq('vendedor_asignado', v.codigo)
          .lt('proxima_agenda_fecha', hoy)
        rows.push({
          codigo: v.codigo,
          nombre: v.nombre,
          esProspeccion: false,
          vencidos: count ?? 0,
          metricas: [
            {
              label: 'Contactos trabajados',
              real: new Set(actos.map((a) => a.cod_cliente).filter(Boolean)).size,
              objetivo: obj?.objetivo_contactos ?? 0,
            },
            {
              label: 'Propuestas enviadas',
              real: actos.filter((a) => a.propuesta_enviada_id).length,
              objetivo: obj?.objetivo_propuestas ?? 0,
            },
            {
              label: 'Ventas cerradas',
              real: actos.filter((a) => (a.unidades_vendidas ?? 0) > 0).length,
              objetivo: obj?.objetivo_ventas ?? 0,
            },
          ],
        })
      }

      // Prospección (Luna + Damián): objetivos propios
      const actosProsp = acts.filter((a) => a.vendedor && PROSPECCION.includes(a.vendedor))
      const objProsp = objetivos.find((o) => o.vendedor === 'Marketing')
      const { count: vencProsp } = await supabase
        .from('clientes')
        .select('cod', { count: 'exact', head: true })
        .eq('vendedor_asignado', 'Marketing')
        .lt('proxima_agenda_fecha', hoy)
      rows.push({
        codigo: 'Marketing',
        nombre: 'Prospección (Luna + Damián)',
        esProspeccion: true,
        vencidos: vencProsp ?? 0,
        metricas: [
          {
            label: 'Propuestas válidas (Bienvenida / Canje / Preventa)',
            real: actosProsp.filter((a) => a.propuesta_enviada_id && propValidas.has(a.propuesta_enviada_id)).length,
            objetivo: objProsp?.objetivo_propuestas ?? 300,
          },
          {
            label: 'Reuniones coordinadas (derivadas a vendedor)',
            real: actosProsp.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Derivado a ')).length,
            objetivo: objProsp?.objetivo_contactos ?? 24,
          },
          {
            label: 'Cierres telefónicos (venta directa)',
            real: actosProsp.filter((a) => (a.actividad_desarrollo ?? '').startsWith('Venta directa cerrada')).length,
            objetivo: objProsp?.objetivo_ventas ?? 18,
          },
        ],
      })

      setFilas(rows)

      const porTema: Record<string, number> = {}
      for (const n of notas) {
        const t = clasificarVoz(n.voz_cliente_nota)
        if (t) porTema[t.label] = (porTema[t.label] ?? 0) + 1
      }
      setTemas(
        Object.entries(porTema)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count)
      )
      setLoading(false)
    }
    cargar()
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando tablero del equipo...</p>

  const maxTema = Math.max(...temas.map((t) => t.count), 1)

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">📊 Equipo · {monthKey()}</h2>
        {rolEfectivo === 'admin' && (
          <Link to="/actividad-admin/marketing" className="text-xs font-medium text-brandDark">
            Gestionar piezas de marketing →
          </Link>
        )}
      </div>

      {filas.map((f) => (
        <div key={f.codigo} className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">
              {f.esProspeccion ? '📞 ' : '🧳 '}
              {f.nombre}
            </p>
            {f.vencidos > 0 && (
              <span className="text-[10px] bg-red-50 text-red-700 rounded-full px-2 py-0.5">{f.vencidos} vencidos</span>
            )}
          </div>
          {f.metricas.map((m) => (
            <ProgressBar key={m.label} label={m.label} real={m.real} objetivo={m.objetivo} />
          ))}
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
