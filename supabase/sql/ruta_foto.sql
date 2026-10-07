-- Ruta del día armada desde la primera foto de vidriera (Ojo, Telegram). 2026-10-05
-- La agenda de campo (agenda_campo) queda como SUGERIDA. La agenda REAL sale de las fotos:
-- con el primer check-in del día, Ojo arma la ruta con las ópticas de la zona de esa foto
-- (agenda sugerida de la zona primero, después cartera por prioridad, ordenada por cercanía)
-- y cada foto siguiente la va tachando. Si el vendedor se muda de zona, se rearma lo que falta.

-- 1. Datos extra del check-in (para el check-in automático y poder deshacerlo)
alter table public.visitas_checkin
  add column if not exists automatico boolean not null default false,
  add column if not exists actividad_id bigint,
  add column if not exists agenda_campo_id bigint,
  add column if not exists cliente_previo jsonb,   -- foto/análisis que tenía la ficha antes (para deshacer)
  add column if not exists gps_origen text;       -- exif | ubicacion | cliente

-- 2. Ruta real del día
create table if not exists public.ruta_dia (
  id bigserial primary key,
  fecha date not null,
  vendedor text not null,
  cod_cliente text not null,
  orden integer not null,
  distancia_m numeric,              -- desde el punto de arranque
  motivo text,                      -- por qué está en la ruta
  de_agenda boolean not null default false,   -- estaba en la agenda sugerida del día
  origen_checkin_id bigint,         -- el check-in que armó (o rearmó) la ruta
  visitado boolean not null default false,
  visitado_checkin_id bigint,
  visitado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (fecha, vendedor, cod_cliente)
);
create index if not exists ruta_dia_vend_idx on public.ruta_dia (vendedor, fecha, orden);
alter table public.ruta_dia enable row level security;
drop policy if exists ruta_dia_lectura on public.ruta_dia;
create policy ruta_dia_lectura on public.ruta_dia for select to authenticated using (true);

-- 3. Ópticas de la zona de un punto (haversine; sin PostGIS), con lo necesario para priorizar
create or replace function public.ruta_opticas_zona(p_lat numeric, p_lon numeric, p_radio_m numeric default 2500, p_limit integer default 80)
returns table (cod text, nombre text, direccion text, localidad text, lat numeric, lon numeric, distancia_m numeric,
               vendedor_asignado text, clasificacion_recupero text, unidades_2025 numeric, ultima_compra_fecha date,
               tiene_orbital boolean, visitado_reciente boolean)
language sql stable as $$
  with caja as (
    select p_radio_m / 111000.0 as dlat, p_radio_m / (111000.0 * greatest(cos(radians(p_lat)), 0.2)) as dlon
  ), cerca as (
    select c.*,
           (6371000 * acos(least(1, greatest(-1,
              cos(radians(p_lat)) * cos(radians(c.lat)) * cos(radians(c.lon) - radians(p_lon))
              + sin(radians(p_lat)) * sin(radians(c.lat)))))) as d
    from public.clientes c, caja
    where c.lat is not null and c.lon is not null
      and c.lat between p_lat - caja.dlat and p_lat + caja.dlat
      and c.lon between p_lon - caja.dlon and p_lon + caja.dlon
      and c.cod not in ('888888', '888889')
      and coalesce(c.liquido, false) = false
  )
  select x.cod, coalesce(nullif(trim(x.nomcomerc), ''), x.razon), x.direccion, x.localidad, x.lat::numeric, x.lon::numeric,
         round(x.d::numeric, 0), x.vendedor_asignado, x.clasificacion_recupero, x.unidades_2025::numeric,
         x.ultima_compra_fecha::date, x.tiene_orbital,
         exists (select 1 from public.actividad_diaria a
                 where a.cod_cliente = x.cod and a.resultado_contacto = 'visito'
                   and a.fecha >= (now() at time zone 'America/Argentina/Buenos_Aires')::date - 21)
  from cerca x
  where x.d <= p_radio_m
  order by x.d
  limit p_limit
$$;

-- 4. Vista para la Suite: ruta real vs. visitas
create or replace view public.v_ruta_dia as
  select r.fecha, r.vendedor, r.orden, r.cod_cliente,
         coalesce(nullif(trim(c.nomcomerc), ''), c.razon) as cliente, c.direccion, c.localidad,
         r.distancia_m, r.motivo, r.de_agenda, r.visitado, r.visitado_en,
         v.foto_url, v.analisis->>'tiene_orbital' as tiene_orbital
  from public.ruta_dia r
  left join public.clientes c on c.cod = r.cod_cliente
  left join public.visitas_checkin v on v.id = r.visitado_checkin_id;
