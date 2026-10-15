-- Catálogo: la foto de la tienda (Shopify, tabla tienda_foto) manda sobre las de producto_imagenes.
-- Pedido de Gastón 15/10/2026: si el color tiene foto en la tienda, esa es la tapa del modelo y la foto de la ficha.
-- Además la ficha ya no muestra una lifestyle como foto del color si hay foto de producto (anteojo solo).

-- Foto de la tienda de un SKU. Si dos productos de la tienda apuntan al mismo SKU (BASEL, MILANO, ZETA 7),
-- gana el producto original (handle "modelo-N"), no la copia con nombre de color.
create or replace function public._tienda_foto_sku(p_codigo text)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select t.imagen from tienda_foto t
  where t.sku = p_codigo and t.imagen !~* 'ficha'
  order by (t.handle ~ '-\d+$') desc, t.handle limit 1
$$;
revoke all on function public._tienda_foto_sku(text) from public, anon, authenticated;

-- catalogo_home: igual que antes + foto de tienda primero. Flags nuevos en cada foto:
--   sh = es la foto de la tienda; g = es foto del anteojo (tienda o producto, no lifestyle)
create or replace function public.catalogo_home(p_clave text)
 returns table(modelo text, precio_desde numeric, precio_lista_desde numeric, caliente boolean, n_colores bigint, imagenes text[], fotos jsonb, clasificaciones text[], tratamientos text[], is_bajaluz boolean, has_bluecut boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
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
      least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo, now(), v_cod), coalesce(pe.precio_neto, s.precio))) as precio,
      s.precio as precio_lista,
      (l.fisico_libre <= 0) as v_proy,
      row_number() over (partition by s.modelo order by coalesce(s.es_caliente,false) desc, (l.fisico_libre<=0), s.descripcion) as rn,
      (position('/' in s.descripcion) > 0
        and substring(s.descripcion from position('/' in s.descripcion)) ~* '(ocre|naranj|roj|amaril|ambar|ámbar)') as v_bajaluz,
      (s.tratamiento ilike '%blue cut%') as v_bluecut,
      (not v_sp and _promo_precio_sku(s.codigo, s.modelo, now(), v_cod) is not null) as v_pm,
      _tienda_foto_sku(s.codigo) as img_shop,
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
    left join lateral (select x.* from cliente_precio_especial x
      where v_cod is not null and x.cod_cliente = v_cod and x.modelo in (s.codigo, s.modelo)
      order by (x.modelo = s.codigo) desc limit 1) pe on true
    where l.libre > 0 and not coalesce(pe.oculto, false)
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
      jsonb_agg(jsonb_build_object('u',d.u,'c',d.c,'t',d.t,'k',d.k,'tp',d.tp,'bl',d.bl,'bc',d.bc,'ca',d.ca,'pr',d.pr,'o',d.o,'pm',d.pm,'sh',d.sh,'g',d.g) order by d.rn) as fotos,
      array_remove(array_agg(d.u order by d.rn), null) as imgs
    from (
      select distinct on (v.mod, v.descripcion) v.mod,
        coalesce(v.img_shop, v.img_prod, v.img_any, v.img_modelo) u, v.descripcion c, v.tratamiento t,
        v.clasificacion k, v.tipo tp, v.v_bajaluz bl, v.v_bluecut bc, coalesce(v.es_caliente,false) ca, v.v_proy pr,
        (v.img_shop is not null or v.img_prod is not null or v.img_any is not null) o, v.v_pm pm,
        (v.img_shop is not null) sh, (v.img_shop is not null or v.img_prod is not null) g, v.rn
      from v order by v.mod, v.descripcion, (v.img_shop is not null) desc, v.rn
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

-- catalogo_modelo_v2 (ficha): foto de la tienda > foto de producto > cualquiera (lifestyle) como último recurso
create or replace function public.catalogo_modelo_v2(p_clave text, p_modelo text, p_tipo text default null, p_clasif text default null, p_trat text default null)
 returns table(codigo text, descripcion text, tipo text, tratamiento text, clasificacion text, precio numeric, precio_lista numeric, tiene_preventa boolean, caliente boolean, imagen text, stock integer, proyectado boolean)
 language plpgsql stable security definer set search_path to 'public'
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
  select s.codigo, s.descripcion, s.tipo, s.tratamiento, s.clasificacion,
    case when v_sp then 0
         else least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo, now(), v_cod), coalesce(pe.precio_neto, s.precio))) end as precio,
    case when v_sp then 0 else s.precio end as precio_lista,
    false as tiene_preventa,
    coalesce(s.es_caliente,false) as caliente,
    coalesce(_tienda_foto_sku(s.codigo),
      (select pi.url from producto_imagenes pi
         where pi.codigo = s.codigo and pi.url not ilike '%packaging%'
         order by pi.es_lifestyle, pi.orden nulls last, pi.id limit 1)) as imagen,
    greatest(l.libre,0)::int as stock,
    (l.fisico_libre <= 0) as proyectado
  from stock s
  join lib l on l.codigo = s.codigo
  left join lateral (select x.* from cliente_precio_especial x
    where v_cod is not null and x.cod_cliente = v_cod and x.modelo in (s.codigo, s.modelo)
    order by (x.modelo = s.codigo) desc limit 1) pe on true
  where s.modelo = p_modelo and l.libre > 0 and not coalesce(pe.oculto, false)
    and (p_tipo is null or s.tipo = p_tipo)
    and (p_clasif is null or s.clasificacion = p_clasif)
    and (p_trat is null or s.tratamiento = p_trat)
  order by (l.fisico_libre <= 0), coalesce(s.es_caliente,false) desc, s.descripcion;
end; $function$;
