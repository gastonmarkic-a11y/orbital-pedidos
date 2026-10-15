-- Catálogo público · referencia "precio desde el 1/11": para que el cliente vea cuánto sube cada producto
-- en noviembre y aproveche el precio de octubre. Solo lectura, no cambia ningún precio.
-- Precio de noviembre = el que va a poner aplicar_precios_programados() el 01/11 (precio_programado.precio_optica
-- por modelo), con sus mismas excepciones: SKU Zaira (respaldo del 13/10), modelos "- ZN" y clasificación
-- 'zaira nara' no cambian. Después del 01/11 (aplicado_at no nulo) ya no devuelve nada.
-- No devuelve nada para: links sin precios (vendedores de distribuidor) y GAFAS LUXURY (031022), que tiene
-- su propia lista exclusiva de noviembre.
create or replace function public.catalogo_precios_nov(p_clave text)
 returns table(modelo text, codigo text, precio_actual numeric, precio_nov numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_cli text; v_cod text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  if catalogo_sin_precios(p_clave) then return; end if;
  select ca.cod_cliente into v_cod from catalogo_acceso ca where ca.codigo = p_clave and ca.activo limit 1;
  if v_cod = '031022' then return; end if;
  v_cli := _catalogo_cli(p_clave);
  return query
  select s.modelo, s.codigo, s.precio,
    case when coalesce(s.precio, 0) > 0
          and not exists (select 1 from _bkp_stock_precio_zaira_20261013 z where z.codigo = s.codigo)
          and s.modelo not like '% - ZN' and coalesce(s.clasificacion, '') <> 'zaira nara'
         then p.precio_optica else s.precio end
  from stock s
  join stock_libre(v_cli, null, null) l on l.codigo = s.codigo
  join precio_programado p on p.modelo = s.modelo and p.aplicado_at is null
  where l.libre > 0;
end; $function$;

revoke all on function public.catalogo_precios_nov(text) from public;
grant execute on function public.catalogo_precios_nov(text) to anon, authenticated, service_role;
