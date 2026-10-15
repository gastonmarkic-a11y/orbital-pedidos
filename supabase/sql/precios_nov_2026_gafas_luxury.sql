-- Precios de GAFAS LUXURY S.A.S. (Óptica Paesani, cod 031022) desde el 01/11/2026.
-- Excel "REVISADO ajuste-precios-nov-2026-todosA.xlsx" revisado el 15/10/2026, columnas "paesani precio de compra"
-- (precio exclusivo) y "paesani precio publico" (precio de venta de referencia).
--  · El cliente correcto es 031022 (su catálogo está atado a ese código). precios_nov_2026.sql apuntaba a AG-MAR-0762,
--    un prospecto duplicado sin datos: el 01/11 los precios no le iban a aparecer.
--  · Cambian Premium (66.667 / 180.000) y Core (61.333 / 165.600). Siguen en verde (ocultos en su catálogo).
--  · Los modelos que solo tienen fila Zaira en el Excel (Long Beach, Basel, Kobe, Londres, Phoenix, Emmen, Central Park,
--    Milano, York, San Marino, San Remo) no están en precio_programado (sus SKU Orbital no cambian de precio), pero para
--    Paesani llevan 44.074 / 119.000: van en precio_programado_cliente.
--  · Ediciones Zaira con el mismo nombre que un modelo Orbital (ZETA 1, 2, 7, 8, Basel, Londres, Long Beach, San Remo):
--    el precio Zaira va por SKU (cliente_precio_especial.modelo = código del SKU; se busca primero el SKU y después el
--    modelo). Los Orbital de ZETA llevan el Sport (37.778); los Orbital de Basel, Londres, Long Beach y San Remo conservan
--    su precio actual (el Excel no trae fila Orbital). ZERO Zaira no tiene SKU en stock.
--  · Lo que tiene hoy y no está en el Excel (BR 001..007, Atenas, Amalfi, Dublin, Gemini, Brunei, Zeta 5) no se toca.

update public.precio_programado set paesani_precio = 66667, paesani_pvp = 180000
where modelo in ('5TH AVENUE','ASCARI','CASA BLANCA','CIVIC CENTER') and aplicado_at is null;
update public.precio_programado set paesani_precio = 61333, paesani_pvp = 165600
where modelo in ('ADELAIDA','BUENOS AIRES','BUENOS AIRES I','EIVISSA','LE MANS','MICRA','PLUMA','SILVERSTONE','SUBLIME')
  and aplicado_at is null;

create table if not exists public.precio_programado_cliente (
  cod_cliente text not null,
  modelo text not null,
  precio_neto numeric not null,
  precio_ref numeric,
  oculto boolean not null default false,
  desde timestamptz not null,
  aplicado_at timestamptz,
  primary key (cod_cliente, modelo)
);
alter table public.precio_programado_cliente enable row level security;
revoke all on public.precio_programado_cliente from anon, authenticated;

insert into public.precio_programado_cliente (cod_cliente, modelo, precio_neto, precio_ref, desde)
select '031022', m, 44074, 119000, '2026-11-01 00:00:00-03'
from unnest(array['KOBE','PHOENIX','EMMEN','CENTRAL PARK','MILANO','YORK','SAN MARINO']) m
on conflict (cod_cliente, modelo) do update set precio_neto = excluded.precio_neto, precio_ref = excluded.precio_ref,
  desde = excluded.desde
  where precio_programado_cliente.aplicado_at is null;

-- Zaira por SKU (los SKU Zaira son los del respaldo _bkp_stock_precio_zaira_20261013).
insert into public.precio_programado_cliente (cod_cliente, modelo, precio_neto, precio_ref, desde)
select '031022', s.codigo, 44074, 119000, '2026-11-01 00:00:00-03'
from stock s join _bkp_stock_precio_zaira_20261013 z on z.codigo = s.codigo
where s.modelo in ('BASEL','LONDRES','LONG BEACH','SAN REMO','ZETA 1','ZETA 2','ZETA 7','ZETA 8')
on conflict (cod_cliente, modelo) do update set precio_neto = excluded.precio_neto, precio_ref = excluded.precio_ref
  where precio_programado_cliente.aplicado_at is null;

