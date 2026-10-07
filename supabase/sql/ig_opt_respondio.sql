-- Ópticas IG: «Respondió» guarda lo que contestó la óptica y la pasa al grupo de Ventas,
-- al vendedor de su zona (zona_vendedor por provincia/ciudad; si ya es cliente, su vendedor asignado).
-- El DM se manda a mano desde Instagram (a veces desde el IG personal de Gastón), así que la
-- respuesta también se carga a mano en la Suite.

alter table ig_opticas add column if not exists respuesta text;
alter table ig_opticas add column if not exists respondio_en timestamptz;
alter table ig_opticas add column if not exists derivado_a text;
alter table ig_opticas add column if not exists derivado_en timestamptz;

create or replace function public.ig_opt_respondio(p_usuario text, p_respuesta text, p_provincia text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record; v_vend text; v_nom text; v_chat bigint; v_txt text; v_quien text; v_tel text;
  e text := coalesce(nullif(trim(p_respuesta), ''), '');
begin
  if not ig_opt_es_admin() then raise exception 'sin permiso'; end if;
  if e = '' then return jsonb_build_object('ok', false, 'error', 'Falta lo que respondió'); end if;

  if nullif(trim(p_provincia), '') is not null then
    update ig_opticas set provincia = trim(p_provincia), provincia_manual = true where usuario = p_usuario;
  end if;
  select * into o from ig_opticas where usuario = p_usuario;
  if o.usuario is null then return jsonb_build_object('ok', false, 'error', 'No está en la bandeja'); end if;

  -- Vendedor: el asignado si ya es cliente; si no, el de la zona.
  select c.vendedor_asignado into v_vend from clientes c where c.cod = o.cliente_cod;
  if v_vend is null or v_vend in ('Corporativo', 'Gaston', 'Ulises') then
    v_vend := zona_vendedor(null, o.provincia, o.ciudad);
  end if;
  select coalesce(split_part(v.nombre, ' (', 1), v.codigo) into v_nom from vendedores v where v.codigo = v_vend;
  v_quien := (select v.nombre from vendedores v where v.user_id = auth.uid() limit 1);

  update ig_opticas set estado = 'respondio', respuesta = e, respondio_en = now(),
    derivado_a = v_vend, derivado_en = case when v_vend is not null then now() else derivado_en end,
    escrito_por = coalesce(escrito_por, v_quien), actualizado_en = now()
  where usuario = p_usuario;

  -- El catálogo de prospecto pasa a nombre del vendedor (así el pedido le cae a él).
  if v_vend is not null and o.catalogo_k is not null then
    update catalogo_acceso set vendedor = v_vend where codigo = o.catalogo_k and tipo = 'prospecto';
  end if;

  v_chat := coalesce(ojo_chat_tema('ventas'),
    (select telegram_chat_id from ojo_grupos where activo and recibe_avisos order by telegram_chat_id limit 1));
  if v_chat is null then return jsonb_build_object('ok', true, 'vendedor', v_vend, 'avisado', false); end if;

  v_tel := nullif(regexp_replace(coalesce(o.telefono, ''), '\D', '', 'g'), '');
  v_txt := '💬 <b>Respondió por Instagram</b> — Para: <b>' || coalesce(v_nom, 'Ventas (sin zona: falta la provincia)') || '</b>'
    || E'\n\n<b>' || ojo_esc(coalesce(nullif(o.nombre, ''), o.usuario)) || '</b> · @' || ojo_esc(o.usuario)
    || coalesce(' · ' || nullif(concat_ws(', ', o.ciudad, o.provincia), ''), '')
    || coalesce(' · ' || replace(to_char(o.seguidores, 'FM999,999,999'), ',', '.') || ' seguidores', '')
    || E'\n📝 Le escribió ' || split_part(coalesce(o.escrito_por, v_quien, 'Orbital'), ' (', 1)
    || coalesce(' el ' || to_char(o.escrito_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM'), '')
    || ' (prospección por Instagram).'
    || E'\n💬 Respondió: «' || ojo_esc(left(e, 600)) || '»'
    || coalesce(E'\n📞 ' || ojo_esc(o.telefono) || ' · <a href="https://wa.me/' || v_tel || '">WhatsApp</a>', '')
    || E'\n📲 <a href="https://instagram.com/' || o.usuario || '">Perfil de Instagram</a>'
    || coalesce(E'\n📖 Su catálogo: https://ver.orbitaleyewear.com.ar/catalogo?k=' || o.catalogo_k, '')
    || E'\n\n👉 ' || coalesce(v_nom, 'Gastón, decí quién la toma') || ', seguila vos: escribile desde tu cuenta y avisá acá cuando hablen.';
  insert into ojo_salida (chat_id, texto) values (v_chat, v_txt);
  perform net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-telegram',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"ojo_salida": true}'::jsonb);
  return jsonb_build_object('ok', true, 'vendedor', v_vend, 'avisado', true);
end $function$;

create or replace function public.ojo_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

revoke all on function public.ig_opt_respondio(text, text, text) from public, anon;
grant execute on function public.ig_opt_respondio(text, text, text) to authenticated;

-- La bandeja muestra la respuesta y a quién se pasó.
drop function if exists ig_opt_listar(text, text, text, text, integer, integer, text);
create function ig_opt_listar(p_estado text default null, p_cliente text default null, p_origen text default null,
  p_buscar text default null, p_limite integer default 300, p_offset integer default 0, p_provincia text default null)
returns table(usuario text, nombre text, seguidores integer, categoria text, bio text, telefono text, ciudad text,
  ultimo_dm timestamptz, lo_seguimos boolean, origen text, cliente_cod text, cliente_nombre text, cliente_vendedor text,
  cliente_compro boolean, cliente_posible text, provincia text, estado text, escrito_por text,
  respuesta text, respondio_en timestamptz, derivado_a text)
language sql stable security definer set search_path to 'public' as $$
  select o.usuario, o.nombre, o.seguidores, o.categoria, o.bio, o.telefono, o.ciudad, o.ultimo_dm, o.lo_seguimos, o.origen,
    o.cliente_cod, coalesce(nullif(c.nomcomerc,''), c.razon), c.vendedor_asignado,
    c.ultima_compra_fecha is not null or p.posible is not null, p.posible, o.provincia, o.estado, o.escrito_por,
    o.respuesta, o.respondio_en, o.derivado_a
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
grant execute on function public.ig_opt_listar(text, text, text, text, integer, integer, text) to authenticated;
