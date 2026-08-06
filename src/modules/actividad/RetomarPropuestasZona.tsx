import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { monthKey } from '../../lib/dates'

// Foco de agenda para el prospector: llamar a quienes recibieron propuesta el mes pasado
// y todavía no contactó este mes, para coordinar reunión o cerrar venta directa telefónica.
// Los contactos se administran agrupados por ZONA.

const MAPA: Record<string, { codigos: string[]; nombre: string }> = {
  Marketing: { codigos: ['Marketing'], nombre: 'Luna' },
  Damian: { codigos: ['ProspeccionVenta', 'Damian'], nombre: 'Damián' },
}

interface Pend {
  cod: string
  nombre: string
  zona: string
  tel: string | null
}

function waLink(tel: string | null): string | null {
  if (!tel) return null
  let d = tel.replace(/\D/g, '')
  if (!d) return null
  if (!d.startsWith('54')) d = '54' + d.replace(/^0/, '')
  return `https://wa.me/${d}`
}

export default function RetomarPropuestasZona({ codigoEfectivo }: { codigoEfectivo: string }) {
  const info = MAPA[codigoEfectivo]
  const [porZona, setPorZona] = useState<{ zona: string; clientes: Pend[] }[]>([])
  const [total, setTotal] = useState(0)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!info) return
    let cancel = false
    ;(async () => {
      const mes = monthKey()
      const [y, m] = mes.split('-').map(Number)
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      const desde = `${py}-${String(pm).padStart(2, '0')}-01`
      const hasta = `${mes}-01`

      const { data: props } = await supabase.from('propuestas_julio').select('id, nombre')
      const validas = new Set(
        ((props ?? []) as { id: number; nombre: string }[]).filter((p) => /bienvenida|canje|preventa/i.test(p.nombre)).map((p) => p.id)
      )
      const [{ data: lm }, { data: tm }] = await Promise.all([
        supabase.from('actividad_diaria').select('cod_cliente, propuesta_enviada_id').in('vendedor', info.codigos).gte('fecha', desde).lt('fecha', hasta),
        supabase.from('actividad_diaria').select('cod_cliente').in('vendedor', info.codigos).gte('fecha', `${mes}-01`),
      ])
      const pendSet = new Set<string>()
      for (const a of (lm ?? []) as { cod_cliente: string | null; propuesta_enviada_id: number | null }[])
        if (a.cod_cliente && a.propuesta_enviada_id && validas.has(a.propuesta_enviada_id)) pendSet.add(a.cod_cliente)
      const touched = new Set(((tm ?? []) as { cod_cliente: string | null }[]).map((a) => a.cod_cliente).filter(Boolean))
      const pend = [...pendSet].filter((c) => !touched.has(c))
      if (!pend.length) {
        if (!cancel) { setPorZona([]); setCargado(true) }
        return
      }
      const detalles = new Map<string, Pend>()
      for (let i = 0; i < pend.length; i += 300) {
        const { data } = await supabase
          .from('clientes')
          .select('cod, nomcomerc, razon, zona, localidad, whatsapp, telefono')
          .in('cod', pend.slice(i, i + 300))
        for (const c of (data ?? []) as { cod: string; nomcomerc: string | null; razon: string | null; zona: string | null; localidad: string | null; whatsapp: string | null; telefono: string | null }[])
          detalles.set(c.cod, { cod: c.cod, nombre: c.nomcomerc || c.razon || c.cod, zona: c.zona || c.localidad || 'Sin zona', tel: c.whatsapp || c.telefono })
      }
      const grupos = new Map<string, Pend[]>()
      for (const p of detalles.values()) {
        if (!grupos.has(p.zona)) grupos.set(p.zona, [])
        grupos.get(p.zona)!.push(p)
      }
      const arr = [...grupos.entries()]
        .map(([zona, clientes]) => ({ zona, clientes: clientes.sort((a, b) => a.nombre.localeCompare(b.nombre)) }))
        .sort((a, b) => b.clientes.length - a.clientes.length)
      if (!cancel) {
        setPorZona(arr)
        setTotal(detalles.size)
        setCargado(true)
      }
    })()
    return () => {
      cancel = true
    }
  }, [codigoEfectivo])

  if (!info || !cargado || total === 0) return null

  return (
    <div className="rounded-xl border border-brand/30 p-4" style={{ background: 'linear-gradient(160deg,#FBF8F1,#F3ECDD)' }}>
      <p className="text-sm font-semibold text-ink">📞 Foco: retomar propuestas del mes pasado ({total})</p>
      <p className="text-[11px] text-faint mb-3">
        Llamá a quienes recibieron propuesta el mes pasado y todavía no contactaste este mes — para coordinar reunión o
        cerrar venta telefónica. Están agrupados por zona para que los trabajes de una.
      </p>
      <div className="space-y-3">
        {porZona.map((g) => (
          <div key={g.zona}>
            <p className="text-[10px] uppercase text-brandDark font-semibold mb-1">📍 {g.zona} ({g.clientes.length})</p>
            <div className="space-y-1">
              {g.clientes.map((c) => {
                const wa = waLink(c.tel)
                return (
                  <div key={c.cod} className="flex items-center justify-between gap-2 text-sm border-l-2 border-brand/40 pl-2.5">
                    <span className="truncate">
                      {c.nombre}
                      {c.tel && <span className="text-faint text-[11px]"> · {c.tel}</span>}
                    </span>
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-emerald-700 whitespace-nowrap">
                        💬 Llamar →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
