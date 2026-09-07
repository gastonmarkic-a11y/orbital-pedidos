/* Import de extracto bancario (CSV o Excel).
   No hay open banking estandarizado en Argentina: hasta que haya convenio o agregador,
   el banco entra por acá. El archivo se lee en el navegador, se mapean tres columnas
   (fecha, importe, detalle) y se previsualiza antes de escribir nada.

   Cada línea se guarda con una ref_externa determinística: si se reimporta el mismo
   extracto, las filas repetidas chocan contra el índice único y no se duplican. */

import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { CuentaFinanciera } from '../../lib/types'
import { plata } from '../../lib/finanzas'
import { Btn, Campo, FIN, Panel, Rotulo, Selector, Tabla, Td, Th, Nota } from './ui'

interface Fila {
  fecha: string
  monto: number
  detalle: string
  ref: string
}

/** Hash corto y estable de una línea del extracto: mismo archivo → misma ref → no duplica. */
function refDe(cuentaId: number, fecha: string, monto: number, detalle: string): string {
  const base = `${cuentaId}|${fecha}|${monto}|${detalle}`
  let h = 0
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0
  return `ext_${fecha}_${Math.abs(h).toString(36)}`
}

/** Fechas de extracto: dd/mm/aaaa, aaaa-mm-dd o serial de Excel (días desde 1899-12-30). */
function aFecha(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') {
    if (v < 1 || v > 100000) return ''
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (dmy) {
    const anio = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]
    return `${anio}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (ymd) return ymd[0]
  return ''
}

/** Importes con separadores argentinos: 1.234,56 → 1234.56. Paréntesis = negativo. */
function aMonto(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/\$|\s/g, '')
  const negParen = /^\(.*\)$/.test(s)
  if (negParen) s = s.slice(1, -1)
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  if (isNaN(n)) return 0
  return negParen ? -n : n
}

const NADA = '—'

export default function ImportExtracto({
  cuentas,
  onCerrar,
  onListo,
}: {
  cuentas: CuentaFinanciera[]
  onCerrar: () => void
  onListo: () => void
}) {
  const toast = useToast()
  const [cuentaId, setCuentaId] = useState(String(cuentas[0]?.id ?? ''))
  const [headers, setHeaders] = useState<string[]>([])
  const [crudas, setCrudas] = useState<Record<string, unknown>[]>([])
  const [colFecha, setColFecha] = useState('')
  const [colDebito, setColDebito] = useState('')
  const [colCredito, setColCredito] = useState('')
  const [colMonto, setColMonto] = useState('')
  const [colDetalle, setColDetalle] = useState('')
  const [tipo, setTipo] = useState('extracto')
  const [guardando, setGuardando] = useState(false)

  function detectar(hs: string[], claves: string[]): string {
    const h = hs.find((x) => claves.some((c) => x.toLowerCase().includes(c)))
    return h ?? ''
  }

  async function leerArchivo(file: File) {
    // xlsx se carga en forma diferida (igual que en exportTango): pesa y solo hace falta al importar.
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const hoja = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: '' })
    if (json.length === 0) {
      toast('El archivo no tiene filas', 'error')
      return
    }
    const hs = Object.keys(json[0])
    setHeaders(hs)
    setCrudas(json)
    setColFecha(detectar(hs, ['fecha']))
    setColDetalle(detectar(hs, ['detalle', 'concepto', 'descrip', 'movimiento', 'referencia']))
    const deb = detectar(hs, ['débito', 'debito'])
    const cre = detectar(hs, ['crédito', 'credito'])
    if (deb && cre) {
      setColDebito(deb)
      setColCredito(cre)
      setColMonto('')
    } else {
      setColMonto(detectar(hs, ['importe', 'monto', 'valor']))
      setColDebito('')
      setColCredito('')
    }
  }

  const filas: Fila[] = useMemo(() => {
    if (!colFecha || !cuentaId) return []
    const id = Number(cuentaId)
    return crudas
      .map((r) => {
        const fecha = aFecha(r[colFecha])
        const monto =
          colDebito || colCredito
            ? aMonto(r[colCredito]) - Math.abs(aMonto(r[colDebito]))
            : aMonto(r[colMonto])
        const detalle = String(r[colDetalle] ?? '').trim().slice(0, 200)
        return { fecha, monto, detalle, ref: refDe(id, fecha, monto, detalle) }
      })
      .filter((f) => f.fecha && f.monto !== 0)
  }, [crudas, colFecha, colDebito, colCredito, colMonto, colDetalle, cuentaId])

  const totalNeto = filas.reduce((a, f) => a + f.monto, 0)

  async function importar() {
    if (!cuentaId || filas.length === 0) return
    setGuardando(true)
    const id = Number(cuentaId)
    // upsert con ignoreDuplicates: reimportar el mismo extracto no duplica ni pisa lo conciliado.
    const { data, error } = await supabase
      .from('movimientos_financieros')
      .upsert(
        filas.map((f) => ({
          cuenta_id: id,
          fecha: f.fecha,
          monto: f.monto,
          tipo,
          detalle: f.detalle,
          origen: 'import',
          ref_externa: f.ref,
          conciliado: true, // viene del extracto: ya está conciliado por definición
        })),
        { onConflict: 'cuenta_id,ref_externa', ignoreDuplicates: true }
      )
      .select('monto')
    setGuardando(false)
    if (error) {
      toast('No se pudo importar: ' + error.message, 'error')
      return
    }
    const nuevos = (data as { monto: number }[]) ?? []
    const delta = nuevos.reduce((a, m) => a + Number(m.monto || 0), 0)
    if (delta !== 0) {
      const cuenta = cuentas.find((c) => c.id === id)
      await supabase
        .from('cuentas_financieras')
        .update({ saldo_actual: Number(cuenta?.saldo_actual || 0) + delta })
        .eq('id', id)
    }
    const repetidas = filas.length - nuevos.length
    toast(
      `✅ ${nuevos.length} movimiento(s) importado(s)` + (repetidas > 0 ? ` · ${repetidas} ya estaban` : ''),
      'success'
    )
    onListo()
  }

  const opcionesCol = [{ id: '', label: NADA }, ...headers.map((h) => ({ id: h, label: h }))]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 overflow-y-auto" style={{ background: '#000000CC' }}>
      <div className="fin-scope w-full max-w-3xl my-4 font-inter">
        <Panel
          titulo="Importar extracto bancario"
          nota="CSV o Excel. Se leen en el navegador; nada sale de la Suite."
          derecha={<Btn onClick={onCerrar}>Cerrar</Btn>}
        >
          <div className="grid grid-cols-2 gap-3">
            <Selector
              label="Cuenta"
              value={cuentaId}
              onChange={setCuentaId}
              opciones={cuentas.map((c) => ({ id: String(c.id), label: `${c.nombre} · ${c.razon_social}` }))}
            />
            <Campo label="Tipo de movimiento" value={tipo} onChange={setTipo} />
          </div>

          <label className="block mt-3">
            <Rotulo>Archivo</Rotulo>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && leerArchivo(e.target.files[0])}
              className="mt-1 w-full text-[12px] rounded border px-2 py-1.5"
              style={{ background: FIN.panelAlto, borderColor: FIN.borde, color: FIN.texto }}
            />
          </label>

          {headers.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Selector label="Fecha" value={colFecha} onChange={setColFecha} opciones={opcionesCol} />
                <Selector label="Detalle" value={colDetalle} onChange={setColDetalle} opciones={opcionesCol} />
                <Selector label="Importe único" value={colMonto} onChange={setColMonto} opciones={opcionesCol} />
                <div className="grid grid-cols-2 gap-2">
                  <Selector label="Débito" value={colDebito} onChange={setColDebito} opciones={opcionesCol} />
                  <Selector label="Crédito" value={colCredito} onChange={setColCredito} opciones={opcionesCol} />
                </div>
              </div>
              <Nota>
                Usá <b>Importe único</b> si el extracto trae una sola columna con signo, o <b>Débito/Crédito</b> si
                vienen separadas. Los débitos se guardan en negativo.
              </Nota>

              <div className="mt-3 rounded border" style={{ borderColor: FIN.borde }}>
                <Tabla>
                  <thead>
                    <tr>
                      <Th ancho="w-24">Fecha</Th>
                      <Th>Detalle</Th>
                      <Th num>Importe</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.slice(0, 12).map((f) => (
                      <tr key={f.ref}>
                        <Td className="font-jet">{f.fecha}</Td>
                        <Td>{f.detalle || NADA}</Td>
                        <Td num color={f.monto < 0 ? FIN.rojo : FIN.verde}>
                          {plata(f.monto)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
                {filas.length > 12 && (
                  <p className="text-[10.5px] px-2 py-1.5" style={{ color: FIN.tenue }}>
                    … y {filas.length - 12} más
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between mt-3">
                <p className="text-[11.5px]" style={{ color: FIN.tenue }}>
                  {filas.length} movimiento(s) · neto{' '}
                  <span className="font-jet" style={{ color: totalNeto < 0 ? FIN.rojo : FIN.verde }}>
                    {plata(totalNeto)}
                  </span>
                </p>
                <Btn variante="oro" onClick={importar} disabled={guardando || filas.length === 0}>
                  {guardando ? 'Importando…' : 'Importar'}
                </Btn>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
