// ── Exhibición en vitrina: qué anteojo va en cada lugar del mueble ─────────────────────
// Cálculo puro (sin pantalla). Entra el stock de la sucursal, sus ventas de 90 días y lo que hay
// hoy en la vitrina (última foto confirmada); sale el croquis recomendado, los movimientos del día
// y, para cada lugar, por cuál reemplazarlo si se vende.
//
// Criterio:
//   · Solo se exhibe lo disponible (cantidad − devolver > 0). Lo marcado para devolver sale de la vitrina.
//   · Puntaje = ventas recientes (30 días pesan doble) + demanda del modelo en otros colores
//     + un empujón al que tiene reserva de sobra (hay que rotarlo).
//   · Variedad: el 2.º color de un modelo compite al 60 % de su puntaje y el 3.º al 35 %.
//   · Los estantes de arriba son los más visibles (en el mostrador se ven primero) y van para los de mejor puntaje.
//   · Estabilidad: lo que ya está bien ubicado no se mueve; se cambian solo los huecos, lo que no
//     corresponde y como mucho 3 movimientos para subir a los que más venden.

export type LineaStock = { codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; devolver: number; imagen: string | null }
export type VentaCod = { codigo: string; u30: number | null; u90: number | null; ultima: string | null }
// Un lugar confirmado de la vitrina. codigo null = vacío; desconocido = hay un anteojo que no está en el stock.
export type Pos = { f: number; c: number; codigo: string | null; desconocido?: boolean }

export type Accion =
  | { tipo: 'poner'; f: number; c: number; codigo: string }
  | { tipo: 'cambiar'; f: number; c: number; sale: string; entra: string; motivo: string }
  | { tipo: 'sacar'; f: number; c: number; sale: string | null; motivo: string; entra: string | null }
  | { tipo: 'mover'; a: { f: number; c: number }; b: { f: number; c: number }; sube: string; baja: string }

export type Lugar = {
  f: number; c: number; codigo: string | null
  cambia: boolean               // distinto de lo que hay hoy
  siSeVende: { codigo: string; mismo: boolean } | null
}

export type Plan = {
  lugares: Lugar[]
  acciones: Accion[]
  reserva: { codigo: string; unidades: number }[]   // disponible que no entra en la vitrina (o sus unidades extra)
  resumen: { unidades: number; disponibles: number; codigos: number; lugares: number; enVitrina: number; enReserva: number; sinLugar: number; paraDevolver: number }
}

const key = (f: number, c: number) => `${f}-${c}`

export function valorLugar(f: number, c: number, filas: number, columnas: number) {
  const alto = filas > 1 ? 1 - ((f - 1) / (filas - 1)) * 0.6 : 1
  const centro = columnas % 2 === 1 && c === (columnas + 1) / 2 ? 0.03 : 0
  return alto + centro
}

export function puntajes(stock: LineaStock[], ventas: VentaCod[]) {
  const v = new Map(ventas.map((x) => [x.codigo, x]))
  const porModelo = new Map<string, number>()
  for (const x of ventas) {
    const m = stock.find((s) => s.codigo === x.codigo)?.modelo ?? ''
    porModelo.set(m, (porModelo.get(m) ?? 0) + (x.u90 ?? 0))
  }
  const out = new Map<string, number>()
  for (const s of stock) {
    const disp = s.cantidad - s.devolver
    const u = v.get(s.codigo)
    const propio = (u?.u90 ?? 0) + (u?.u30 ?? 0)
    const modelo = (porModelo.get(s.modelo ?? '') ?? 0) - (u?.u90 ?? 0)
    out.set(s.codigo, propio + 0.25 * modelo + 0.3 * Math.min(Math.max(disp - 1, 0), 3))
  }
  return out
}

