-- Promos de precio por modelo con vigencia (primera: Especial Día de la Madre 2026).
-- El precio de promo es NETO y cerrado: no se le suman comercial / escalera / contado.
-- Solo aplica si baja el precio (least): distribuidores y precios especiales más bajos quedan como están.
-- Fuera de [desde, hasta) no existe: el catálogo y la Suite vuelven solos a la lista.

create table if not exists promo_precio (
  id bigserial primary key,
  promo text not null,              -- etiqueta visible: "Día de la Madre"
  modelo text not null,
  precio numeric not null,          -- neto final por unidad (sin IVA)
  desde timestamptz not null,
  hasta timestamptz not null,       -- exclusivo
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists promo_precio_modelo on promo_precio (modelo);
-- codigo null = todo el modelo; con codigo = solo ese color (SKU).
alter table promo_precio add column if not exists codigo text;
alter table promo_precio enable row level security;
drop policy if exists promo_precio_lectura on promo_precio;
create policy promo_precio_lectura on promo_precio for select to authenticated using (true);

-- Precio de promo vigente para un modelo en un momento dado (null = sin promo).
create or replace function _promo_precio(p_modelo text, p_at timestamptz default now())
returns numeric language sql stable security definer set search_path to 'public' as $$
  select min(precio) from promo_precio
   where activo and modelo = p_modelo and p_at >= desde and p_at < hasta
$$;

-- Igual, por color: vale la fila del SKU o la de todo el modelo (codigo null).
create or replace function _promo_precio_sku(p_codigo text, p_modelo text, p_at timestamptz default now())
returns numeric language sql stable security definer set search_path to 'public' as $$
  select min(precio) from promo_precio
   where activo and modelo = p_modelo and (codigo is null or codigo = p_codigo)
     and p_at >= desde and p_at < hasta
$$;

-- Se carga apagada: se prende (update ... set activo = true) recién cuando la Suite que la respeta está publicada.
insert into promo_precio (promo, modelo, precio, desde, hasta, activo)
select 'Día de la Madre', m, 48000, now(), '2026-10-20 00:00:00-03', false
  from unnest(array['LOS HAMPTON','BRERA','CHARLOTTE','VENICE','CRETA','PARIS','SOPHIA','REBECCA',
                    'ROMA','ATLANTIC CITY','WYNWOOD','PALERMO','BROOKLYN']) m
 where not exists (select 1 from promo_precio where promo = 'Día de la Madre');

-- ── catalogo_home: precio = min(lista/especial, promo) ──
CREATE OR REPLACE FUNCTION public.catalogo_home(p_clave text)
 RETURNS TABLE(modelo text, precio_desde numeric, precio_lista_desde numeric, caliente boolean, n_colores bigint, imagenes text[], fotos jsonb, clasificaciones text[], tratamientos text[], is_bajaluz boolean, has_bluecut boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_sp boolean; v_cli text; v_dist boolean;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  v_sp := catalogo_sin_precios(p_clave);
  v_cli := _catalogo_cli(p_clave);
  v_dist := coalesce(v_cli in ('010001','010002'), false);
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  return query
  with lib as (select * from stock_libre(v_cli, null, null)),
  v as (
    select s.modelo as mod, s.es_caliente, s.clasificacion, s.tratamiento, s.tipo, s.descripcion,
      case when v_dist then coalesce(pe.precio_neto, s.precio)
           else least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo), coalesce(pe.precio_neto, s.precio))) end as precio,
      s.precio as precio_lista,
      (l.fisico_libre <= 0) as v_proy,
      row_number() over (partition by s.modelo order by coalesce(s.es_caliente,false) desc, (l.fisico_libre<=0), s.descripcion) as rn,
      (position('/' in s.descripcion) > 0
        and substring(s.descripcion from position('/' in s.descripcion)) ~* '(ocre|naranj|roj|amaril|ambar|ámbar)') as v_bajaluz,
      (s.tratamiento ilike '%blue cut%') as v_bluecut,
      (not v_sp and not v_dist and _promo_precio_sku(s.codigo, s.modelo) is not null) as v_pm,
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

