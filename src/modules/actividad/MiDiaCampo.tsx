import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import TelefonoAcciones from '../../lib/TelefonoAcciones'

// "Mi día" de campo: la cabeza de zona del día (por dónde arrancar), las ópticas que siguen después del
// check-in (las arma ojo-checkin con la foto) y las acciones del mes que vencen (empujón comercial a
// calientes/tibias, branding mensual a frías). Sale de la función mi_dia_campo().

type Ficha = {
  cod: string
  nombre: string | null
  direccion: string | null
  localidad: string | null
  barrio: string | null
  contacto: string | null
  tel: string | null
  horario: string | null
  estado: string | null
  nivel_partner: string | null
  u12: number | null
  u_prev12: number | null
  u_mejor_anio: number | null
  ult_mes: string | null
  tiene_orbital: boolean | null
  vidriera: string | null
  modelos: { modelo: string; u: number }[] | null
  ultima_actividad: { fecha: string; resultado: string | null; nota: string | null } | null
  catalogo_30d: { visitas: number; ultima: string | null } | null
  catalogo_min_30d: number | null
  accion_pendiente: { fecha: string; titulo: string; temperatura: string } | null
  que_ofrecer: string | null
}

type Accion = {
  id: number
  cod: string
  nombre: string | null
  tel: string | null
  temperatura: 'caliente' | 'tibia' | 'fria'
  tipo: string
  fecha: string
  titulo: string
  detalle: string | null
  pieza: string | null
  pieza_url: string | null
}

type Dia = {
  cabeza: { micro_zona: string; motivo: string; checkin_at: string | null; ficha: Ficha } | null
  ruta: { orden: number; motivo: string | null; visitado: boolean; distancia_m: number | null; ficha: Ficha }[] | null
  acciones: Accion[] | null
}

