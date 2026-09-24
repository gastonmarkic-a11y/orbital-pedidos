import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { StockIngreso } from '../../lib/types'
import { LectorCamara, limpiarCodigo, pitido } from '../../lib/lector'

// Ingreso de producción con cámara: depósito escanea todo lo que bajó, la Suite cuenta por SKU
// y lo compara con lo proyectado. Al confirmar usa confirmar_ingreso_parcial (el mismo de la
// carga a mano), repartiendo lo leído entre los proyectados de ese SKU del más viejo al más nuevo.
// Lo que no estaba proyectado NO entra al stock: queda listado para revisar.

type Fila = { codigo: string; modelo: string | null; descripcion: string | null; proyectado: number; ingresos: StockIngreso[] }

export default function IngresoEscaner({ ingresos, por, onCerrar, onHecho }: {
  ingresos: StockIngreso[]
  por: string | null
  onCerrar: () => void
  onHecho: () => void
}) {
  const toast = useToast()

  const filas = new Map<string, Fila>()
  for (const i of [...ingresos].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))) {
    const cod = i.codigo.toUpperCase()
    const f = filas.get(cod) ?? { codigo: cod, modelo: i.modelo, descripcion: i.descripcion, proyectado: 0, ingresos: [] }
    f.proyectado += i.cantidad
    f.ingresos.push(i)
    filas.set(cod, f)
  }

  const [leidos, setLeidos] = useState<Record<string, number>>({})
  const leidosRef = useRef(leidos)
  leidosRef.current = leidos
  const [camara, setCamara] = useState(true)
  const [manual, setManual] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  function fijar(cod: string, n: number) {
    const nuevo = { ...leidosRef.current }
    if (n > 0) nuevo[cod] = n
    else delete nuevo[cod]
    leidosRef.current = nuevo
    setLeidos(nuevo)
  }

  function leer(raw: string) {
    const cod = limpiarCodigo(raw)
    if (!cod) return
    const n = (leidosRef.current[cod] ?? 0) + 1
    fijar(cod, n)
    const f = filas.get(cod)
    if (!f) { pitido(false); toast(`❌ ${cod} no estaba proyectado · queda para revisar`, 'error'); return }
    if (n > f.proyectado) { pitido(false); toast(`⚠️ ${f.modelo} ${f.descripcion ?? ''}: ${n} leídos, proyectado ${f.proyectado}`, 'error'); return }
    pitido(true)
    toast(`✅ ${f.modelo} ${f.descripcion ?? ''} · ${n}/${f.proyectado}`, 'success')
  }

  const leidasConProy = [...filas.values()].filter((f) => leidos[f.codigo])
  const noProyectados = Object.keys(leidos).filter((c) => !filas.has(c))
  const aIngresar = leidasConProy.reduce((a, f) => a + Math.min(leidos[f.codigo], f.proyectado), 0)

  async function confirmar() {
    if (!aIngresar) return
    const faltan = leidasConProy.filter((f) => leidos[f.codigo] < f.proyectado).length
    if (!window.confirm(
      `Se confirman ${aIngresar} u. al stock.` +
      (faltan ? `\n${faltan} artículo(s) llegaron incompletos: lo que falta queda pendiente.` : '') +
      (noProyectados.length ? `\n${noProyectados.length} código(s) no proyectados NO entran.` : '') +
      '\n\n¿Confirmás?'
    )) return
    setConfirmando(true)
    let ok = 0
    const errores: string[] = []
    for (const f of leidasConProy) {
      let resto = Math.min(leidos[f.codigo], f.proyectado)
      for (const i of f.ingresos) {
        if (resto <= 0) break
        const n = Math.min(resto, i.cantidad)
        const { error } = await supabase.rpc('confirmar_ingreso_parcial', { p_id: i.id, p_por: por, p_cant: n })
        if (error) { errores.push(`${f.modelo} ${f.descripcion ?? ''}: ${error.message}`); break }
        ok += n
        resto -= n
      }
    }
    setConfirmando(false)
    if (errores.length) toast(`Ingresaron ${ok} u. · falló: ${errores.join(' · ')}`, 'error')
    else toast(`✓ Ingreso confirmado — ${ok} u. sumadas al stock`, 'success')
    onHecho()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-[#F8F6F0] w-full max-w-md max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-3 text-ink">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">📷 Escanear lo que bajó</h3>
          <button onClick={onCerrar} className="text-sm text-muted">✕ Cerrar</button>
        </div>
        <p className="text-xs text-muted">Pasá la etiqueta de cada anteojo. Nada entra al stock hasta que confirmes.</p>

        {camara ? (
          <LectorCamara onCodigo={leer} onCerrar={() => setCamara(false)} />
        ) : (
          <button onClick={() => setCamara(true)} className="w-full rounded-xl bg-ink text-white py-3 text-sm font-semibold">📷 Seguir escaneando</button>
        )}

        <form onSubmit={(e) => { e.preventDefault(); leer(manual); setManual('') }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…o escribí el código"
            className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
          <button className="rounded-lg border border-black/10 px-3 text-sm">Sumar</button>
        </form>

        {noProyectados.length > 0 && (
          <div className="rounded-xl border border-red-600/30 bg-red-50 p-3 space-y-1">
            <p className="text-xs font-semibold text-red-800">❌ No estaban proyectados · no entran al stock, revisar:</p>
            {noProyectados.map((c) => (
              <div key={c} className="flex items-center justify-between text-sm">
                <span className="font-mono">{c}</span>
                <span className="flex items-center gap-2">
                  <b>{leidos[c]} u.</b>
                  <button onClick={() => fijar(c, leidos[c] - 1)} className="w-7 h-7 rounded-full border border-black/10 bg-white">−</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {leidasConProy.length > 0 && (
          <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
            {leidasConProy.map((f) => {
              const n = leidos[f.codigo]
              const st = n === f.proyectado ? '✅' : n < f.proyectado ? '⚠️ faltan ' + (f.proyectado - n) : '❌ sobran ' + (n - f.proyectado)
              return (
                <div key={f.codigo} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate"><b>{f.modelo}</b> {f.descripcion}</p>
                    <p className="text-[11px] text-faint"><span className="font-mono">{f.codigo}</span> · {st}</p>
                  </div>
                  <button onClick={() => fijar(f.codigo, n - 1)} className="w-7 h-7 rounded-full border border-black/10 text-sm" title="Deshacer una lectura">−</button>
                  <span className="text-sm font-semibold whitespace-nowrap">{n}/{f.proyectado}</span>
                </div>
              )
            })}
          </div>
        )}

        {aIngresar > 0 && (
          <button onClick={confirmar} disabled={confirmando}
            className="w-full rounded-xl bg-emerald-600 text-white py-3 text-sm font-bold disabled:opacity-60">
            {confirmando ? 'Confirmando…' : `✓ Confirmar ingreso · ${aIngresar} u.`}
          </button>
        )}
      </div>
    </div>
  )
}
