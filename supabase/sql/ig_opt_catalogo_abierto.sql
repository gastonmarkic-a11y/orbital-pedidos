-- Ópticas IG: cuándo abrieron el catálogo que se les mandó por DM (campaña ig_organico).
-- Instagram no avisa cuando contestan; lo que sí vemos es la visita al catálogo. Cuenta las visitas
-- a su link de prospecto (catalogo_k) y, si ya es cliente, las de su link de cliente desde que se le escribió.

create or replace function public.ig_opt_visitas()
returns table(usuario text, visitas bigint, ultima_visita timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select o.usuario, count(v.id), max(v.created_at)
  from ig_opticas o
  join catalogo_visitas v on v.codigo = o.catalogo_k
    or (o.cliente_cod is not null and o.escrito_en is not null and v.cod_cliente = o.cliente_cod and v.created_at >= o.escrito_en)
  where ig_opt_es_admin()
  group by o.usuario
$$;
revoke all on function public.ig_opt_visitas() from public, anon;
grant execute on function public.ig_opt_visitas() to authenticated;

-- Las que abrieron el catálogo, para el aviso de arriba de la bandeja.
create or replace function public.ig_opt_abrieron()
returns table(usuario text, nombre text, estado text, visitas bigint, ultima_visita timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select o.usuario, o.nombre, o.estado, x.visitas, x.ultima_visita
  from ig_opt_visitas() x join ig_opticas o on o.usuario = x.usuario
  where ig_opt_es_admin()
  order by x.ultima_visita desc
$$;
revoke all on function public.ig_opt_abrieron() from public, anon;
grant execute on function public.ig_opt_abrieron() to authenticated;

-- La bandeja trae las visitas y pone primero las que abrieron el catálogo.
drop function if exists ig_opt_listar(text, text, text, text, integer, integer, text);
create function ig_opt_listar(p_estado text default null, p_cliente text default null, p_origen text default null,
  p_buscar text default null, p_limite integer default 300, p_offset integer default 0, p_provincia text default null)
returns table(usuario text, nombre text, seguidores integer, categoria text, bio text, telefono text, ciudad text,
  ultimo_dm timestamptz, lo_seguimos boolean, origen text, cliente_cod text, cliente_nombre text, cliente_vendedor text,
  cliente_compro boolean, cliente_posible text, provincia text, estado text, escrito_por text,
  respuesta text, respondio_en timestamptz, derivado_a text, cat_visitas bigint, cat_ultima timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select o.usuario, o.nombre, o.seguidores, o.categoria, o.bio, o.telefono, o.ciudad, o.ultimo_dm, o.lo_seguimos, o.origen,
    o.cliente_cod, coalesce(nullif(c.nomcomerc,''), c.razon), c.vendedor_asignado,
    c.ultima_compra_fecha is not null or p.posible is not null, p.posible, o.provincia, o.estado, o.escrito_por,
    o.respuesta, o.respondio_en, o.derivado_a, x.visitas, x.ultima_visita
  from ig_opticas o left join clientes c on c.cod = o.cliente_cod
  left join ig_opt_posibles() p on p.usuario = o.usuario
  left join ig_opt_visitas() x on x.usuario = o.usuario
  where ig_opt_es_admin()
    and (p_estado is null or o.estado = p_estado)
    and (p_cliente is null or (p_cliente = 'si') = (c.ultima_compra_fecha is not null or p.posible is not null))
    and (p_origen is null or o.origen = p_origen or (p_origen = 'sigo' and o.lo_seguimos))
    and (p_provincia is null or (p_provincia = '-' and o.provincia is null) or o.provincia = p_provincia)
    and (p_buscar is null or o.usuario ilike '%'||p_buscar||'%' or coalesce(o.nombre,'') ilike '%'||p_buscar||'%'
         or coalesce(o.bio,'') ilike '%'||p_buscar||'%' or coalesce(o.ciudad,'') ilike '%'||p_buscar||'%')
  order by x.ultima_visita desc nulls last, o.ultimo_dm desc nulls last, o.seguidores desc nulls last
  limit greatest(1, least(coalesce(p_limite,300), 1000)) offset greatest(0, coalesce(p_offset,0))
$$;
grant execute on function public.ig_opt_listar(text, text, text, text, integer, integer, text) to authenticated;
