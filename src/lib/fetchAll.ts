/* Supabase devuelve máximo 1000 filas por consulta.
   Este helper trae TODAS las filas paginando de a 1000. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchPaged<T>(make: () => any): Promise<T[]> {
  const page = 1000
  let from = 0
  const all: T[] = []
  for (;;) {
    const { data, error } = await make().range(from, from + page - 1)
    if (error || !data) break
    all.push(...(data as T[]))
    if (data.length < page) break
    from += page
  }
  return all
}
