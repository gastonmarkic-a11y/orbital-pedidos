-- Catálogo público · "Pedido grande (planilla)": todos los SKU con stock libre en una sola llamada.
-- Misma lógica que catalogo_modelo_v2 (precio especial por SKU y después por modelo, ocultos,
-- promo, sin precios para vendedores de distribuidor, stock libre / proyectado), sin filtrar modelo.
create or replace function public.catalogo_planilla(p_clave text)
 returns table(modelo text, codigo text, descripcion text, tipo text, tratamiento text, clasificacion text,
   precio numeric, precio_lista numeric, caliente boolean, imagen text, stock integer, proyectado boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_cod text; v_sp boolean; v_cli text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  v_sp := catalogo_sin_precios(p_clave);
  v_cli := _catalogo_cli(p_clave);
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  return query
  with lib as (select * from stock_libre(v_cli, null, null))
  select s.modelo, s.codigo, s.descripcion, s.tipo, s.tratamiento, s.clasificacion,
    case when v_sp then 0
         else least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo, now(), v_cod), coalesce(pe.precio_neto, s.precio))) end as precio,
    case when v_sp then 0 else s.precio end as precio_lista,
    coalesce(s.es_caliente,false) as caliente,
    coalesce(
      (select pi.url from producto_imagenes pi
         where pi.codigo = s.codigo and pi.url not ilike '%packaging%'
         order by pi.es_lifestyle, pi.orden nulls last, pi.id limit 1),
      (select pi.url from producto_imagenes pi
         where pi.modelo = s.modelo and pi.codigo is null and pi.url not ilike '%packaging%'
         order by pi.es_lifestyle, pi.orden nulls last, pi.id limit 1)) as imagen,
    greatest(l.libre,0)::int as stock,
    (l.fisico_libre <= 0) as proyectado
  from stock s
  join lib l on l.codigo = s.codigo
  left join lateral (select x.* from cliente_precio_especial x
    where v_cod is not null and x.cod_cliente = v_cod and x.modelo in (s.codigo, s.modelo)
    order by (x.modelo = s.codigo) desc limit 1) pe on true
  where l.libre > 0 and not coalesce(pe.oculto, false) and s.modelo is not null
  order by s.modelo, (l.fisico_libre <= 0), s.descripcion;
end; $function$;

revoke all on function public.catalogo_planilla(text) from public;
grant execute on function public.catalogo_planilla(text) to anon, authenticated, service_role;
