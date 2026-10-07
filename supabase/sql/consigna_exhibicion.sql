-- ── Consigna · exhibición en vitrina (croquis del mueble de cada sucursal) ──────────────
-- consigna_exhibidor: el mueble de la sucursal (estantes × lugares del sector Orbital). Cada sucursal
--   tiene el suyo; si no está cargado, el panel no muestra la pestaña.
-- consigna_exhibicion: cada foto de la vitrina ya confirmada por el local. `posiciones` es lo que
--   quedó confirmado ([{f,c,codigo}], f=1 arriba, c=1 izquierda; codigo null = vacío) y `leido` lo que
--   leyó la IA antes de que el local corrigiera (para medir cuánto acierta).
-- Todo se lee y escribe por RPC con el token de consigna_acceso (sin login), como el resto de la consigna.

create table if not exists consigna_exhibidor (
  sucursal_id bigint primary key references cliente_sucursal(id),
  filas int not null check (filas between 1 and 20),
  columnas int not null check (columnas between 1 and 12),
  nota text,
  updated_at timestamptz not null default now()
);

create table if not exists consigna_exhibicion (
  id bigserial primary key,
  sucursal_id bigint not null references cliente_sucursal(id),
  created_at timestamptz not null default now(),
  quien text,
  foto text,
  posiciones jsonb not null,
  leido jsonb
);
create index if not exists consigna_exhibicion_suc on consigna_exhibicion (sucursal_id, created_at desc);

alter table consigna_exhibidor enable row level security;
alter table consigna_exhibicion enable row level security;

-- Fotos de la vitrina: bucket público con rutas aleatorias (las sube la función exhibicion-foto).
insert into storage.buckets (id, name, public, file_size_limit)
values ('exhibicion', 'exhibicion', true, 8388608)
on conflict (id) do nothing;

-- Aeroparque (ShopGallery): sector Orbital = mitad izquierda del mueble, 7 estantes × 3 lugares.
insert into consigna_exhibidor (sucursal_id, filas, columnas, nota)
select id, 7, 3, 'Vitrina con dos sectores: el de Orbital es el de la IZQUIERDA (cartel ORBITAL). El de la derecha (cartel Uulk) es de otra marca: ignoralo.'
  from cliente_sucursal where id = 17
on conflict (sucursal_id) do nothing;

-- Sucursales con mueble cargado (para la pestaña y el resumen de la central).
create or replace function consigna_exhibidores(p_k text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a consigna_acceso;
begin
  select * into a from consigna_acceso where codigo = p_k and activo;
  if a.codigo is null then raise exception 'acceso_invalido'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'sucursal_id', e.sucursal_id, 'filas', e.filas, 'columnas', e.columnas,
      'ultima', (select jsonb_build_object('fecha', x.created_at, 'quien', x.quien, 'foto', x.foto)
                   from consigna_exhibicion x where x.sucursal_id = e.sucursal_id order by x.created_at desc limit 1))
      order by s.orden, s.id)
    from consigna_exhibidor e join cliente_sucursal s on s.id = e.sucursal_id
   where s.cod_madre = a.cod_madre and s.activa and (a.sucursal_id is null or s.id = a.sucursal_id)), '[]'::jsonb);
end $$;

-- Todo lo que necesita el croquis de una sucursal: mueble, stock con foto, ventas por código y fotos.
create or replace function consigna_exhibicion(p_k text, p_suc bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a consigna_acceso; e consigna_exhibidor;
begin
  select * into a from consigna_acceso where codigo = p_k and activo;
  if a.codigo is null then raise exception 'acceso_invalido'; end if;
  if not exists (select 1 from cliente_sucursal s where s.id = p_suc and s.cod_madre = a.cod_madre)
     or (a.sucursal_id is not null and a.sucursal_id <> p_suc) then raise exception 'sin_permiso'; end if;
  select * into e from consigna_exhibidor where sucursal_id = p_suc;
  if e.sucursal_id is null then raise exception 'sin_exhibidor'; end if;
  return jsonb_build_object(
    'exhibidor', jsonb_build_object('filas', e.filas, 'columnas', e.columnas, 'nota', e.nota),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('codigo', st.codigo, 'modelo', st.modelo, 'descripcion', st.descripcion,
               'cantidad', st.cantidad, 'devolver', st.devolver, 'imagen', consigna_img(st.codigo, st.modelo)) order by st.modelo, st.descripcion)
               from consigna_suc_stock st where st.sucursal_id = p_suc and st.cantidad > 0), '[]'::jsonb),
    'ventas', coalesce((select jsonb_agg(v) from (
               select m.codigo,
                      (-sum(m.cantidad) filter (where m.fecha > now() - interval '30 days'))::int u30,
                      (-sum(m.cantidad) filter (where m.fecha > now() - interval '90 days'))::int u90,
                      max(m.fecha) ultima
                 from consigna_suc_mov m
                where m.sucursal_id = p_suc and m.tipo = 'venta' and m.fecha > now() - interval '90 days'
                group by m.codigo) v), '[]'::jsonb),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.created_at, 'quien', x.quien, 'foto', x.foto, 'posiciones', x.posiciones) order by x.created_at desc)
               from (select * from consigna_exhibicion where sucursal_id = p_suc order by created_at desc limit 12) x), '[]'::jsonb)
  );
end $$;

-- Guarda la vitrina confirmada por el local (después de revisar lo que leyó la IA).
create or replace function consigna_exhibicion_guardar(p_k text, p_quien text, p_suc bigint, p_foto text, p_posiciones jsonb, p_leido jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare a consigna_acceso; nuevo bigint;
begin
  select * into a from consigna_acceso where codigo = p_k and activo;
  if a.codigo is null then raise exception 'acceso_invalido'; end if;
  if not exists (select 1 from cliente_sucursal s where s.id = p_suc and s.cod_madre = a.cod_madre)
     or (a.sucursal_id is not null and a.sucursal_id <> p_suc) then raise exception 'sin_permiso'; end if;
  if not exists (select 1 from consigna_exhibidor where sucursal_id = p_suc) then raise exception 'sin_exhibidor'; end if;
  if jsonb_typeof(p_posiciones) <> 'array' then raise exception 'cantidad_invalida'; end if;
  if p_foto is not null and p_foto !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/exhibicion/' then p_foto := null; end if;
  insert into consigna_exhibicion (sucursal_id, quien, foto, posiciones, leido)
  values (p_suc, nullif(trim(p_quien), ''), p_foto, p_posiciones, p_leido)
  returning id into nuevo;
  return nuevo;
end $$;

grant execute on function consigna_exhibidores(text) to anon, authenticated;
grant execute on function consigna_exhibicion(text, bigint) to anon, authenticated;
grant execute on function consigna_exhibicion_guardar(text, text, bigint, text, jsonb, jsonb) to anon, authenticated;
