import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'

export default function Clientes() {
  const toast = useToast()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [detalle, setDetalle] = useState<Cliente | null>(null)
  const [nuevoAbierto, setNuevoAbierto] = useState(false)
  const [nuevo, setNuevo] = useState({
    cod: '', razon: '', nomcomerc: '', cuit: '', direccion: '', localidad: '', telefono: '', email: '', contacto: '', nro_lista: '5', nota: '',
  })
  const [pendientes, setPendientes] = useState<Cliente[]>([])
  const [recargaPend, setRecargaPend] = useState(0)

  useEffect(() => {
    supabase
      .from('clientes')
      .select('*')
      .like('cod', 'TMP-%')
      .order('actualizado_en', { ascending: false })
      .then(({ data }) => setPendientes((data as Cliente[]) ?? []))
  }, [recargaPend])

  async function asignarCodigo(c: Cliente) {
    const nuevoCod = window.prompt(
      `Código de cliente definitivo para "${c.nomcomerc || c.razon}" (provisorio ${c.cod}):`
    )
    if (!nuevoCod || !nuevoCod.trim()) return
    const cod = nuevoCod.trim()
    const { error } = await supabase.from('clientes').update({ cod }).eq('cod', c.cod)
    if (error) {
      toast(error.code === '23505' ? 'Ese código ya existe' : 'Error al asignar el código', 'error')
      return
    }
    await supabase.from('actividad_diaria').update({ cod_cliente: cod }).eq('cod_cliente', c.cod)
    await supabase.from('pedidos').update({ cod_cliente: cod }).eq('cod_cliente', c.cod)
    await supabase
      .from('clientes')
      .update({ nota: (c.nota ?? '').replace('⏳ Código de cliente pendiente de validación por Administración.', '').trim() || null })
      .eq('cod', cod)
    toast(`✓ Código ${cod} asignado`, 'success')
    setRecargaPend((r) => r + 1)
  }


  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      const q = busqueda.trim()
      let query = supabase.from('clientes').select('*').order('razon').limit(20)
      if (q) query = supabase.from('clientes').select('*').or(`cod.ilike.%${q}%,razon.ilike.%${q}%,cuit.ilike.%${q}%,nomcomerc.ilike.%${q}%`).order('razon').limit(20)
      const { data } = await query
      setClientes((data as Cliente[]) ?? [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  async function guardarNuevo() {
    if (!nuevo.cod.trim() || !nuevo.razon.trim() || !nuevo.cuit.trim()) {
      toast('Código, Razón Social y CUIT son obligatorios', 'error')
      return
    }
    const { error } = await supabase.from('clientes').insert({
      cod: nuevo.cod.trim(),
      razon: nuevo.razon.trim(),
      nomcomerc: nuevo.nomcomerc.trim() || null,
      cuit: nuevo.cuit.trim(),
      direccion: nuevo.direccion.trim() || null,
      localidad: nuevo.localidad.trim() || null,
      telefono: nuevo.telefono.trim() || null,
      email: nuevo.email.trim() || null,
      contacto: nuevo.contacto.trim() || null,
      nro_lista: parseInt(nuevo.nro_lista) || 5,
      nota: nuevo.nota.trim() || null,
    })
    if (error) {
      toast(error.code === '23505' ? 'Ese código de cliente ya existe' : 'Error al guardar el cliente', 'error')
      return
    }
    toast(`✓ Cliente "${nuevo.razon}" agregado`, 'success')
    setNuevoAbierto(false)
    setNuevo({ cod: '', razon: '', nomcomerc: '', cuit: '', direccion: '', localidad: '', telefono: '', email: '', contacto: '', nro_lista: '5', nota: '' })
    setBusqueda(nuevo.razon)
  }

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">👥 Clientes</h2>
        <button onClick={() => setNuevoAbierto(true)} className="text-xs font-medium bg-emerald-600 text-white rounded-lg px-3 py-1.5">
          + Nuevo cliente
        </button>
      </div>

      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            ⏳ Prospectos pendientes de código ({pendientes.length})
          </p>
          {pendientes.map((c) => (
            <div key={c.cod} className="flex items-center justify-between gap-2 bg-white rounded-lg border border-black/10 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.nomcomerc || c.razon}</p>
                <p className="text-xs text-faint">
                  {c.cod} · {c.localidad || '—'} · cargado por {c.vendedor_asignado || '—'}
                </p>
              </div>
              <button
                onClick={() => asignarCodigo(c)}
                className="text-xs font-semibold bg-amber-500 text-white rounded-lg px-3 py-1.5 shrink-0"
              >
                Asignar código
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        placeholder="Buscar por código, razón social, CUIT o nombre comercial..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
      />

      {loading ? (
        <p className="text-sm text-muted p-4">Cargando...</p>
      ) : clientes.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Sin resultados</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
          <table className="w-full min-w-[680px] text-sm border-collapse">
            <thead className="bg-ink text-white">
              <tr>
                {['Código', 'Razón social', 'CUIT', 'Localidad', 'Teléfono', 'Lista'].map((h) => (
                  <th key={h} className="text-left text-[10px] uppercase font-semibold px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c, i) => (
                <tr
                  key={c.cod}
                  onClick={() => setDetalle(c)}
                  className={`cursor-pointer border-t border-black/5 hover:bg-[#f7f7fa] ${i % 2 === 0 ? 'bg-[#fafafa]' : ''}`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-muted">{c.cod}</td>
                  <td className="px-3 py-2 font-semibold">{c.razon || ''}</td>
                  <td className="px-3 py-2 text-muted">{c.cuit || '—'}</td>
                  <td className="px-3 py-2 text-muted">{c.localidad || '—'}</td>
                  <td className="px-3 py-2 text-muted">{c.telefono || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5 text-[10px] font-bold">
                      L{c.nro_lista ?? 5}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-faint text-center">
        Mostrando {clientes.length} clientes{busqueda.trim() ? ` para "${busqueda.trim()}"` : ' (los primeros 20 — usá el buscador)'}
      </p>

      {detalle && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetalle(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">👥 {detalle.razon}</p>
              <button onClick={() => setDetalle(null)} className="text-sm text-muted">
                ✕
              </button>
            </div>
            <div className="space-y-1.5 text-sm">
              {(
                [
                  ['Código', detalle.cod],
                  ['Nombre comercial', detalle.nomcomerc],
                  ['CUIT', detalle.cuit],
                  ['Localidad', detalle.localidad],
                  ['Dirección', detalle.direccion],
                  ['Teléfono', detalle.telefono],
                  ['Mail', detalle.email],
                  ['Contacto', detalle.contacto],
                  ['Lista', `L${detalle.nro_lista ?? 5}`],
                  ['Vendedor asignado', detalle.vendedor_asignado],
                  ['Nota', detalle.nota],
                ] as const
              ).map(([label, val]) => (
                <p key={label}>
                  <span className="text-xs text-faint uppercase font-semibold">{label}:</span> {val || '—'}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {nuevoAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNuevoAbierto(false)}>
          <div
            className="bg-white rounded-2xl border border-black/10 w-full max-w-lg p-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold mb-2">+ Nuevo cliente</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['cod', 'Código *'],
                  ['razon', 'Razón social *'],
                  ['nomcomerc', 'Nombre comercial'],
                  ['cuit', 'CUIT *'],
                  ['direccion', 'Dirección'],
                  ['localidad', 'Localidad'],
                  ['telefono', 'Teléfono'],
                  ['email', 'Mail'],
                  ['contacto', 'Contacto'],
                  ['nro_lista', 'Lista de precios'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={`block text-xs text-muted ${key === 'direccion' ? 'col-span-2' : ''}`}>
                  {label}
                  <input
                    type={key === 'nro_lista' ? 'number' : 'text'}
                    value={nuevo[key]}
                    onChange={(e) => setNuevo({ ...nuevo, [key]: e.target.value })}
                    className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              ))}
              <label className="block text-xs text-muted col-span-2">
                Observaciones / Notas contables
                <input
                  value={nuevo.nota}
                  onChange={(e) => setNuevo({ ...nuevo, nota: e.target.value })}
                  placeholder="Ej: Pago cheque 30 días, retención 2%"
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
                />
              </label>
            </div>
            <div className="flex gap-2 pt-3">
              <button onClick={() => setNuevoAbierto(false)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button onClick={guardarNuevo} className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold">
                + Guardar Cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
