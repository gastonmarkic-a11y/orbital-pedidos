-- Catálogo para los clientes de un distribuidor (15/10/2026, primero Cristaldo 010001).
-- Link genérico (tipo 'dist_cli') que el distribuidor reenvía a sus ópticas: ven el precio
-- óptica de Orbital como referencia, arman el pedido y, al confirmar, dejan sus datos.
-- El pedido NO entra al circuito de Orbital (no es precarga, no reserva stock, no va a
-- vendedores): queda en dist_cli_pedido y le llega al distribuidor por el bot de Telegram
-- de distribuidores (edge function dist-cliente-pedido), con copia al grupo interno del bot.
-- Paso previo al link personal por cliente (token).

create table if not exists dist_cli_pedido (
  id bigint generated always as identity primary key,
  acceso text not null,
  cod_distribuidor text not null,
  optica text not null,
  cuit text,
  localidad text,
  contacto text,
  wsp text not null,
  obs text,
  items jsonb not null,
  unidades int not null,
  importe_ref numeric not null,
  device_id text,
  avisado_at timestamptz,
  aviso_error text,
  created_at timestamptz not null default now()
);
alter table dist_cli_pedido enable row level security;
revoke all on dist_cli_pedido from anon, authenticated;
create index if not exists dist_cli_pedido_dist_idx on dist_cli_pedido (cod_distribuidor, created_at desc);

-- La llama solo la edge function (service role). Valoriza en el servidor con el mismo precio
-- que ve el link (lista óptica o promo vigente) y controla que haya stock, sin reservarlo.
create or replace function dist_cli_pedido_crear(
  p_clave text, p_optica text, p_cuit text, p_localidad text, p_contacto text,
  p_wsp text, p_obs text, p_items jsonb, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare a record; v_items jsonb; v_falt text; v_u int; v_imp numeric; v_id bigint;
begin
  select * into a from catalogo_acceso
   where codigo = p_clave and activo and tipo = 'dist_cli' and (vence_at is null or vence_at > now()) limit 1;
  if a.codigo is null then return jsonb_build_object('ok', false, 'error', 'El link ya no está activo.'); end if;
  if coalesce(btrim(p_optica), '') = '' or length(regexp_replace(coalesce(p_wsp, ''), '\D', '', 'g')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Completá el nombre de la óptica y un WhatsApp.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Carrito vacío');
  end if;

  select string_agg(coalesce(s.modelo, x.codigo) || ' ' || coalesce(s.descripcion, '') || ' (quedan ' || greatest(coalesce(l.libre, 0), 0) || ')', ', ')
    into v_falt
    from (select i->>'codigo' codigo, sum(greatest((i->>'cantidad')::int, 0))::int q from jsonb_array_elements(p_items) i group by 1) x
    left join stock_libre(a.cod_cliente, null, null) l on l.codigo = x.codigo
    left join stock s on s.codigo = x.codigo
   where x.q > coalesce(l.libre, 0);
  if v_falt is not null then
    return jsonb_build_object('ok', false, 'error', 'Mientras armabas el pedido se vendieron unidades. Ajustá estas cantidades: ' || v_falt);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', s.codigo, 'modelo', s.modelo, 'descripcion', s.descripcion,
           'cantidad', x.q,
           'precio', least(s.precio, coalesce(_promo_precio_sku(s.codigo, s.modelo, now(), null), s.precio)))
           order by s.modelo, s.descripcion), '[]'::jsonb)
    into v_items
    from (select i->>'codigo' codigo, sum(greatest((i->>'cantidad')::int, 0))::int q from jsonb_array_elements(p_items) i group by 1) x
    join stock s on s.codigo = x.codigo
   where x.q > 0;

  select coalesce(sum((i->>'cantidad')::int), 0), coalesce(sum((i->>'cantidad')::int * (i->>'precio')::numeric), 0)
    into v_u, v_imp from jsonb_array_elements(v_items) i;
  if v_u = 0 then return jsonb_build_object('ok', false, 'error', 'Carrito vacío'); end if;

  insert into dist_cli_pedido (acceso, cod_distribuidor, optica, cuit, localidad, contacto, wsp, obs, items, unidades, importe_ref, device_id)
  values (a.codigo, a.cod_cliente, left(btrim(p_optica), 120), nullif(left(btrim(coalesce(p_cuit, '')), 20), ''),
          nullif(left(btrim(coalesce(p_localidad, '')), 80), ''), nullif(left(btrim(coalesce(p_contacto, '')), 80), ''),
          left(btrim(p_wsp), 30), nullif(left(btrim(coalesce(p_obs, '')), 500), ''), v_items, v_u, v_imp, nullif(p_device, ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'cod_distribuidor', a.cod_cliente,
                            'items', v_items, 'unidades', v_u, 'importe_ref', v_imp);
end $$;
revoke all on function dist_cli_pedido_crear(text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function dist_cli_pedido_crear(text, text, text, text, text, text, text, jsonb, text) to service_role;

-- Link de los clientes de Cristaldo
insert into catalogo_acceso (codigo, tipo, cod_cliente, label, vendedor, creado_por)
values ('cristaldo-clientes-8k3v', 'dist_cli', '010001', '010001 - Cristaldo Roberto Luis · sus clientes (precio óptica de referencia)', null, 'claude 15/10')
on conflict do nothing;
