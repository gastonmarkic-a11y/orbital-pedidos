-- Gastos de auto de los vendedores de campo (Adrián, Bruno, Lola). 2026-10-06
-- Lo que se reconoce sale de los CHECK-INS confirmados (visitas_checkin), no de lo que se carga:
--   · Combustible: km del día (base → visitas en orden → base, × factor de ruta) × consumo × precio.
--     Se compara a nivel MES (la nafta se carga cada tantos días, no por visita):
--     deducible = mín(cargado, teórico del mes).
--   · Peaje: sólo los días en que alguna visita queda a más de `umbral_km_peaje` de la base;
--     deducible del día = mín(cargado, tope_peaje_dia).
--   · Estacionamiento: por visita dentro de CABA (caja geográfica, la localidad de clientes no es
--     confiable); deducible del día = mín(cargado, visitas_caba × tope_estac_visita, tope_estac_dia).
--   · Un gasto en un día sin check-in no es deducible (queda marcado para revisar).
--   · "otro": no tiene regla, lo aprueba administración a mano.

-- 1. Parámetros del auto por vendedor ('*' = valores por defecto)
create table if not exists public.gastos_parametros (
  vendedor text primary key,
  base_direccion text,
  base_lat numeric, base_lon numeric,      -- de dónde sale y vuelve cada día (casa / oficina)
  km_acercamiento numeric not null default 20,   -- si no hay base: km fijos de ida y vuelta al primer/último punto
  consumo_l_100km numeric not null default 8,
  precio_litro numeric not null default 1700,
  factor_ruta numeric not null default 1.35,      -- línea recta → calle
  costo_km_desgaste numeric not null default 0,   -- amortización/mantenimiento por km (0 = no se reconoce)
  umbral_km_peaje numeric not null default 15,
  tope_peaje_dia numeric not null default 6000,
  tope_estac_visita numeric not null default 3000,
  tope_estac_dia numeric not null default 12000,
  actualizado_en timestamptz not null default now()
);
insert into public.gastos_parametros (vendedor) values ('*'), ('Adrian'), ('Bruno'), ('Lola')
on conflict (vendedor) do nothing;
-- Adrián hace interior: más peaje por día
update public.gastos_parametros set tope_peaje_dia = 15000 where vendedor = 'Adrian' and tope_peaje_dia = 6000;

