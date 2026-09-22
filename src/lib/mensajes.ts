// ── Textos fijos que van a la óptica ────────────────────────────────────────────
// Un solo lugar para que el mismo cierre salga igual desde la Suite y desde IRIS
// (el bot tiene su propia copia en supabase/functions/bot-central: son runtimes distintos).

// Cierre de TODO mensaje que lleva el token del cliente (catálogo o propuesta):
// el token es lo que hace que la app quede suya, así que conviene explicarlo siempre.
export const TXT_APP =
  '📲 *Bajate el catálogo como app*: te queda con ícono en el celular o la compu y entrás cuando quieras, sin volver a pedirnos el link. ' +
  'Vas a ver toda la colección en línea, el stock al día, las promos relámpago y las novedades apenas salen. El catálogo es tuyo 🙌'
