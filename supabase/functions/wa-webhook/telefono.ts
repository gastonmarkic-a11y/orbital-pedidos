// Normalización de teléfonos argentinos al NSN de 10 dígitos (área + abonado).
// ESPEJO EXACTO de la función SQL wa_nsn(). Si cambia una, cambiar la otra.
//
// El número entrante de Meta llega como E.164 sin '+' (ej. 5493416083594).
// Devolvemos el NSN de 10 díg. o null si no es un móvil argentino plausible.
export function toNsn(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d === "") return null;

  // código país + 9 de móvil
  if (d.startsWith("549")) {
    d = d.slice(3);
  } else if (d.startsWith("54") && d.length >= 12) {
    d = d.slice(2);
  }

  // prefijo interurbano
  if (d.startsWith("0")) {
    d = d.slice(1);
  }

  // '15' móvil embebido: sólo con 12 díg. (NSN de 10 + los 2 del 15)
  if (d.length === 12) {
    const off = d.slice(2).indexOf("15"); // buscar desde la pos. 2 (dejar el área)
    if (off >= 0) {
      const real = 2 + off;
      d = d.slice(0, real) + d.slice(real + 2);
    }
  }

  if (d.length === 10 && d[0] !== "0") {
    return d;
  }
  return null;
}