-- 2. Gastos cargados
create table if not exists public.gastos_vendedor (
  id bigserial primary key,
  vendedor text not null,
  fecha date not null,
  tipo text not null check (tipo in ('combustible', 'peaje', 'estacionamiento', 'otro')),
  monto numeric not null check (monto > 0),
  litros numeric,
  comprobante_path text,            -- storage: gastos/<vendedor>/<archivo>
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  monto_aprobado numeric,
  revisado_por text,
  revisado_en timestamptz,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists gastos_vendedor_idx on public.gastos_vendedor (vendedor, fecha);

-- 3. Permisos: admin/administración ven todo; cada vendedor lo suyo
create or replace function public.gastos_puede_ver(p_vend text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_vendedor_rol() in ('admin', 'administracion'), false)
      or exists (select 1 from vendedores where user_id = auth.uid() and activo and codigo = p_vend)
      or exists (select 1 from vendedor_logins where user_id = auth.uid() and codigo = p_vend)
$$;

alter table public.gastos_vendedor enable row level security;
drop policy if exists gastos_ver on public.gastos_vendedor;
create policy gastos_ver on public.gastos_vendedor for select to authenticated using (public.gastos_puede_ver(vendedor));
drop policy if exists gastos_cargar on public.gastos_vendedor;
create policy gastos_cargar on public.gastos_vendedor for insert to authenticated
  with check (public.gastos_puede_ver(vendedor) and estado = 'pendiente' and monto_aprobado is null);
drop policy if exists gastos_borrar on public.gastos_vendedor;
create policy gastos_borrar on public.gastos_vendedor for delete to authenticated
  using (public.gastos_puede_ver(vendedor) and estado = 'pendiente');

alter table public.gastos_parametros enable row level security;
drop policy if exists gastos_param_ver on public.gastos_parametros;
create policy gastos_param_ver on public.gastos_parametros for select to authenticated using (true);
drop policy if exists gastos_param_editar on public.gastos_parametros;
create policy gastos_param_editar on public.gastos_parametros for all to authenticated
  using (public.current_vendedor_rol() in ('admin', 'administracion'))
  with check (public.current_vendedor_rol() in ('admin', 'administracion'));

-- Aprobar / rechazar (sólo admin y administración)
create or replace function public.gastos_revisar(p_id bigint, p_estado text, p_monto numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.current_vendedor_rol(), '') not in ('admin', 'administracion') then
    raise exception 'Sin permiso';
  end if;
  if p_estado not in ('pendiente', 'aprobado', 'rechazado') then raise exception 'Estado inválido'; end if;
  update gastos_vendedor
     set estado = p_estado,
         monto_aprobado = case when p_estado = 'aprobado' then coalesce(p_monto, monto) when p_estado = 'rechazado' then 0 end,
         revisado_por = (select codigo from vendedores where user_id = auth.uid() limit 1),
         revisado_en = case when p_estado = 'pendiente' then null else now() end
   where id = p_id;
end $$;

-- 4. Distancia en metros (haversine, sin PostGIS)
create or replace function public.gastos_dist_m(a_lat numeric, a_lon numeric, b_lat numeric, b_lon numeric)
returns numeric language sql immutable as $$
  select case when a_lat is null or b_lat is null then null else
    (6371000 * acos(least(1, greatest(-1,
      cos(radians(a_lat)) * cos(radians(b_lat)) * cos(radians(b_lon) - radians(a_lon))
      + sin(radians(a_lat)) * sin(radians(b_lat))))))::numeric end
$$;

-- 5. Jornadas: un renglón por día con check-ins o gastos, con lo reconocido y lo cargado
create or replace function public.gastos_jornadas(p_vendedor text, p_desde date, p_hasta date)
returns table (
  fecha date, visitas integer, visitas_sin_gps integer, visitas_caba integer,
  km numeric, dist_max_base_km numeric,
  combustible_teorico numeric, desgaste numeric, tope_peaje numeric, tope_estac numeric,
  cargado_combustible numeric, litros numeric, cargado_peaje numeric, cargado_estac numeric, cargado_otro numeric,
  deducible_peaje numeric, deducible_estac numeric, puntos jsonb
) language plpgsql stable security definer set search_path = public as $$
declare pr gastos_parametros;
begin
  if not public.gastos_puede_ver(p_vendedor) then raise exception 'Sin permiso'; end if;
  select * into pr from gastos_parametros where vendedor = p_vendedor;
  if not found then select * into pr from gastos_parametros where vendedor = '*'; end if;

  return query
  with pts as (
    select (v.creado_en at time zone 'America/Argentina/Buenos_Aires')::date as f, v.creado_en as t, v.cod_cliente,
           coalesce(nullif(trim(c.nomcomerc), ''), c.razon, v.nombre_detectado) as nombre,
           coalesce(v.lat, c.lat)::numeric as lat, coalesce(v.lon, c.lon)::numeric as lon
    from visitas_checkin v
    left join clientes c on c.cod = v.cod_cliente
    where v.vendedor = p_vendedor and v.estado = 'confirmado'
      and (v.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
  ), geo as (
    select p.*,
           lag(p.lat) over w as plat, lag(p.lon) over w as plon,
           row_number() over w as rn, count(*) over (partition by p.f) as n
    from pts p where p.lat is not null
    window w as (partition by p.f order by p.t)
  ), dia as (
    select g.f,
           coalesce(sum(case when g.rn > 1 then gastos_dist_m(g.plat, g.plon, g.lat, g.lon) end), 0) as entre_m,
           coalesce(sum(case when g.rn = 1 then gastos_dist_m(pr.base_lat, pr.base_lon, g.lat, g.lon) end), 0)
             + coalesce(sum(case when g.rn = g.n then gastos_dist_m(g.lat, g.lon, pr.base_lat, pr.base_lon) end), 0) as base_m,
           max(gastos_dist_m(pr.base_lat, pr.base_lon, g.lat, g.lon)) as max_base_m,
           count(*) filter (where g.lat between -34.705 and -34.527 and g.lon between -58.531 and -58.335) as en_caba,
           jsonb_agg(jsonb_build_object('t', g.t, 'cod', g.cod_cliente, 'nombre', g.nombre, 'lat', g.lat, 'lon', g.lon) order by g.t) as pj
    from geo g group by g.f
  ), cnt as (
    select p.f, count(*) as total, count(*) filter (where p.lat is null) as sin_gps from pts p group by p.f
  ), gas as (
    select gv.fecha as f,
           sum(gv.monto) filter (where gv.tipo = 'combustible' and gv.estado <> 'rechazado') as comb,
           sum(gv.litros) filter (where gv.tipo = 'combustible' and gv.estado <> 'rechazado') as lts,
           sum(gv.monto) filter (where gv.tipo = 'peaje' and gv.estado <> 'rechazado') as pea,
           sum(gv.monto) filter (where gv.tipo = 'estacionamiento' and gv.estado <> 'rechazado') as est,
           sum(gv.monto) filter (where gv.tipo = 'otro' and gv.estado <> 'rechazado') as otr
    from gastos_vendedor gv
    where gv.vendedor = p_vendedor and gv.fecha between p_desde and p_hasta
    group by gv.fecha
  ), dias as (
    select f from cnt union select f from gas
  ), calc as (
    select d.f,
           coalesce(cnt.total, 0)::int as vis, coalesce(cnt.sin_gps, 0)::int as sg, coalesce(dia.en_caba, 0)::int as caba,
           case when coalesce(cnt.total, 0) = 0 then 0
                else round(((coalesce(dia.entre_m, 0)
                       + case when pr.base_lat is not null then coalesce(dia.base_m, 0) else 0 end) / 1000.0 * pr.factor_ruta
                       + case when pr.base_lat is null then pr.km_acercamiento else 0 end), 1) end as km_d,
           round(dia.max_base_m / 1000.0, 1) as maxb,
           dia.pj, gas.comb, gas.lts, gas.pea, gas.est, gas.otr
    from dias d
    left join cnt on cnt.f = d.f left join dia on dia.f = d.f left join gas on gas.f = d.f
  ), topes as (
    select c.*,
           case when c.vis = 0 then 0
                when (pr.base_lat is not null and coalesce(c.maxb, 0) >= pr.umbral_km_peaje)
                  or (pr.base_lat is null and c.km_d >= 2 * pr.umbral_km_peaje) then pr.tope_peaje_dia
                else 0 end as tp,
           least(c.caba * pr.tope_estac_visita, pr.tope_estac_dia) as te
    from calc c
  )
  select t.f, t.vis, t.sg, t.caba, t.km_d, t.maxb,
         round(t.km_d * pr.consumo_l_100km / 100.0 * pr.precio_litro, 0),
         round(t.km_d * pr.costo_km_desgaste, 0),
         t.tp, t.te,
         coalesce(t.comb, 0), coalesce(t.lts, 0), coalesce(t.pea, 0), coalesce(t.est, 0), coalesce(t.otr, 0),
         least(coalesce(t.pea, 0), t.tp), least(coalesce(t.est, 0), t.te),
         coalesce(t.pj, '[]'::jsonb)
  from topes t
  order by t.f;
end $$;

grant execute on function public.gastos_jornadas(text, date, date) to authenticated;
grant execute on function public.gastos_revisar(bigint, text, numeric) to authenticated;

-- 6. Comprobantes (fotos de tickets)
insert into storage.buckets (id, name, public) values ('gastos', 'gastos', false) on conflict (id) do nothing;
drop policy if exists gastos_tickets_staff on storage.objects;
create policy gastos_tickets_staff on storage.objects for all to authenticated
  using (bucket_id = 'gastos' and public.current_vendedor_rol() is not null)
  with check (bucket_id = 'gastos' and public.current_vendedor_rol() is not null);