create or replace function public.aplicar_precios_programados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_stock int := 0; n_pae int := 0; n_cli int := 0;
begin
  -- Respaldo del precio actual de cada SKU que cambia (una sola vez).
  insert into _bkp_stock_precio_nov2026 (codigo, precio)
  select s.codigo, s.precio from stock s join precio_programado p on p.modelo = s.modelo
  where p.desde <= now() and p.aplicado_at is null
    and not exists (select 1 from _bkp_stock_precio_zaira_20261013 z where z.codigo = s.codigo)
  on conflict (codigo) do nothing;

  -- Precio óptica. Los SKU en $0 (sin cargo / material) no se tocan.
  update stock s set precio = p.precio_optica
  from precio_programado p
  where p.modelo = s.modelo and p.desde <= now() and p.aplicado_at is null and coalesce(s.precio, 0) > 0
    and not exists (select 1 from _bkp_stock_precio_zaira_20261013 z where z.codigo = s.codigo)
    and s.modelo not like '% - ZN' and coalesce(s.clasificacion, '') <> 'zaira nara';
  get diagnostics n_stock = row_count;

  -- GAFAS LUXURY S.A.S. (Paesani, 031022): precio exclusivo + precio de venta de referencia + ocultos.
  insert into cliente_precio_especial (cod_cliente, modelo, precio_neto, precio_ref, oculto)
  select '031022', p.modelo, p.paesani_precio, p.paesani_pvp, p.paesani_oculto
  from precio_programado p
  where p.desde <= now() and p.aplicado_at is null and coalesce(p.paesani_precio, 0) > 0
  on conflict (cod_cliente, modelo) do update
    set precio_neto = excluded.precio_neto, precio_ref = excluded.precio_ref, oculto = excluded.oculto;
  get diagnostics n_pae = row_count;

  -- Precios especiales por cliente de modelos que no cambian en la lista general.
  insert into cliente_precio_especial (cod_cliente, modelo, precio_neto, precio_ref, oculto)
  select c.cod_cliente, c.modelo, c.precio_neto, c.precio_ref, c.oculto
  from precio_programado_cliente c
  where c.desde <= now() and c.aplicado_at is null
  on conflict (cod_cliente, modelo) do update
    set precio_neto = excluded.precio_neto, precio_ref = excluded.precio_ref, oculto = excluded.oculto;
  get diagnostics n_cli = row_count;

  update precio_programado set aplicado_at = now() where desde <= now() and aplicado_at is null;
  update precio_programado_cliente set aplicado_at = now() where desde <= now() and aplicado_at is null;
  return jsonb_build_object('skus_stock', n_stock, 'paesani_modelos', n_pae + n_cli);
end $$;
revoke all on function public.aplicar_precios_programados() from public, anon, authenticated;

-- Precio especial por SKU antes que por modelo en el catálogo y su checkout.
do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.catalogo_home(text)'::regprocedure);
  if position('x.modelo in (s.codigo, s.modelo)' in d) = 0 then
    n := replace(d, E'    left join cliente_precio_especial pe\n      on v_cod is not null and pe.cod_cliente = v_cod and pe.modelo = s.modelo\n',
      E'    left join lateral (select x.* from cliente_precio_especial x\n      where v_cod is not null and x.cod_cliente = v_cod and x.modelo in (s.codigo, s.modelo)\n      order by (x.modelo = s.codigo) desc limit 1) pe on true\n');
    if n = d then raise exception 'catalogo_home: join no encontrado'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.catalogo_modelo_v2(text,text,text,text,text)'::regprocedure);
  if position('x.modelo in (s.codigo, s.modelo)' in d) = 0 then
    n := replace(d, E'  left join cliente_precio_especial pe\n    on v_cod is not null and pe.cod_cliente = v_cod and pe.modelo = s.modelo\n',
      E'  left join lateral (select x.* from cliente_precio_especial x\n    where v_cod is not null and x.cod_cliente = v_cod and x.modelo in (s.codigo, s.modelo)\n    order by (x.modelo = s.codigo) desc limit 1) pe on true\n');
    if n = d then raise exception 'catalogo_modelo_v2: join no encontrado'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.catalogo_checkout(text,text,text,text,text,jsonb,text,text,text)'::regprocedure);
  if position('x.modelo in (s.codigo, s.modelo)' in d) = 0 then
    n := replace(d, 'left join cliente_precio_especial pe on pe.cod_cliente = v_pcli and pe.modelo = s.modelo',
      'left join lateral (select x.* from cliente_precio_especial x where x.cod_cliente = v_pcli and x.modelo in (s.codigo, s.modelo) order by (x.modelo = s.codigo) desc limit 1) pe on true');
    if n = d then raise exception 'catalogo_checkout: join no encontrado'; end if;
    execute n;
  end if;
end $x$;
