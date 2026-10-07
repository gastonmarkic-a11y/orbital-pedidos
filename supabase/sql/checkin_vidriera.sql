-- Check-in de visitas por foto de vidriera + ubicación (Ojo, Telegram). 2026-10-01
-- Flujo: el vendedor manda foto (y/o ubicación) → Ojo propone el cliente (agenda del día,
-- GPS, nombre leído en el cartel) → el vendedor confirma con un botón → queda la visita,
-- la foto, el análisis de la vidriera y el POP sugerido. Si no es cliente, se crea prospecto.

-- 1. Datos de vidriera en la ficha del cliente
alter table public.clientes
  add column if not exists foto_vidriera_url text,
  add column if not exists vidriera_analisis jsonb,
  add column if not exists vidriera_fecha timestamptz,
  add column if not exists tiene_orbital boolean,
  add column if not exists pop_nivel integer;

-- 2. Menú de POP por nivel (editable desde la Suite / SQL)
create table if not exists public.pop_niveles (
  nivel integer primary key,
  nombre text not null,
  descripcion text,
  condicion text,           -- en palabras: qué tiene que pasar para ofrecerlo
  activo boolean not null default true
);
insert into public.pop_niveles (nivel, nombre, descripcion, condicion) values
  (1, 'Folletería y stickers', 'Folletos Triple Protección, sticker de vidriera "Vendemos Orbital", display de mostrador chico', 'Cualquier óptica, cliente o prospecto, para abrir la puerta'),
  (2, 'Exhibidor de mostrador', 'Exhibidor de mostrador de 6 a 12 posiciones con cartelería de marca', 'Cliente activo con compra en los últimos 12 meses (o pedido de bienvenida)'),
  (3, 'Display de vidriera', 'Display de vidriera con cartel iluminado y gráfica Triple Protección', 'Cliente que compra seguido y tiene espacio visible en vidriera'),
  (4, 'Corner / vinilo de marca', 'Corner de marca o vinilo de vidriera completo, con exhibidor grande', 'Clientes top de la zona, con volumen y compromiso de exhibición')
on conflict (nivel) do nothing;

-- 3. Check-ins
create table if not exists public.visitas_checkin (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  vendedor text,
  telegram_user_id bigint,
  telegram_chat_id bigint,
  telegram_message_id bigint,       -- mensaje original del vendedor (foto o ubicación)
  aviso_message_id bigint,          -- mensaje de Ojo con los botones
  estado text not null default 'pendiente',   -- pendiente | esperando_nombre | confirmado | descartado
  lat numeric, lon numeric, precision_m numeric,
  direccion_geo text,               -- geocodificación inversa (Nominatim)
  foto_url text,
  foto_file_id text,
  analisis jsonb,                   -- salida de Claude Vision
  nombre_detectado text,            -- nombre leído en el cartel
  candidatos jsonb,                 -- [{cod, nombre, motivo, distancia_m}]
  cod_cliente text,                 -- cliente confirmado (puede ser TMP- si es prospecto nuevo)
  es_prospecto_nuevo boolean not null default false,
  pop_sugerido integer,
  pop_motivo text,
  confirmado_en timestamptz
);
create index if not exists visitas_checkin_user_idx on public.visitas_checkin (telegram_user_id, creado_en desc);
create index if not exists visitas_checkin_cliente_idx on public.visitas_checkin (cod_cliente, creado_en desc);
create index if not exists visitas_checkin_aviso_idx on public.visitas_checkin (telegram_chat_id, aviso_message_id);
alter table public.visitas_checkin enable row level security;

-- 4. Clientes cerca de un punto (haversine; sin PostGIS)
create or replace function public.checkin_clientes_cerca(p_lat numeric, p_lon numeric, p_radio_m numeric default 150, p_limit integer default 5)
returns table (cod text, nombre text, direccion text, localidad text, vendedor_asignado text, distancia_m numeric, geo_aproximado boolean)
language sql stable as $$
  select c.cod,
         coalesce(nullif(trim(c.nomcomerc), ''), c.razon) as nombre,
         c.direccion, c.localidad, c.vendedor_asignado,
         round((6371000 * acos(least(1, greatest(-1,
            cos(radians(p_lat)) * cos(radians(c.lat)) * cos(radians(c.lon) - radians(p_lon))
            + sin(radians(p_lat)) * sin(radians(c.lat))))))::numeric, 0) as distancia_m,
         coalesce(c.geo_aproximado, false)
  from public.clientes c
  where c.lat is not null and c.lon is not null
    and c.lat between p_lat - 0.01 and p_lat + 0.01
    and c.lon between p_lon - 0.01 and p_lon + 0.01
    and c.cod not in ('888888', '888889')
  order by (6371000 * acos(least(1, greatest(-1,
            cos(radians(p_lat)) * cos(radians(c.lat)) * cos(radians(c.lon) - radians(p_lon))
            + sin(radians(p_lat)) * sin(radians(c.lat))))))
  limit p_limit
$$;

-- 5. Vista rápida para la Suite: últimas visitas con foto
create or replace view public.v_visitas_checkin as
  select v.id, v.creado_en, v.vendedor, v.cod_cliente,
         coalesce(nullif(trim(c.nomcomerc), ''), c.razon) as cliente,
         c.localidad, v.lat, v.lon, v.foto_url, v.nombre_detectado,
         v.analisis->>'tiene_orbital' as tiene_orbital,
         v.analisis->'marcas_visibles' as marcas_visibles,
         v.pop_sugerido, p.nombre as pop_nombre, v.pop_motivo,
         v.es_prospecto_nuevo, v.estado
  from public.visitas_checkin v
  left join public.clientes c on c.cod = v.cod_cliente
  left join public.pop_niveles p on p.nivel = v.pop_sugerido;
