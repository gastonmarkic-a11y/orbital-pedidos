// ── Cómo funciona: instructivo para el cliente, dentro del panel ─────────────
// Vive acá (y no en un PDF aparte) para que cada sucursal lo lea con su propio link, y para que los
// números del ejemplo sean los de verdad: salen de la misma central que ve en pantalla.
import { BookOpen } from 'lucide-react'
import type { Central } from './CentralConsigna'

const fmt = (n: number) => n.toLocaleString('es-AR')

export default function Instructivo({ data, esCentral }: { data: Central; esCentral: boolean }) {
  const tot = (k: 'cantidad' | 'devolver' | 'en_camino') => data.stock.reduce((s, l) => s + l[k], 0)
  const cliente = data.madre?.nombre ?? 'el cliente'

  return (
    <section className="bg-white border border-black/10 rounded-lg">
      <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2 mr-auto"><BookOpen size={16} className="text-gold" /> Cómo funciona</h2>
        <span className="text-xs text-muted">Consigna Orbital · {cliente}</span>
      </div>

      <div className="px-4 py-4 max-w-[70ch] flex flex-col gap-5 text-sm leading-relaxed">
        <p className="text-muted">
          Este panel maneja el stock de Orbital que está en los locales, en consigna. La mercadería es de Orbital
          hasta que se vende: recién ahí se factura y Orbital la repone. Se entra con un link, sin usuario ni
          contraseña, y lo que carga un local se ve al instante en la central y en las otras sucursales.
        </p>

        <div className="grid sm:grid-cols-3 gap-3">
          <Tarjeta titulo="En los locales" valor={`${fmt(tot('cantidad'))} u`} nota="Incluye lo marcado para devolver" />
          <Tarjeta titulo="A devolver" valor={`${fmt(tot('devolver'))} u`} nota="Lo pide Orbital; lo registra la central" tono="text-amber-700" />
          <Tarjeta titulo="En camino" valor={`${fmt(tot('en_camino'))} u`} nota="Hasta que la sucursal lo recibe" tono="text-emerald-700" />
        </div>

        <Bloque titulo="Los links">
          <p>
            Hay un link para la <b>central</b> y uno por cada <b>sucursal</b>. La central ve todas las sucursales,
            registra las devoluciones, autoriza los pedidos de los locales y mueve stock entre ellos. Cada sucursal
            ve su stock y el de las otras, recibe los envíos, pide a Orbital, carga postventa y atiende las
            consultas de clientes.
          </p>
          <p>
            Los links de las sucursales salen de la solapa <b>Links de sucursal</b> (solo la ve la central), con
            botón para copiar o mandar por WhatsApp. Cada link es único de ese local y entra sin clave, así que
            conviene no compartirlo fuera de la sucursal. Con <b>Instalar</b>, arriba, queda como una app en la
            computadora o el celular del local.
          </p>
          <p>
            Poné tu nombre en <b>Operando como</b>: queda registrado en cada movimiento.
          </p>
        </Bloque>

        <Bloque titulo="Cuando llega un envío">
          <p>
            En <b>Sucursal</b> está la lista de lo que viene. Se controla contra la caja y se toca <b>Recibí todo</b>,
            o el tilde de cada modelo si llega en partes. Ahí esas unidades pasan al stock del local y dejan de
            figurar como en camino. En <b>En camino</b> está cada envío como un pedido, con lo que falta recibir.
          </p>
        </Bloque>

        <Bloque titulo="Cuando Orbital pide una devolución">
          <p>
            Son modelos que salen de la colección, colores sin ventas o excedentes. La registra la <b>central</b>,
            en la solapa <b>Devolución</b>: está todo junto por producto y al lado en qué sucursal está cada unidad.
            Los locales la ven pero no la registran, así que dos personas no pueden cargar lo mismo.
          </p>
          <ul className="list-disc pl-5">
            <li><b>Devolver:</b> esas unidades salen del stock del local y quedan registradas como devueltas.</li>
            <li><b>Se queda:</b> se las quedan para venderlas; pasan a stock normal y dejan de figurar como devolución.</li>
          </ul>
          <p>
            Se puede hacer por partes (de 18 devolver 12 y quedarse 6). Si venden algo marcado para devolver, se
            descuenta solo. Hasta que no se registra, esas unidades siguen contando en el stock del local: es el
            número en ámbar con la flecha ↩.
          </p>
        </Bloque>

        <Bloque titulo="Cómo se informa la venta y cómo se repone">
          <p>
            Por ahora la venta se informa por <b>Excel</b>, semanal o mensual, con lo que vendió cada sucursal.
            Con ese archivo, al mismo tiempo: se descuenta del stock de consigna, se factura lo vendido y se repone
            sin que haya que pedir nada.
          </p>
          <ul className="list-disc pl-5">
            <li><b>Lo que rota se repone igual</b>, uno por uno, si hay stock en Orbital. Sale como pedido automático a esa sucursal.</li>
            <li><b>Lo vendido por saldo o sin stock</b> se cambia por otro producto: primero lo más vendido de la cadena, después lo más vendido de Orbital, después productos nuevos. Esos reemplazos los revisa Orbital antes de despacharlos.</li>
          </ul>
          <p>
            En <b>Reposición por venta</b> queda, por liquidación y por sucursal: cuánto vendieron, cuánto fue por
            saldo, cuánto se repone igual, cuántas unidades son de reemplazo y si ya están aprobadas.
          </p>
        </Bloque>

        <Bloque titulo="Lo demás que pueden hacer">
          <p>
            <b>Stock online:</b> el depósito de Orbital con fotos, para pedir fuera de la reposición. No muestra
            precios ni cantidades; el local arma el pedido y lo autoriza la central.
          </p>
          <p>
            <b>Stock de todas:</b> la grilla de modelo por sucursal con el total de la cadena, y <b>Mover stock</b>
            para pasar unidades de un local a otro. Lo marcado para devolver no se puede mover.
          </p>
          <p>
            <b>Postventa:</b> garantías, roturas y repuestos. Se elige el producto, se cuenta qué pasó y queda una
            conversación con Orbital en la misma pantalla.
          </p>
          <p>
            <b>Consultas IRIS:</b> cuando un consumidor le escribe a Orbital por un modelo y está en la zona de una
            sucursal, se lo mandamos a ese local y la consulta aparece acá con su WhatsApp. Cada local marca cómo
            terminó: contactado, vendió o no compró.
          </p>
        </Bloque>

        <Bloque titulo="Hasta dónde llega">
          <p>
            El panel maneja <b>stock</b>. No muestra precios, no emite facturas y no reemplaza al sistema del
            cliente. La factura la hace Orbital sobre la liquidación, y la cuenta, el pago y la cobranza siguen
            siendo de la casa central, no de cada local.
          </p>
          <p className="text-muted">
            A cargo de Orbital: pedir y recibir las devoluciones, aprobar los reemplazos, autorizar y despachar, y
            cargar la liquidación. A cargo del cliente: recibir los envíos, registrar la devolución, informar la
            venta y pedir lo que necesite.
          </p>
        </Bloque>

        {esCentral && (
          <p className="text-xs text-muted border-t border-black/10 pt-3">
            Dudas o algo que no cierre: escribinos por la solapa Postventa o al vendedor de la cuenta.
          </p>
        )}
      </div>
    </section>
  )
}

function Tarjeta({ titulo, valor, nota, tono = '' }: { titulo: string; valor: string; nota: string; tono?: string }) {
  return (
    <div className="border border-black/10 rounded-lg px-3 py-2 bg-[#FBF9F4]">
      <div className="text-[10px] uppercase tracking-wider text-muted">{titulo}</div>
      <div className={`text-lg font-semibold tabular-nums leading-tight ${tono}`}>{valor}</div>
      <div className="text-[11px] text-faint">{nota}</div>
    </div>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-[15px]">{titulo}</h3>
      {children}
    </div>
  )
}
