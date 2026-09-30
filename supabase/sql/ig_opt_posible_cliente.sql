-- Ópticas IG: detectar las que ya nos compran aunque no estén vinculadas a la base.
-- Cruza el nombre (o el @) normalizado contra clientes con compras. Si hay coincidencia,
-- cuenta como cliente: sale de «No son clientes» y aparece en «Ya son clientes».
-- No toca cliente_cod (el catálogo personal sigue siendo el de prospecto hasta vincularla a mano).
-- Sin filtro por zona de distribuidor.

create or replace function ig_opt_clave(t text) returns text language sql immutable as $$
  select regexp_replace(lower(unaccent(coalesce(t, ''))),
    '(centro optico|opticas|optica|optic|s\.?r\.?l\.?|s\.?a\.?$|[^a-z0-9])', '', 'g')
$$;

create or replace function ig_opt_posibles()
returns table(usuario text, posible text)
language sql stable security definer set search_path to 'public' as $$
  with k as materialized (
    select ig_opt_clave(coalesce(nullif(c.nomcomerc,''), c.razon)) k,
           coalesce(nullif(c.nomcomerc,''), c.razon) || coalesce(' (' || c.localidad || ')', '') t
    from clientes c where c.ultima_compra_fecha is not null
  ), o as materialized (
    select o.usuario, unnest(array[ig_opt_clave(o.nombre), ig_opt_clave(o.usuario)]) k
    from ig_opticas o left join clientes c on c.cod = o.cliente_cod
    where c.ultima_compra_fecha is null
  )
  select o.usuario, string_agg(distinct k.t, ' · ')
  from o join k on k.k = o.k and length(k.k) >= 5
  group by o.usuario
$$;

drop function if exists ig_opt_listar(text, text, text, text, integer, integer);
create function ig_opt_listar(p_estado text default null, p_cliente text default null, p_origen text default null,
  p_buscar text default null, p_limite integer default 300, p_offset integer default 0, p_provincia text default null)
returns table(usuario text, nombre text, seguidores integer, categoria text, bio text, telefono text, ciudad text,
  ultimo_dm timestamptz, lo_seguimos boolean, origen text, cliente_cod text, cliente_nombre text, cliente_vendedor text,
  cliente_compro boolean, cliente_posible text, provincia text, estado text, escrito_por text)
language sql stable security definer set search_path to 'public' as $$
  select o.usuario, o.nombre, o.seguidores, o.categoria, o.bio, o.telefono, o.ciudad, o.ultimo_dm, o.lo_seguimos, o.origen,
    o.cliente_cod, coalesce(nullif(c.nomcomerc,''), c.razon), c.vendedor_asignado,
    c.ultima_compra_fecha is not null or p.posible is not null, p.posible, o.provincia, o.estado, o.escrito_por
  from ig_opticas o left join clientes c on c.cod = o.cliente_cod
  left join ig_opt_posibles() p on p.usuario = o.usuario
  where ig_opt_es_admin()
    and (p_estado is null or o.estado = p_estado)
    and (p_cliente is null or (p_cliente = 'si') = (c.ultima_compra_fecha is not null or p.posible is not null))
    and (p_origen is null or o.origen = p_origen or (p_origen = 'sigo' and o.lo_seguimos))
    and (p_provincia is null or (p_provincia = '-' and o.provincia is null) or o.provincia = p_provincia)
    and (p_buscar is null or o.usuario ilike '%'||p_buscar||'%' or coalesce(o.nombre,'') ilike '%'||p_buscar||'%'
         or coalesce(o.bio,'') ilike '%'||p_buscar||'%' or coalesce(o.ciudad,'') ilike '%'||p_buscar||'%')
  order by o.ultimo_dm desc nulls last, o.seguidores desc nulls last
  limit greatest(1, least(coalesce(p_limite,300), 1000)) offset greatest(0, coalesce(p_offset,0))
$$;

drop function if exists ig_opt_resumen(text, text);
create function ig_opt_resumen(p_cliente text default null, p_origen text default null, p_provincia text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) from (
    select o.estado, count(*) n from ig_opticas o left join clientes c on c.cod = o.cliente_cod
    left join ig_opt_posibles() p on p.usuario = o.usuario
    where ig_opt_es_admin()
      and (p_cliente is null or (p_cliente = 'si') = (c.ultima_compra_fecha is not null or p.posible is not null))
      and (p_origen is null or o.origen = p_origen or (p_origen = 'sigo' and o.lo_seguimos))
      and (p_provincia is null or (p_provincia = '-' and o.provincia is null) or o.provincia = p_provincia)
    group by o.estado) t
$$;

revoke all on function ig_opt_posibles() from public, anon;
grant execute on function ig_opt_listar(text, text, text, text, integer, integer, text) to authenticated;
grant execute on function ig_opt_resumen(text, text, text) to authenticated;

-- Provincias para el filtro, con cuántas ópticas hay en cada una (respeta cliente/origen/estado)
create or replace function ig_opt_provincias(p_cliente text default null, p_origen text default null, p_estado text default null)
returns table(provincia text, n bigint) language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.provincia, '-'), count(*) from ig_opticas o left join clientes c on c.cod = o.cliente_cod
  left join ig_opt_posibles() p on p.usuario = o.usuario
  where ig_opt_es_admin()
    and (p_estado is null or o.estado = p_estado)
    and (p_cliente is null or (p_cliente = 'si') = (c.ultima_compra_fecha is not null or p.posible is not null))
    and (p_origen is null or o.origen = p_origen or (p_origen = 'sigo' and o.lo_seguimos))
  group by 1 order by 2 desc
$$;
grant execute on function ig_opt_provincias(text, text, text) to authenticated;