-- ── catalogo_modelo_v2: mismo precio por color ──
CREATE OR REPLACE FUNCTION public.catalogo_modelo_v2(p_clave text, p_modelo text, p_tipo text DEFAULT NULL::text, p_clasif text DEFAULT NULL::text, p_trat text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descripcion text, tipo text, tratamiento text, clasificacion text, precio numeric, precio_lista numeric, tiene_preventa boolean, caliente boolean, imagen text, stock integer, proyectado boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_sp boolean; v_cli text; v_dist boolean;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  v_sp := catalogo_sin_precios(p_clave);
  v_cli := _catalogo_cli(p_clave);
  v_dist := coalesce(v_cli in ('010001','010002'), false);
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  return query
  with lib as (select * from stock_libre(v_cli, null, null))
  select s.codigo, s.descripcion, s.tipo, s.tratamiento, s.clasificacion,
    case when v_sp then 0
         when v_dist then coalesce(pe.precio_neto, s.precio)
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

-- ── catalogo_checkout: los modelos con promo se valorizan en el servidor ──
-- (un carrito guardado antes/después de la promo no puede arrastrar un precio viejo).
-- Cada ítem en promo queda marcado con 'promo' y 'precio_lista' → la Suite muestra el descuento.
CREATE OR REPLACE FUNCTION public.catalogo_checkout(p_clave text, p_identificador text, p_contacto text, p_wsp text, p_mail text, p_items jsonb, p_obs text, p_razon text DEFAULT NULL::text, p_acceso text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cli record; v_acc record;
  v_id text := trim(coalesce(p_identificador,''));
  v_digits text := regexp_replace(coalesce(p_identificador,''), '\D', '', 'g');
  v_total int; v_importe numeric; v_pre_id bigint;
  v_vendedor text; v_cliente_lbl text; v_cod text; v_logueado text;
  v_items jsonb := p_items; v_sp boolean; v_obs text;
  v_falt jsonb; v_falt_txt text; v_pcli text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Carrito vacío');
  end if;

  v_sp := catalogo_sin_precios(p_clave);

  v_obs := nullif(trim(coalesce(p_obs,'')),'');
  if v_sp then
    v_obs := concat_ws(' · ', '🏢 VENDEDOR DE DISTRIBUIDOR — armó el pedido sin ver precios', v_obs);
  end if;

  -- Siempre se ejecuta (aunque p_acceso sea null) para que v_acc quede asignado.
  select * into v_acc from catalogo_acceso where codigo = p_acceso and activo limit 1;

  -- Vendedor logueado en la Suite que armó el pedido desde su navegador.
  select v.codigo into v_logueado from vendedores v
   where v.user_id = auth.uid() and v.activo and v.rol = 'vendedor' limit 1;

  select * into v_cli from clientes c
  where c.cod = v_id
     or (length(v_digits) >= 8 and regexp_replace(coalesce(c.cuit,''), '\D','','g') = v_digits)
     or (v_id ~ '@' and lower(c.email) = lower(v_id))
  limit 1;

  if v_cli.cod is null then
    if coalesce(trim(p_razon),'') = '' then
      return jsonb_build_object('ok', false, 'need', 'razon');
    end if;
    v_cod := null;
    v_cliente_lbl := 'PROSPECTO - ' || trim(p_razon);
  else
    v_cod := v_cli.cod;
    v_cliente_lbl := v_cli.cod || ' - ' || coalesce(v_cli.razon, v_cli.nomcomerc, '');
  end if;

  -- Tope de stock en el servidor: lo libre (físico + proyectado − pedidos pendientes − precargas abiertas).
  perform pg_advisory_xact_lock(hashtext('orbital_stock'));
  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'modelo', s.modelo, 'descripcion', s.descripcion,
                                               'pedido', x.q, 'disponible', greatest(coalesce(l.libre,0),0))), '[]'::jsonb),
         string_agg(coalesce(s.modelo,x.codigo) || ' ' || coalesce(s.descripcion,'') || ' (quedan ' || greatest(coalesce(l.libre,0),0) || ')', ', ')
    into v_falt, v_falt_txt
    from (select i->>'codigo' codigo, sum((i->>'cantidad')::int)::int q from jsonb_array_elements(p_items) i group by 1) x
    left join stock_libre(coalesce(v_cod, v_acc.cod_cliente), null, null) l on l.codigo = x.codigo
    left join stock s on s.codigo = x.codigo
   where x.q > coalesce(l.libre,0);
  if jsonb_array_length(v_falt) > 0 then
    return jsonb_build_object('ok', false, 'error',
      'Mientras armabas el pedido se vendieron unidades. Ajustá estas cantidades: ' || v_falt_txt, 'faltantes', v_falt);
  end if;

  -- Token sin precios (vendedor de distribuidor): los importes no salieron nunca al
  -- navegador, así que el pedido se valoriza acá con la lista real. Distribuidores
  -- (010001/010002) = lista 1 = precio ÷ 1,41 (mismo redondeo que la Suite).
  if v_sp then
    select coalesce(jsonb_agg(it.value || jsonb_build_object('precio',
             case when v_cod in ('010001','010002') then round(coalesce(s.precio, 0) / 1.41)
                  else coalesce(s.precio, 0) end)), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(p_items) it(value)
      left join stock s on s.codigo = it.value->>'codigo';
  else
    -- Modelos que tienen o tuvieron promo: precio = min(lista/especial, promo vigente).
    v_pcli := coalesce(v_cod, v_acc.cod_cliente);
    select coalesce(jsonb_agg(
             case when pp.base is null then it.value
                  else it.value || jsonb_build_object('precio', pp.ok)
                       || case when pp.ok < pp.base
                               then jsonb_build_object('promo', pp.nom, 'precio_lista', pp.base)
                               else '{}'::jsonb end
             end order by it.ord), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(p_items) with ordinality it(value, ord)
      left join lateral (
        select coalesce(pe.precio_neto, s.precio) base,
               (select pr.promo from promo_precio pr where pr.modelo = s.modelo and pr.activo order by pr.hasta desc limit 1) nom,
               case when v_pcli in ('010001','010002') then coalesce(pe.precio_neto, s.precio)
                    else least(coalesce(pe.precio_neto, s.precio), coalesce(_promo_precio_sku(s.codigo, s.modelo), coalesce(pe.precio_neto, s.precio))) end ok
          from stock s
          left join cliente_precio_especial pe on pe.cod_cliente = v_pcli and pe.modelo = s.modelo
         where s.codigo = it.value->>'codigo'
           and exists (select 1 from promo_precio pr where pr.modelo = s.modelo and pr.activo)
      ) pp on true;
  end if;

  v_vendedor := case
    when v_logueado is not null then v_logueado
    when coalesce(v_acc.tipo,'optica') <> 'optica' and _vend_activo(v_acc.vendedor) then v_acc.vendedor
    when _vend_activo(v_cli.vendedor_asignado) then v_cli.vendedor_asignado
    when _vend_activo(v_acc.vendedor) then v_acc.vendedor
    else 'Ulises' end;

  select coalesce(sum((it->>'cantidad')::int),0),
         coalesce(sum((it->>'cantidad')::int * (it->>'precio')::numeric),0)
    into v_total, v_importe
  from jsonb_array_elements(v_items) it;

  insert into catalogo_precarga (cod_cliente, cliente_razon, vendedor, contacto, wsp, mail,
                                 obs, items, total_units, importe, acceso)
  values (v_cod, v_cliente_lbl, v_vendedor,
          nullif(trim(p_contacto),''), nullif(trim(p_wsp),''), nullif(trim(p_mail),''),
          v_obs, v_items, v_total, v_importe, v_acc.codigo)
  returning id into v_pre_id;

  return jsonb_build_object('ok', true, 'precarga_id', v_pre_id, 'cliente', v_cliente_lbl,
                            'total_units', v_total, 'importe', v_importe,
                            'identificado', (v_cod is not null));
end; $function$;


-- ── Día de la Madre por COLOR (2/10): solo los colores de la colección Para Ellas de Shopify ──
-- (orbitaleyewear.com.ar/collections/para-ellas). Cruce por SKU y, si el SKU de la tienda es otro
-- código, por modelo + color normalizado. El stock lo filtra el catálogo en vivo (libre > 0).
create or replace function _norm_color(t text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(translate(lower(coalesce(t,'')),'áéíóúü','aeiouu'),'\s*/\s*','/','g'),'\s+',' ','g'))
$$;
update promo_precio set activo = (codigo is not null) where promo = 'Día de la Madre';
insert into promo_precio (promo, modelo, codigo, precio, desde, hasta, activo)
select 'Día de la Madre', s.modelo, s.codigo, 48000, now(), '2026-10-20 00:00:00-03', true
  from stock s
 where (s.codigo in ('002050978900103','002050921900100','000050A27900100','002050960901183','000050A28900100','00205096092553F','00205096490000P','000050A29905414','000050A28905402','000050707902811','00205096390010P','00205096090010P','00205096090123F','000050A29900100','000050A27973502','000050A25925511','002050917905412','000050A32972604','000050A29905412','000050A29900103','000050A28905412','000050A27905402','000050A32900204','000050A32900003','000050A32903804','000050A32905402','002050964900105','002050917900111','002050964925500','002050964900258','002050964925556','002050964900212','002050964900202','000050A32900100','002050A36973404','000050A29973502','000050A28973502','000050A27905412','000050A27900114','002050964900134','002050943900103','002050943905400','000050A32973411','000050A3290015F','00205096390125F','002050963972212','002050963900058','002050960900914','002050917900114','00205097890002P','00005070790286F','000050707902800','00205096096493F','002050921905402','002050921900103','002050A36905402','002050A36905412','002050A36973504','002050A36900100','000050A29900105','000050A29900111','000050A29973404','000050A28973402','000050A28900111','000050A28900114','000050A27900111','000050A25900214','002050921925503','002050943903502','000050A32900103','000050A32905404','000050A32903811','000050A32972602','000050A32925500','000050A32900202','000050A32904804','000050A3290010P')
        or (s.modelo, _norm_color(s.descripcion)) in (select m, _norm_color(c) from (values
          ('LOS HAMPTON','Negro Brillo / Gris Degrade'),
          ('BRERA','Negro Brillo / Gris'),
          ('CHARLOTTE','Negro Brillo / Gris'),
          ('VENICE','Verde Clear / Flash Deg Verde'),
          ('CRETA','Negro Brillo / Gris'),
          ('VENICE','Gris Clear / Flash Deg Gris'),
          ('PARIS','Negro Mate / Gris Polarizado'),
          ('SOPHIA','Carey Brillo Clear / Rosa'),
          ('CRETA','Carey Brillo Clear / Habano'),
          ('REBECCA','Dorado Brillo / Verde'),
          ('ROMA','Negro Brillo / Gris Polarizado'),
          ('VENICE','Negro Brillo / Gris Polarizado'),
          ('VENICE','Celeste Clear / Gris Flash'),
          ('SOPHIA','Negro Brillo / Gris'),
          ('CHARLOTTE','Hueso Brillo / Habano'),
          ('ATLANTIC CITY','Gris Brillo Clear / Verde'),
          ('WYNWOOD','Carey Mate / Celeste'),
          ('PALERMO','Beige Pastel Mate Compacto / Habano Degrade'),
          ('SOPHIA','Carey Brillo Clear / Celeste'),
          ('SOPHIA','Negro Brillo / Gris Degrade'),
          ('CRETA','Carey Brillo Clear / Celeste'),
          ('CHARLOTTE','Carey Brillo Clear / Habano'),
          ('PALERMO','Habano Brillo Clear / Habano Degrade'),
          ('PALERMO','Negro Mate Compacto / Gris Degrade'),
          ('PALERMO','Marron Mate / Habano Degrade'),
          ('PALERMO','Carey Brillo Clear / Habano'),
          ('PARIS','Negro Brillo / Ocre'),
          ('WYNWOOD','Negro Brillo / Verde'),
          ('PARIS','Gris Brillo Clear / Gris'),
          ('PARIS','Habano Brillo / Champagne'),
          ('PARIS','Gris Clear / Plateado Espejado'),
          ('PARIS','Habano   Brillo Clear / Celeste'),
          ('PARIS','Habano   Brillo Clear / Habano'),
          ('PALERMO','Negro Brillo / Gris'),
          ('WYNWOOD','Marron Brillo / Habano Degrade'),
          ('SOPHIA','Hueso Brillo / Habano'),
          ('CRETA','Hueso Brillo / Habano'),
          ('CHARLOTTE','Carey Brillo Clear / Celeste'),
          ('CHARLOTTE','Negro Brillo / Rosa'),
          ('PARIS','Negro Brillo / Naranja'),
          ('BROOKLYN','Negro Brillo - Gris Degrade'),
          ('BROOKLYN','Carey - Gris'),
          ('PALERMO','Marron Brillo Compacto / Verde'),
          ('PALERMO','Negro Brillo / Celeste Flash'),
          ('LOS HAMPTON','Negro Brillo / Espejo Rosa'),
          ('LOS HAMPTON','Negro Brillo / Espejo Champagne'),
          ('ROMA','Negro Brillo / Amarillo'),
          ('ROMA','Bordo Mate / Espejo Rosa'),
          ('ROMA','Celeste Clear / Celeste Flash'),
          ('ROMA','Celeste Clear / Celeste'),
          ('ROMA','Negro Mate / Espejo Oro'),
          ('VENICE','Bordo Mate / Rosa'),
          ('WYNWOOD','Negro Brillo / Rosa'),
          ('LOS HAMPTON','Negro Mate / Habano Polarizado'),
          ('REBECCA','Dorado Brillo / Habano Flash Degrade'),
          ('REBECCA','Dorado Brillo / Gris'),
          ('VENICE','Amarillo Clear / Gris Flash'),
          ('BRERA','Carey Brillo / Habano'),
          ('BRERA','Negro Brillo / Gris Degrade'),
          ('WYNWOOD','Carey Brillo Clear / Habano'),
          ('WYNWOOD','Carey Brillo Clear / Celeste'),
          ('WYNWOOD','Hueso Brillo / Habano Degrade'),
          ('WYNWOOD','Negro Brillo / Gris'),
          ('SOPHIA','Negro Brillo / Ocre'),
          ('SOPHIA','Negro Brillo / Verde'),
          ('SOPHIA','Marron Brillo / Habano Degrade'),
          ('CRETA','Marron Brillo / Habano'),
          ('CRETA','Negro Brillo / Verde'),
          ('CRETA','Negro Brillo / Rosa'),
          ('CHARLOTTE','Negro Brillo / Verde'),
          ('ATLANTIC CITY','Habano Brillo Clear / Rosa'),
          ('BRERA','Gris Clear / Gris Degrade'),
          ('BROOKLYN','Azul Clear - Habano'),
          ('PALERMO','Negro Brillo Compacto / Gris Degrade'),
          ('PALERMO','Carey Brillo Clear / Habano Degrade'),
          ('PALERMO','Marron Mate / Verde'),
          ('PALERMO','Beige Pastel Mate / Habano'),
          ('PALERMO','Gris Brillo Clear / Gris'),
          ('PALERMO','Habano Brillo Clear / Habano'),
          ('PALERMO','Marrón Mate / Habano Degradé'),
          ('PALERMO','Negro Brillo / Gris Polarizado')) x(m, c)))
   and not exists (select 1 from promo_precio p where p.promo = 'Día de la Madre' and p.codigo = s.codigo);

-- Si la colección cubre TODOS los colores con stock de un modelo, la promo va por modelo entero
-- (fila con codigo null) y no color por color.
with cubiertos as (
  select s.modelo
    from stock s join stock_libre(null, null, null) l on l.codigo = s.codigo
   where l.libre > 0 and s.modelo in (select modelo from promo_precio where promo = 'Día de la Madre' and codigo is not null and activo)
   group by s.modelo
  having bool_and(exists (select 1 from promo_precio p where p.promo = 'Día de la Madre' and p.codigo = s.codigo and p.activo))
), alta as (
  update promo_precio p set activo = true
    from cubiertos c where p.promo = 'Día de la Madre' and p.codigo is null and p.modelo = c.modelo
  returning p.modelo
)
update promo_precio p set activo = false
  from cubiertos c where p.promo = 'Día de la Madre' and p.codigo is not null and p.modelo = c.modelo;