const MOTIVO: Record<string, string> = {
  ancla: 'cliente ancla del barrio (el que más compra)',
  recuperar: 'primero a recuperar del barrio',
  prospecto: 'prospecto más fuerte del barrio',
}
const TEMP: Record<string, string> = {
  caliente: 'bg-red-100 text-red-700',
  tibia: 'bg-amber-100 text-amber-800',
  fria: 'bg-sky-100 text-sky-800',
}
const n0 = (v: number | null | undefined) => Math.round(Number(v ?? 0))
const mes = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : '—')
const ddmm = (f: string | null | undefined) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '')
const mapsDir = (f: Ficha) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([f.direccion, f.barrio || f.localidad, 'Argentina'].filter(Boolean).join(', '))}`

function FichaOptica({ f }: { f: Ficha }) {
  return (
    <div className="space-y-0.5 text-[12px] text-muted">
      <p className="text-ink">
        <b>{f.nombre}</b> <span className="text-faint">({f.cod})</span> · {f.estado ?? 'prospecto'}
        {f.nivel_partner && <span className="text-violet-700"> · {f.nivel_partner}</span>}
      </p>
      {(f.direccion || f.localidad) && (
        <p>📍 {[f.direccion, f.barrio || f.localidad].filter(Boolean).join(', ')} · <a href={mapsDir(f)} target="_blank" rel="noreferrer" className="text-brandDark font-medium">Mapa</a></p>
      )}
      {(f.contacto || f.tel) && (
        <div className="flex items-center gap-2">
          <span>☎️ {[f.contacto, f.tel].filter(Boolean).join(' · ')}</span>
          <TelefonoAcciones whatsapp={f.tel} telefono={null} compact />
        </div>
      )}
      {f.horario && <p>🕘 {f.horario}</p>}
      {f.estado && <p>🛒 12m: {n0(f.u12)} u (antes {n0(f.u_prev12)}) · mejor año {n0(f.u_mejor_anio)} u · últ. compra {mes(f.ult_mes)}</p>}
      {!!f.modelos?.length && <p>👓 Compra: {f.modelos.map((m) => `${m.modelo} (${m.u})`).join(', ')}</p>}
      {f.tiene_orbital != null && <p>{f.tiene_orbital ? '🟢 Orbital en vidriera' : '🔴 Sin Orbital en vidriera'}{f.vidriera ? ` — ${String(f.vidriera).slice(0, 160)}` : ''}</p>}
      {!!f.catalogo_30d?.visitas && <p>📖 Abrió el catálogo {f.catalogo_30d.visitas} vez/veces en 30 días{n0(f.catalogo_min_30d) ? ` (${n0(f.catalogo_min_30d)} min)` : ''}</p>}
      {f.ultima_actividad && <p>🗒 Último contacto {ddmm(f.ultima_actividad.fecha)}: {f.ultima_actividad.resultado}{f.ultima_actividad.nota ? ` — ${f.ultima_actividad.nota}` : ''}</p>}
      {f.accion_pendiente && <p>⏭ Pendiente: {f.accion_pendiente.titulo} ({ddmm(f.accion_pendiente.fecha)})</p>}
      {f.que_ofrecer && <p className="text-ink">💡 {f.que_ofrecer}</p>}
    </div>
  )
}

export default function MiDiaCampo({ ven }: { ven: string }) {
  const toast = useToast()
  const [dia, setDia] = useState<Dia | null>(null)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState<number | null>(null)

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase.rpc('mi_dia_campo', { p_vendedor: ven })
    if (error) toast('No se pudo cargar el día: ' + error.message, 'error')
    setDia((data as Dia) ?? null)
    setLoading(false)
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [ven])

  async function marcar(a: Accion, estado: 'hecha' | 'cancelada') {
    setGuardando(a.id)
    const { error } = await supabase.rpc('marcar_accion', { p_id: a.id, p_estado: estado })
    setGuardando(null)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast(estado === 'hecha' ? '✓ Acción hecha' : 'Acción descartada', 'success')
    cargar()
  }

  if (loading) return <p className="text-sm text-muted p-2">Cargando tu día…</p>
  const cabeza = dia?.cabeza
  const ruta = dia?.ruta ?? []
  const acciones = dia?.acciones ?? []

  return (
    <div className="space-y-2.5">
      <div className="bg-white rounded-2xl border border-brand/40 p-3 space-y-2">
        {cabeza ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold">🎯 Hoy arrancás por {cabeza.micro_zona}</p>
              <span className="text-[10px] rounded-full px-2 py-0.5 bg-black/5 text-muted">{MOTIVO[cabeza.motivo] ?? cabeza.motivo}</span>
              {cabeza.checkin_at && <span className="text-[10px] rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800">✓ check-in hecho</span>}
            </div>
            <FichaOptica f={cabeza.ficha} />
            {!cabeza.checkin_at && (
              <p className="text-[11px] text-faint">📸 Al llegar mandá la foto de la vidriera a Ojo (mejor como archivo): te pasa las 4 ópticas que siguen.</p>
            )}
          </>
        ) : (
          <p className="text-[12px] text-muted">🎯 Todavía no hay cabeza de zona para hoy. Se asigna de lunes a viernes a las 8:15 y te llega por Ojo.</p>
        )}
      </div>

      {ruta.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
          <p className="text-sm font-bold">🗺️ Las que siguen hoy ({ruta.filter((r) => r.visitado).length}/{ruta.length})</p>
          {ruta.map((r) => (
            <div key={r.orden} className={`border-t border-black/5 pt-2 ${r.visitado ? 'opacity-50' : ''}`}>
              <p className="text-[11px] text-faint mb-0.5">{r.visitado ? '✓ visitada · ' : ''}{r.motivo}{r.distancia_m != null ? ` · ${r.distancia_m < 1000 ? `${r.distancia_m} m` : `${(r.distancia_m / 1000).toFixed(1)} km`}` : ''}</p>
              <FichaOptica f={r.ficha} />
            </div>
          ))}
        </div>
      )}

      {acciones.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
          <p className="text-sm font-bold">📌 Acciones del mes ({acciones.length})</p>
          <p className="text-[11px] text-faint">Caliente/tibia: empujón comercial. Fría: un contacto por mes con material de marca. Si lo mandás desde Cartera → Enviar, se cierra sola.</p>
          {acciones.map((a) => (
            <div key={a.id} className="border-t border-black/5 pt-2 text-[12px] space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${TEMP[a.temperatura]}`}>{a.temperatura}</span>
                <b className="text-ink">{a.nombre ?? a.cod}</b>
                <span className="text-faint">{ddmm(a.fecha)}</span>
                <TelefonoAcciones whatsapp={a.tel} telefono={null} compact />
              </div>
              <p className="text-ink">{a.titulo}</p>
              {a.detalle && <p className="text-muted">{a.detalle}</p>}
              {a.pieza && (
                <p>📎 Material: {a.pieza_url ? <a href={a.pieza_url} target="_blank" rel="noreferrer" className="text-brandDark font-medium">{a.pieza}</a> : a.pieza}</p>
              )}
              <div className="flex gap-2">
                <button disabled={guardando === a.id} onClick={() => marcar(a, 'hecha')} className="text-[11px] font-semibold px-3 py-1 rounded-full bg-brand text-white">✓ Hecha</button>
                <button disabled={guardando === a.id} onClick={() => marcar(a, 'cancelada')} className="text-[11px] font-medium px-3 py-1 rounded-full border border-black/10 text-muted">Descartar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
