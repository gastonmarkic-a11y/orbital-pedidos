import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'
import { ymd, mondayOfWeek, sundayOfWeek } from '../../lib/dates'

export default function AgendaDelDia() {
  const { vendedor, rolEfectivo, codigoEfectivo } = useAuth()
  const navigate = useNavigate()
  const esAdmin = rolEfectivo === 'admin'
  const [modo, setModo] = useState<'hoy' | 'semana'>('hoy')
  const [agendados, setAgendados] = useState<Cliente[]>([])
  const [vencidos, setVencidos] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [editCod, setEditCod] = useState<string | null>(null)
  const [ed, setEd] = useState({ contacto: '', telefono: '', email: '' })
  const [edSaving, setEdSaving] = useState(false)

  function empezarEdicion(c: Cliente) {
    setEditCod(c.cod)
    setEd({ contacto: c.contacto ?? '', telefono: c.whatsapp ?? c.telefono ?? '', email: c.email ?? '' })
  }

  async function guardarDatos(c: Cliente) {
    setEdSaving(true)
    const cambios = {
      contacto: ed.contacto.trim() || null,
      whatsapp: ed.telefono.trim() || null,
      telefono: ed.telefono.trim() || c.telefono,
      email: ed.email.trim() || null,
    }
    const { error } = await supabase.from('clientes').update(cambios).eq('cod', c.cod)
    setEdSaving(false)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    const aplicar = (lista: Cliente[]) => lista.map((x) => (x.cod === c.cod ? { ...x, ...cambios } : x))
    setAgendados(aplicar)
    setVencidos(aplicar)
    setEditCod(null)
    toast('✓ Datos de contacto guardados', 'success')
  }

  useEffect(() => {
    if (!vendedor) return
    const codigo = codigoEfectivo
    setLoading(true)
    const hoy = ymd(new Date())
    const desde = modo === 'hoy' ? hoy : ymd(mondayOfWeek())
    const hasta = modo === 'hoy' ? hoy : ymd(sundayOfWeek())

    function base() {
      let q = supabase.from('clientes').select('*')
      if (!esAdmin) q = q.eq('vendedor_asignado', codigo)
      return q
    }

    Promise.all([
      base().gte('proxima_agenda_fecha', desde).lte('proxima_agenda_fecha', hasta).order('proxima_agenda_fecha'),
      base().lt('proxima_agenda_fecha', hoy),
    ]).then(([a, v]) => {
      setAgendados((a.data as Cliente[]) ?? [])
      setVencidos((v.data as Cliente[]) ?? [])
      setLoading(false)
    })
  }, [vendedor, esAdmin, modo, codigoEfectivo])

  function cargar(c: Cliente) {
    navigate('/cargar', { state: { cliente: c } })
  }

  const hace7 = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return ymd(d)
  })()
  const vencidosRecientes = vencidos.filter((c) => (c.proxima_agenda_fecha ?? '') >= hace7)
  const vencidosViejos = vencidos.filter((c) => (c.proxima_agenda_fecha ?? '') < hace7)

  const fechaLabel = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const porFecha: Record<string, Cliente[]> = {}
  for (const c of agendados) {
    const k = c.proxima_agenda_fecha ?? '—'
    ;(porFecha[k] = porFecha[k] || []).push(c)
  }
  const fechas = Object.keys(porFecha).sort()

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Agenda del Día</h2>
          <p className="text-xs text-muted capitalize">{fechaLabel}</p>
        </div>
        <div className="flex gap-1 bg-white border border-black/10 rounded-lg p-0.5">
          <button
            onClick={() => setModo('hoy')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium ${modo === 'hoy' ? 'bg-brand text-white' : 'text-muted'}`}
          >
            Hoy
          </button>
          <button
            onClick={() => setModo('semana')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium ${modo === 'semana' ? 'bg-brand text-white' : 'text-muted'}`}
          >
            Esta semana
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted p-4">Cargando...</p>
      ) : (
        <>
          {vencidosRecientes.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
              ⚠ Tenés {vencidosRecientes.length} contactos con agenda vencida en los últimos 7 días sin actividad
              nueva.
            </div>
          )}
          {vencidosViejos.length > 0 && (
            <div className="bg-[#f7f7fa] border border-black/10 text-muted text-xs rounded-lg p-3">
              🗄 Además hay <b>{vencidosViejos.length}</b> agendas vencidas hace más de una semana (quedan como dato,
              no se listan acá — las encontrás en Cartera ordenando por "Última actividad").
            </div>
          )}
          <div className="space-y-4">
            {fechas.map((f) => (
              <div key={f}>
                {modo === 'semana' && (
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    {new Date(f + 'T00:00:00').toLocaleDateString('es-AR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {f === ymd(new Date()) && <span className="text-brandDark"> · hoy</span>}
                  </p>
                )}
                <div className="space-y-2">
                  {porFecha[f].map((c) => (
                    <div key={c.cod} className="bg-white border border-black/10 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{c.nomcomerc || c.razon}</p>
                          <p className="text-xs text-muted">
                            {c.zona ?? c.localidad}{' '}
                            {c.vendedor_asignado && esAdmin && <span>· {c.vendedor_asignado}</span>}
                          </p>
                        </div>
                        <button onClick={() => cargar(c)} className="text-xs font-medium text-brandDark whitespace-nowrap">
                          Cargar actividad →
                        </button>
                      </div>
                      {editCod === c.cod ? (
                        <div className="mt-2 space-y-1.5 bg-[#f7f7fa] rounded-lg p-2">
                          <input
                            value={ed.contacto}
                            onChange={(e) => setEd({ ...ed, contacto: e.target.value })}
                            placeholder="Nombre de contacto"
                            className="w-full bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint"
                          />
                          <input
                            value={ed.telefono}
                            onChange={(e) => setEd({ ...ed, telefono: e.target.value })}
                            placeholder="Teléfono / WhatsApp"
                            className="w-full bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint"
                          />
                          <input
                            value={ed.email}
                            onChange={(e) => setEd({ ...ed, email: e.target.value })}
                            placeholder="Mail"
                            type="email"
                            className="w-full bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => guardarDatos(c)}
                              disabled={edSaving}
                              className="flex-1 rounded-lg bg-brand text-white py-1.5 text-xs font-medium disabled:opacity-50"
                            >
                              {edSaving ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button
                              onClick={() => setEditCod(null)}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-muted"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted mt-1.5">
                          👤 {c.contacto || '—'} · 📞 {c.whatsapp || c.telefono || '—'} · ✉️ {c.email || '—'}{' '}
                          <button onClick={() => empezarEdicion(c)} className="text-brandDark font-medium ml-1">
                            ✏️ Editar
                          </button>
                        </p>
                      )}
                      {c.proximo_paso && <p className="text-xs text-ink mt-2">➡ {c.proximo_paso}</p>}
                      {c.nota && <p className="text-xs text-muted mt-1">📝 {c.nota}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {agendados.length === 0 && (
              <p className="text-sm text-faint text-center py-10">
                No tenés nada agendado para {modo === 'hoy' ? 'hoy' : 'esta semana'}. Mirá "Cartera" para buscar a
                quién contactar.
              </p>
            )}
          </div>
          {vencidosRecientes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Vencidos (últimos 7 días)
              </p>
              <div className="space-y-2">
                {vencidosRecientes.map((c) => (
                  <div key={c.cod} className="bg-white border border-red-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{c.nomcomerc || c.razon}</p>
                        <p className="text-xs text-red-600">Agendado para {c.proxima_agenda_fecha}</p>
                      </div>
                      <button onClick={() => cargar(c)} className="text-xs font-medium text-brandDark whitespace-nowrap">
                        Cargar actividad →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