export function planificar(filas: number, columnas: number, stock: LineaStock[], ventas: VentaCod[], actual: Pos[] | null): Plan {
  const disp = new Map(stock.map((s) => [s.codigo, Math.max(s.cantidad - s.devolver, 0)]))
  const info = new Map(stock.map((s) => [s.codigo, s]))
  const pts = puntajes(stock, ventas)
  const total = filas * columnas
  const ordenados = stock.filter((s) => (disp.get(s.codigo) ?? 0) > 0).sort((a, b) => (pts.get(b.codigo)! - pts.get(a.codigo)!) || a.codigo.localeCompare(b.codigo))

  // Selección: el segundo color de un modelo vale 60 % y el tercero 35 %. Así la vitrina tiene variedad,
  // pero un color que vende mucho le gana el lugar a un modelo que casi no se vende.
  const rango = new Map<string, number>()
  const porModelo = new Map<string, number>()
  for (const s of ordenados) {
    const m = s.modelo ?? s.codigo
    const n = porModelo.get(m) ?? 0
    porModelo.set(m, n + 1)
    rango.set(s.codigo, n)
  }
  const factor = [1, 0.6, 0.35]
  const efectivo = (c: string) => (pts.get(c) ?? 0) * (factor[rango.get(c) ?? 0] ?? 0.2)
  const elegidos = [...ordenados].sort((a, b) => (efectivo(b.codigo) - efectivo(a.codigo)) || (rango.get(a.codigo)! - rango.get(b.codigo)!))
    .slice(0, total).map((s) => s.codigo)
  const sel = new Set(elegidos)

  const lugares: { f: number; c: number; v: number }[] = []
  for (let f = 1; f <= filas; f++) for (let c = 1; c <= columnas; c++) lugares.push({ f, c, v: valorLugar(f, c, filas, columnas) })
  const porValor = [...lugares].sort((a, b) => b.v - a.v)

  const hoy = new Map<string, Pos>()
  for (const p of actual ?? []) hoy.set(key(p.f, p.c), p)
  const asignado = new Map<string, string | null>()
  const usados = new Set<string>()

  // 1) Lo que ya está y corresponde, se queda (un lugar por código: si está repetido, queda el mejor lugar).
  for (const l of porValor) {
    const p = hoy.get(key(l.f, l.c))
    if (p?.codigo && sel.has(p.codigo) && !usados.has(p.codigo)) { asignado.set(key(l.f, l.c), p.codigo); usados.add(p.codigo) }
  }
  // 2) Los lugares libres (huecos o con algo que no corresponde) se llenan con lo elegido que falta, mejor puntaje al mejor lugar.
  const faltan = elegidos.filter((c) => !usados.has(c))
  for (const l of porValor) {
    if (asignado.has(key(l.f, l.c))) continue
    const c = faltan.shift() ?? null
    asignado.set(key(l.f, l.c), c)
    if (c) usados.add(c)
  }
  // 3) Hasta 3 intercambios para subir a los que más venden (solo si la diferencia vale la pena).
  const movs: Accion[] = []
  for (let n = 0; n < 3; n++) {
    let mejor: { a: typeof lugares[0]; b: typeof lugares[0]; gan: number } | null = null
    for (const a of lugares) for (const b of lugares) {
      if (a.v <= b.v) continue
      const ca = asignado.get(key(a.f, a.c)), cb = asignado.get(key(b.f, b.c))
      if (!ca || !cb) continue
      // Solo entre anteojos que ya están en esos lugares: a uno nuevo ya le tocó el mejor lugar libre.
      if (hoy.get(key(a.f, a.c))?.codigo !== ca || hoy.get(key(b.f, b.c))?.codigo !== cb) continue
      const d = (pts.get(cb) ?? 0) - (pts.get(ca) ?? 0)
      const gan = d * (a.v - b.v)
      if (d >= 2 && a.v - b.v >= 0.2 && (!mejor || gan > mejor.gan)) mejor = { a, b, gan }
    }
    if (!mejor) break
    const ca = asignado.get(key(mejor.a.f, mejor.a.c))!, cb = asignado.get(key(mejor.b.f, mejor.b.c))!
    asignado.set(key(mejor.a.f, mejor.a.c), cb)
    asignado.set(key(mejor.b.f, mejor.b.c), ca)
    movs.push({ tipo: 'mover', a: { f: mejor.b.f, c: mejor.b.c }, b: { f: mejor.a.f, c: mejor.a.c }, sube: cb, baja: ca })
  }

  // Acciones contra lo que hay hoy (sin foto todavía: todo es «poner»).
  const acciones: Accion[] = []
  const enMovs = new Set(movs.flatMap((m) => (m.tipo === 'mover' ? [key(m.a.f, m.a.c), key(m.b.f, m.b.c)] : [])))
  for (const l of lugares) {
    const k = key(l.f, l.c)
    if (enMovs.has(k)) continue
    const p = hoy.get(k)
    const entra = asignado.get(k) ?? null
    const sale = p?.codigo ?? null
    if (sale === entra && !p?.desconocido) continue
    const motivo = p?.desconocido ? 'no figura en el stock de la sucursal: revisalo'
      : !sale ? '' : !info.has(sale) ? 'no figura en el stock de la sucursal'
      : (info.get(sale)!.devolver > 0 && (disp.get(sale) ?? 0) === 0) ? 'está marcado para devolver a Orbital'
      : (disp.get(sale) ?? 0) === 0 ? 'no queda disponible'
      : sel.has(sale) ? 'ya está en otro lugar de la vitrina'
      : 'vende menos: pasa a la reserva'
    if (!sale && !p?.desconocido) { if (entra) acciones.push({ tipo: 'poner', f: l.f, c: l.c, codigo: entra }) }
    else if (entra && sale) acciones.push({ tipo: 'cambiar', f: l.f, c: l.c, sale, entra, motivo })
    else acciones.push({ tipo: 'sacar', f: l.f, c: l.c, sale, motivo, entra })
  }
  acciones.push(...movs)

  // Reemplazo si se vende: el mismo código si queda reserva; si no, otro color del mismo modelo; si no, el mejor de la reserva.
  const reservaCods = ordenados.filter((s) => !usados.has(s.codigo)).map((s) => s.codigo)
  const tomados = new Set<string>()
  const siSeVende = new Map<string, Lugar['siSeVende']>()
  for (const l of porValor) {
    const c = asignado.get(key(l.f, l.c))
    if (!c) continue
    if ((disp.get(c) ?? 0) >= 2) { siSeVende.set(key(l.f, l.c), { codigo: c, mismo: true }); continue }
    const m = info.get(c)?.modelo
    const otro = reservaCods.find((x) => !tomados.has(x) && info.get(x)?.modelo === m) ?? reservaCods.find((x) => !tomados.has(x))
    if (otro) { tomados.add(otro); siSeVende.set(key(l.f, l.c), { codigo: otro, mismo: false }) }
    else siSeVende.set(key(l.f, l.c), null)
  }

  const enVitrina = usados.size
  const disponibles = [...disp.values()].reduce((s, n) => s + n, 0)
  return {
    lugares: lugares.map((l) => {
      const codigo = asignado.get(key(l.f, l.c)) ?? null
      const p = hoy.get(key(l.f, l.c))
      return { f: l.f, c: l.c, codigo, cambia: !!actual && (p?.codigo ?? null) !== codigo, siSeVende: siSeVende.get(key(l.f, l.c)) ?? null }
    }),
    acciones,
    reserva: ordenados.map((s) => ({ codigo: s.codigo, unidades: (disp.get(s.codigo) ?? 0) - (usados.has(s.codigo) ? 1 : 0) })).filter((r) => r.unidades > 0),
    resumen: {
      unidades: stock.reduce((s, x) => s + x.cantidad, 0),
      disponibles,
      codigos: ordenados.length,
      lugares: total,
      enVitrina,
      enReserva: disponibles - enVitrina,
      sinLugar: ordenados.length - enVitrina,
      paraDevolver: stock.reduce((s, x) => s + x.devolver, 0),
    },
  }
}

// Lo que había en la foto anterior y ya no está en la nueva: probablemente vendido (o movido de lugar).
export function faltantes(antes: Pos[] | null, ahora: Pos[]) {
  if (!antes) return []
  const hay = new Set(ahora.map((p) => p.codigo).filter(Boolean))
  return [...new Set(antes.map((p) => p.codigo).filter((c): c is string => !!c && !hay.has(c)))]
}
