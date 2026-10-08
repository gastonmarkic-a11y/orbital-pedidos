-- Día de la Madre: los distribuidores (010001/010002) también ven la promo en el catálogo,
-- con el precio óptico de referencia tachado y el precio de promo (48.000).
-- Solo cambia lo que se MUESTRA (catalogo_home / catalogo_modelo_v2). La facturación no se toca:
-- catalogo_crear_pedido sigue valorizando al distribuidor por su lista (óptico ÷ 1,41 en la Suite).

CREATE OR REPLACE FUNCTION public.catalogo_home(p_clave text)
 RETURNS TABLE(modelo text, precio_desde numeric, precio_lista_desde numeric, caliente boolean, n_colores bigint, imagenes text[], fotos jsonb, clasificaciones text[], tratamientos text[], is_bajaluz boolean, has_bluecut boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_sp boolean; v_cli text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  v_sp := catalogo_sin_precios(p_clave);
  v_cli := _catalogo_cli(p_clave);
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  return query
  with lib as (select * from stock_libre(v_cli, null, null)),
  v as (
    select s.modelo as mod, s.es_caliente, s.clasificacion, s.tratamiento, s.tipo, s.descripcion,
      least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo), coalesce(pe.precio_neto, s.precio))) as precio,
      s.precio as precio_lista,
      (l.fisico_libre <= 0) as v_proy,
      row_number() over (partition by s.modelo order by coalesce(s.es_caliente,false) desc, (l.fisico_libre<=0), s.descripcion) as rn,
      (position('/' in s.descripcion) > 0
        and substring(s.descripcion from position('/' in s.descripcion)) ~* '(ocre|naranj|roj|amaril|ambar|ámbar)') as v_bajaluz,
      (s.tratamiento ilike '%blue cut%') as v_bluecut,
      (not v_sp and _promo_precio_sku(s.codigo, s.modelo) is not null) as v_pm,
      (select pi.url from producto_imagenes pi
         where pi.codigo = s.codigo and pi.url not ilike '%packaging%' and not pi.es_lifestyle
         order by pi.orden nulls last, pi.id limit 1) as img_prod,
      (select pi.url from producto_imagenes pi
         where pi.codigo = s.codigo and pi.url not ilike '%packaging%'
         order by pi.orden nulls last, pi.id limit 1) as img_any,
      (select pi.url from producto_imagenes pi
         where pi.modelo = s.modelo and pi.codigo is null and pi.url not ilike '%packaging%'
         order by (pi.es_lifestyle), pi.orden nulls last, pi.id limit 1) as img_modelo
    from stock s
    join lib l on l.codigo = s.codigo
    left join cliente_precio_especial pe
      on v_cod is not null and pe.cod_cliente = v_cod and pe.modelo = s.modelo
    where l.libre > 0
  ),
  agg as (
    select v.mod,
      min(v.precio) filter (where v.precio > 0) as precio_desde,
      min(v.precio_lista) filter (where v.precio_lista > 0) as precio_lista_desde,
      bool_or(coalesce(v.es_caliente,false)) as caliente,
      array_remove(array_agg(distinct v.clasificacion), null) as clasificaciones,
      array_remove(array_agg(distinct v.tratamiento), null) as tratamientos,
      bool_or(v.v_bajaluz) as is_bajaluz,
      bool_or(v.v_bluecut) as has_bluecut
    from v group by v.mod
  ),
  allf as (
    select d.mod,
      jsonb_agg(jsonb_build_object('u',d.u,'c',d.c,'t',d.t,'k',d.k,'tp',d.tp,'bl',d.bl,'bc',d.bc,'ca',d.ca,'pr',d.pr,'o',d.o,'pm',d.pm) order by d.rn) as fotos,
      array_remove(array_agg(d.u order by d.rn), null) as imgs
    from (
      select distinct on (v.mod, v.descripcion) v.mod,
        coalesce(v.img_prod, v.img_any, v.img_modelo) u, v.descripcion c, v.tratamiento t,
        v.clasificacion k, v.tipo tp, v.v_bajaluz bl, v.v_bluecut bc, coalesce(v.es_caliente,false) ca, v.v_proy pr, (v.img_prod is not null or v.img_any is not null) o, v.v_pm pm, v.rn
      from v order by v.mod, v.descripcion, v.rn
    ) d group by d.mod
  ),
  fallback as (
    select a.mod,
      (select pi.url from producto_imagenes pi
         where pi.modelo = a.mod and pi.codigo is null and pi.url not ilike '%packaging%'
         order by (pi.es_lifestyle), pi.orden nulls last, pi.id limit 1) as u
    from agg a
  )
  select a.mod,
    case when v_sp then 0 else a.precio_desde end,
    case when v_sp then 0 else a.precio_lista_desde end,
    a.caliente,
    coalesce(jsonb_array_length(al.fotos), 0)::bigint as n_colores,
    coalesce(nullif(al.imgs, '{}'), case when fb.u is not null then array[fb.u] else '{}'::text[] end) as imagenes,
    coalesce(al.fotos,
      case when fb.u is not null then jsonb_build_array(jsonb_build_object('u',fb.u,'c',null,'t',null,'k',null,'tp',null,'bl',false,'bc',false,'ca',false,'pr',false))
      else '[]'::jsonb end) as fotos,
    a.clasificaciones, a.tratamientos, a.is_bajaluz, a.has_bluecut
  from agg a
  left join allf al on al.mod = a.mod
  left join fallback fb on fb.mod = a.mod
  order by a.caliente desc, a.mod;
end; $function$;

CREATE OR REPLACE FUNCTION public.catalogo_modelo_v2(p_clave text, p_modelo text, p_tipo text DEFAULT NULL::text, p_clasif text DEFAULT NULL::text, p_trat text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descripcion text, tipo text, tratamiento text, clasificacion text, precio numeric, precio_lista numeric, tiene_preventa boolean, caliente boolean, imagen text, stock integer, proyectado boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_sp boolean; v_cli text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  v_sp := catalogo_sin_precios(p_clave);
  v_cli := _catalogo_cli(p_clave);
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  return query
  with lib as (select * from stock_libre(v_cli, null, null))
  select s.codigo, s.descripcion, s.tipo, s.tratamiento, s.clasificacion,
    case when v_sp then 0
         else least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo), coalesce(pe.precio_neto, s.precio))) end as precio,
    case when v_sp then 0 else s.precio end as precio_lista,
    false as tiene_preventa,
    coalesce(s.es_caliente,false) as caliente,
    (select pi.url from producto_imagenes pi
       where pi.codigo = s.codigo and pi.url not ilike '%packaging%'
       order by pi.orden nulls last, pi.id limit 1) as imagen,
    greatest(l.libre,0)::int as stock,
    (l.fisico_libre <= 0) as proyectado
  from stock s
  join lib l on l.codigo = s.codigo
  left join cliente_precio_especial pe
    on v_cod is not null and pe.cod_cliente = v_cod and pe.modelo = s.modelo
  where s.modelo = p_modelo and l.libre > 0
    and (p_tipo is null or s.tipo = p_tipo)
    and (p_clasif is null or s.clasificacion = p_clasif)
    and (p_trat is null or s.tratamiento = p_trat)
  order by (l.fisico_libre <= 0), coalesce(s.es_caliente,false) desc, s.descripcion;
end; $function$;
