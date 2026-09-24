import { useRef, useState } from 'react'
import { Pedido } from '../../lib/types'
import { useToast } from '../../lib/toast'
import { LectorCamara, limpiarCodigo, pitido } from '../../lib/lector'

// Pickeo con cámara: depósito escanea cada anteojo que toma de góndola. Cada lectura suma una
// unidad a su línea; cuando una línea se completa queda tildada en pedidos.picking (el mismo
// campo que el checkbox manual, que sigue funcionando). Lo pendiente de producción no se pickea.

type Linea = { codigo: string; original: string; modelo: string; descripcion: string | null; objetivo: number }

const claveLocal = (id: number) => `pickeo_${id}`

export default function PickeoEscaner({ pedido, onGuardar, onListo, onCerrar }: {
  pedido: Pedido
  onGuardar: (picking: string[]) => Promise<boolean>
  onListo: () => void
  onCerrar: () => void
}) {
  const toast = useToast()

  // Una línea por código (sumando si el mismo SKU aparece dos veces), sin lo pendiente.
  const lineas: Linea[] = []
  for (const i of pedido.items ?? []) {
    const obj = Math.max(i.cantidad - (i.pendiente ?? 0), 0)
    const cod = i.codigo.toUpperCase()
    const ya = lineas.find((l) => l.codigo === cod)
    if (ya) ya.objetivo += obj
    else lineas.push({ codigo: cod, original: i.codigo, modelo: i.modelo, descripcion: i.descripcion, objetivo: obj })
  }
  const aPickear = lineas.filter((l) => l.objetivo > 0)

  const pickingRef = useRef<string[]>(pedido.picking ?? [])
  const [conteo, setConteo] = useState<Record<string, number>>(() => {
    let guardado: Record<string, number> = {}
    try { guardado = JSON.parse(localStorage.getItem(claveLocal(pedido.id)) || '{}') } catch { /* sin storage */ }
    const c: Record<string, number> = {}
    for (const l of aPickear) c[l.codigo] = pickingRef.current.includes(l.original) ? l.objetivo : Math.min(guardado[l.codigo] ?? 0, l.objetivo)
    return c
  })
  const conteoRef = useRef(conteo)
  conteoRef.current = conteo
  const [camara, setCamara] = useState(true)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  function fijar(cod: string, n: number) {
    const nuevo = { ...conteoRef.current, [cod]: n }
    conteoRef.current = nuevo
    setConteo(nuevo)
    try { localStorage.setItem(claveLocal(pedido.id), JSON.stringify(nuevo)) } catch { /* sin storage */ }
    const l = aPickear.find((x) => x.codigo === cod)!
    const estaba = pickingRef.current.includes(l.original)
    const completo = n >= l.objetivo
    if (completo !== estaba) {
      pickingRef.current = completo ? [...pickingRef.current, l.original] : pickingRef.current.filter((c) => c !== l.original)
      onGuardar(pickingRef.current)
    }
  }

  function leer(raw: string) {
    const cod = limpiarCodigo(raw)
    if (!cod) return
    const l = aPickear.find((x) => x.codigo === cod)
    if (!l) {
      pitido(false)
      const esPendiente = lineas.some((x) => x.codigo === cod)
      setError(esPendiente ? `${cod}: todo lo de este artículo espera producción, no se arma ahora.` : `${cod} NO está en este pedido. No lo pongas.`)
      return
    }
    const n = conteoRef.current[cod] ?? 0
    if (n >= l.objetivo) {
      pitido(false)
      setError(`Ya están las ${l.objetivo} de ${l.modelo} ${l.descripcion ?? ''}. Esa sobra.`)
      return
    }
    setError('')
    pitido(true)
    fijar(cod, n + 1)
    toast(`✅ ${l.modelo} ${l.descripcion ?? ''} · ${n + 1}/${l.objetivo}`, 'success')
  }

  const total = aPickear.reduce((a, l) => a + l.objetivo, 0)
  const hechas = aPickear.reduce((a, l) => a + Math.min(conteo[l.codigo] ?? 0, l.objetivo), 0)
  const completo = aPickear.length > 0 && hechas >= total

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-[#F8F6F0] w-full max-w-md max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-3 text-ink">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">📷 Pickeo · pedido #{pedido.id}</h3>
          <button onClick={onCerrar} className="text-sm text-muted">✕ Cerrar</button>
        </div>
        <p className="text-xs text-muted">{pedido.cliente} · <b>{hechas} / {total} u.</b> tomadas</p>

        {completo ? (
          <div className="rounded-xl border border-emerald-600/30 bg-emerald-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-emerald-800">✅ Pedido completo</p>
            <button onClick={onListo} className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-bold">✓ Marcar Listo p/facturar</button>
          </div>
        ) : camara ? (
          <LectorCamara onCodigo={leer} onCerrar={() => setCamara(false)} />
        ) : (
          <button onClick={() => setCamara(true)} className="w-full rounded-xl bg-ink text-white py-3 text-sm font-semibold">📷 Seguir escaneando</button>
        )}

        {error && (
          <div className="rounded-lg border border-red-600/30 bg-red-50 p-2 text-sm flex justify-between gap-2">
            <span>❌ {error}</span>
            <button onClick={() => setError('')} className="text-xs text-muted">✕</button>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); leer(manual); setManual('') }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…o escribí el código"
            className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
          <button className="rounded-lg border border-black/10 px-3 text-sm">Sumar</button>
        </form>

        <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
          {lineas.map((l) => {
            const n = conteo[l.codigo] ?? 0
            const ok = l.objetivo > 0 && n >= l.objetivo
            return (
              <div key={l.codigo} className={`flex items-center gap-2 px-3 py-2 ${ok ? 'bg-emerald-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${ok ? 'line-through text-muted' : ''}`}><b>{l.modelo}</b> {l.descripcion}</p>
                  <p className="text-[11px] font-mono text-faint">{l.codigo}</p>
                </div>
                {l.objetivo === 0 ? (
                  <span className="text-[11px] text-amber-700">espera producción</span>
                ) : (
                  <>
                    {n > 0 && <button onClick={() => fijar(l.codigo, n - 1)} className="w-7 h-7 rounded-full border border-black/10 text-sm" title="Deshacer una lectura">−</button>}
                    <span className={`text-sm font-semibold whitespace-nowrap ${ok ? 'text-emerald-700' : ''}`}>{ok ? '✓ ' : ''}{n}/{l.objetivo}</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-faint">Lo que completes acá queda tildado en el pedido. El checkbox a mano sigue funcionando igual.</p>
      </div>
    </div>
  )
}
