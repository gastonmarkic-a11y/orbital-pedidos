-- Precios desde el 01/11/2026 (Excel "REVISADO ajuste-precios-nov-2026-todosA.xlsx", 13/10/2026).
-- Nada cambia hoy: los precios quedan programados y un cron los aplica el 01/11 a las 00:05 (ART).
--  · stock.precio (precio óptica, lista 5) ← Óptica NOV por modelo. El distribuidor sigue siendo óptica ÷ 1,41.
--  · Paesani (AG-MAR-0762 → corregido a 031022 GAFAS LUXURY S.A.S. en precios_nov_2026_gafas_luxury.sql): precio de óptica exclusivo (columna "precio") + su precio de venta de referencia
--    (columna "paesani"). Los modelos en verde quedan ocultos en su catálogo.
--  · Web (Shopify, tienda linea): precio público NOV y tachado. Lo aplica la función precios-web-programados
--    con su propio cron (01/11, cada 5 min de 00:00 a 00:55 ART, reanudable) y después se re-sincroniza
--    precios_publicos (de ahí lo toman IRIS y Mercado Libre).
-- Modelos repetidos Orbital / Zaira Nara: son productos distintos. Los SKU Zaira (colección Orbital x Zaira de la tienda
-- y los modelos "- ZN") pasaron a $53.846 el 13/10 (respaldo _bkp_stock_precio_zaira_20261013) y el 01/11 NO se tocan.
-- Los SKU Orbital de ZERO / ZETA llevan el precio Sport. Kobe, Basel, Londres, Long Beach, San Remo, Phoenix, Milano,
-- York, Central Park, Emmen y San Marino solo tienen fila Zaira en el Excel: sus SKU Orbital quedan con su precio.

alter table public.cliente_precio_especial
  add column if not exists precio_ref numeric,
  add column if not exists oculto boolean not null default false;
comment on column public.cliente_precio_especial.precio_ref is 'Precio de venta sugerido al cliente (solo referencia, no se factura)';
comment on column public.cliente_precio_especial.oculto is 'El modelo no aparece en el catálogo de este cliente';

create table if not exists public.precio_programado (
  modelo text primary key,
  escala text,
  precio_optica numeric not null,
  precio_publico numeric,
  tachado numeric,
  paesani_precio numeric,
  paesani_pvp numeric,
  paesani_oculto boolean not null default false,
  desde timestamptz not null,
  aplicado_at timestamptz
);
alter table public.precio_programado enable row level security;
revoke all on public.precio_programado from anon, authenticated;

create table if not exists public._bkp_stock_precio_nov2026 (
  codigo text primary key, precio numeric, guardado_at timestamptz not null default now()
);
alter table public._bkp_stock_precio_nov2026 enable row level security;
revoke all on public._bkp_stock_precio_nov2026 from anon, authenticated;

insert into public.precio_programado (modelo, escala, precio_optica, precio_publico, tachado, paesani_precio, paesani_pvp, paesani_oculto, desde)
select v.modelo, v.escala, v.optica, v.publico, v.tachado, v.paesani, v.pvp, v.verde, '2026-11-01 00:00:00-03'
from (values
('5TH AVENUE','Premium',77000,200000,230000,62963,170000,true),
('ASCARI','Premium',77000,200000,230000,62963,170000,true),
('CASA BLANCA','Premium',77000,200000,230000,62963,170000,true),
('CIVIC CENTER','Premium',77000,200000,230000,62963,170000,true),
('ADELAIDA','Core',70500,184000,230000,57926,156400,true),
('BUENOS AIRES','Core',70500,184000,230000,57926,156400,true),
('BUENOS AIRES I','Core',70500,184000,230000,57926,156400,true),
('EIVISSA','Core',70500,184000,230000,57926,156400,true),
('LE MANS','Core',70500,184000,230000,57926,156400,true),
('MICRA','Core',70500,184000,230000,57926,156400,true),
('PLUMA','Core',70500,184000,230000,57926,156400,true),
('SILVERSTONE','Core',70500,184000,230000,57926,156400,true),
('SUBLIME','Core',70500,184000,230000,57926,156400,true),
('ATLANTIC CITY','Urbano',53900,140000,200000,44074,119000,false),
('BRERA','Urbano',53900,140000,200000,44074,119000,false),
('BROOKLYN','Urbano',53900,140000,200000,44074,119000,false),
('CHARLOTTE','Urbano',53900,140000,200000,44074,119000,false),
('CRETA','Urbano',53900,140000,200000,44074,119000,false),
('LOS HAMPTON','Urbano',53900,140000,200000,44074,119000,false),
('PALERMO','Urbano',53900,140000,200000,44074,119000,false),
('PARIS','Urbano',53900,140000,200000,44074,119000,false),
('ROMA','Urbano',53900,140000,200000,44074,119000,false),
('SOPHIA','Urbano',53900,140000,200000,44074,119000,false),
('VENICE','Urbano',53900,140000,200000,44074,119000,false),
('WYNWOOD','Urbano',53900,140000,200000,44074,119000,false),
('ADRENALINE','Sport',46154,120000,180000,37778,102000,false),
('CRYSTAL','Sport',46154,120000,180000,37778,102000,false),
('ENDOR','Sport',46154,120000,180000,37778,102000,false),
('HIGH PERFORMANCE','Sport',46154,120000,180000,37778,102000,false),
('QUARTZ','Sport',46154,120000,180000,37778,102000,false),
('SIGNATURE','Sport',46154,120000,180000,37778,102000,false),
('SUBZERO','Sport',46154,120000,180000,37778,102000,false),
('SUBZERO NEW','Sport',46154,120000,180000,37778,102000,false),
('SUZUKA','Sport',46154,120000,180000,37778,102000,false),
('VELOCITY','Sport',46154,120000,180000,37778,102000,false),
('ZERO','Sport',46154,120000,180000,37778,102000,false),
('ZETA 1','Sport',46154,120000,180000,37778,102000,false),
('ZETA 1 PRO','Sport',46154,120000,180000,37778,102000,false),
('ZETA 11','Sport',46154,120000,180000,37778,102000,false),
('ZETA 2','Sport',46154,120000,180000,37778,102000,false),
('ZETA 3','Sport',46154,120000,180000,37778,102000,false),
('ZETA 4','Sport',46154,120000,180000,37778,102000,false),
('ZETA 7','Sport',46154,120000,180000,37778,102000,false),
('ZETA 8','Sport',46154,120000,180000,37778,102000,false),
('ZETA 9','Sport',46154,120000,180000,37778,102000,false),
('ZZR','Sport',46154,120000,180000,37778,102000,false),
('5TH AVENUE (edicion especial)','zaira nara',77000,200000,230000,62963,170000,false),
('ASCARI (edicion especial)','zaira nara',77000,200000,230000,62963,170000,false),
('CASA BLANCA (edicion especial)','zaira nara',77000,200000,230000,62963,170000,false),
('CIVIC CENTER (edicion especial)','zaira nara',77000,200000,230000,62963,170000,false),
('AUGUSTA - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('BELFAST - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('BRUNA - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('BRUNO - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('COLUMBIA - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('EMMEN - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('SAN MARINO - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('ZELANDA - ZN','zaira nara',53846,140000,200000,44074,119000,false),
('ABU DHABI','oportunidades',36800,99000,135000,31167,84150,false),
('ALPES','oportunidades',36800,99000,135000,31167,84150,false),
('ANDORRA','oportunidades',36800,99000,135000,31167,84150,false),
('ANDROMEDA','oportunidades',36800,99000,135000,31167,84150,false),
('AQUARIUS','oportunidades',36800,99000,135000,31167,84150,false),
('ARIES','oportunidades',36800,99000,135000,31167,84150,false),
('ASPEN','oportunidades',36800,99000,135000,31167,84150,false),
('BARCELONA','oportunidades',36800,99000,135000,31167,84150,false),
('BAREIN','oportunidades',36800,99000,135000,31167,84150,false),
('BARI','oportunidades',36800,99000,135000,31167,84150,false),
('BAUHAUS','oportunidades',36800,99000,135000,31167,84150,false),
('BRASILIA','oportunidades',36800,99000,135000,31167,84150,false),
('BREMEN','oportunidades',36800,99000,135000,31167,84150,false),
('BRISSA','oportunidades',36800,99000,135000,31167,84150,false),
('CANIS','oportunidades',36800,99000,135000,31167,84150,false),
('CANNIS','oportunidades',36800,99000,135000,31167,84150,false),
('CASIOPEA','oportunidades',36800,99000,135000,31167,84150,false),
('CYGNUS','oportunidades',36800,99000,135000,31167,84150,false),
('DAYTONA','oportunidades',36800,99000,135000,31167,84150,false),
('ELYSEE','oportunidades',36800,99000,135000,31167,84150,false),
('FILADELFIA','oportunidades',36800,99000,135000,31167,84150,false),
('FRANCE','oportunidades',36800,99000,135000,31167,84150,false),
('HANNOVER','oportunidades',36800,99000,135000,31167,84150,false),
('IMOLA','oportunidades',36800,99000,135000,31167,84150,false),
('LENA','oportunidades',36800,99000,135000,31167,84150,false),
('MALBA','oportunidades',36800,99000,135000,31167,84150,false),
('MALIBU','oportunidades',36800,99000,135000,31167,84150,false),
('MALTA','oportunidades',36800,99000,135000,31167,84150,false),
('MARSELLA','oportunidades',36800,99000,135000,31167,84150,false),
('MOMA','oportunidades',36800,99000,135000,31167,84150,false),
('MOSCOW','oportunidades',36800,99000,135000,31167,84150,false),
('NAPLES','oportunidades',36800,99000,135000,31167,84150,false),
('NEW JERSEY','oportunidades',36800,99000,135000,31167,84150,false),
('NEW ORLEANS','oportunidades',36800,99000,135000,31167,84150,false),
('NITERO','oportunidades',36800,99000,135000,31167,84150,false),
('OAKLAND','oportunidades',36800,99000,135000,31167,84150,false),
('PERSEO','oportunidades',36800,99000,135000,31167,84150,false),
('REBECCA','oportunidades',36800,99000,135000,31167,84150,false),
('ROSTOCK','oportunidades',36800,99000,135000,31167,84150,false),
('ROTERDAM','oportunidades',36800,99000,135000,31167,84150,false),
('SAINT TROPEZ','oportunidades',36800,99000,135000,31167,84150,false),
('ST MARTEEN','oportunidades',36800,99000,135000,31167,84150,false),
('VERSALLES','oportunidades',36800,89000,200000,28019,75650,false),
('VIRGO','oportunidades',32600,89000,200000,28019,75650,false),
('WAYNE','oportunidades',36800,89000,200000,28019,75650,false),
('WILLIAM','oportunidades',36800,89000,200000,28019,75650,false),
('WILLIAMSBURG','oportunidades',36800,89000,200000,28019,75650,false),
('SAN FRANCISCO','oportunidades',32600,79000,200000,24870,67150,false),
('ALASKA','oportunidades',32600,79000,200000,24870,67150,false),
('ALASKA CAP','oportunidades',32600,79000,200000,24870,67150,false),
('ALISSA','oportunidades',32600,79000,200000,24870,67150,false),
('ALPHONSE','oportunidades',32600,79000,200000,24870,67150,false),
('AQUILA','oportunidades',32600,79000,200000,24870,67150,false),
('BURGOS','oportunidades',32600,79000,200000,24870,67150,false),
('CAIRO','oportunidades',32600,79000,200000,24870,67150,false),
('CAMDEN LOCK','oportunidades',32600,79000,200000,24870,67150,false),
('CHICAGO','oportunidades',32600,79000,200000,24870,67150,false),
('CHOPPER','oportunidades',32600,79000,200000,24870,67150,false),
('COPENHAGUE','oportunidades',32600,79000,200000,24870,67150,false),
('CORINE','oportunidades',32600,79000,200000,24870,67150,false),
('COSTA AZUL','oportunidades',32600,79000,200000,24870,67150,false),
('DENIA','oportunidades',32600,79000,200000,24870,67150,false),
('DRAKE','oportunidades',32600,79000,200000,24870,67150,false),
('DRIVE','oportunidades',32600,79000,200000,24870,67150,false),
('DUBAI','oportunidades',32600,79000,200000,24870,67150,false),
('EIROS','oportunidades',32600,79000,200000,24870,67150,false),
('FOLKE','oportunidades',32600,79000,200000,24870,67150,false),
('GAUTIER','oportunidades',32600,79000,200000,24870,67150,false),
('GIANI','oportunidades',32600,79000,200000,24870,67150,false),
('GODRIC','oportunidades',32600,79000,200000,24870,67150,false),
('HAMBURGO','oportunidades',32600,79000,200000,24870,67150,false),
('JAMES','oportunidades',32600,79000,200000,24870,67150,false),
('JAMIE','oportunidades',32600,79000,200000,24870,67150,false),
('JOHN COOPER','oportunidades',32600,79000,200000,24870,67150,false),
('KIEL','oportunidades',32600,79000,200000,24870,67150,false),
('LA HABANA','oportunidades',32600,79000,200000,24870,67150,false),
('LAWRENCE','oportunidades',32600,79000,200000,24870,67150,false),
('LEIDEN','oportunidades',32600,79000,200000,24870,67150,false),
('LEO','oportunidades',32600,79000,200000,24870,67150,false),
('LEON','oportunidades',32600,79000,200000,24870,67150,false),
('MELBOURNE','oportunidades',32600,79000,200000,24870,67150,false),
('MODENA','oportunidades',32600,79000,200000,24870,67150,false),
('MONTREAL','oportunidades',32600,79000,200000,24870,67150,false),
('PALM BEACH','oportunidades',32600,79000,200000,24870,67150,false),
('PASSY','oportunidades',32600,79000,200000,24870,67150,false),
('PIETT','oportunidades',32600,79000,200000,24870,67150,false),
('PISCES','oportunidades',32600,79000,200000,24870,67150,false),
('PRAIA','oportunidades',32600,79000,200000,24870,67150,false),
('RICHARD','oportunidades',32600,79000,200000,24870,67150,false),
('RODAS','oportunidades',32600,79000,200000,24870,67150,false),
('SAGITTARIUS','oportunidades',32600,79000,200000,24870,67150,false),
('SCORPIUS','oportunidades',32600,79000,200000,24870,67150,false),
('SHAKUR','oportunidades',32600,79000,200000,24870,67150,false),
('TAURUS','oportunidades',32600,79000,200000,24870,67150,false),
('TEMPLE','oportunidades',32600,79000,200000,24870,67150,false),
('TOLEDO','oportunidades',32600,79000,200000,24870,67150,false),
('TURIN','oportunidades',32600,79000,200000,24870,67150,false),
('VALLETTA','oportunidades',32600,79000,200000,24870,67150,false),
('VARSOVIA','oportunidades',32600,79000,200000,24870,67150,false),
('VENETO','oportunidades',32600,79000,200000,24870,67150,false)) as v(modelo, escala, optica, publico, tachado, paesani, pvp, verde)
on conflict (modelo) do update set escala = excluded.escala, precio_optica = excluded.precio_optica,
  precio_publico = excluded.precio_publico, tachado = excluded.tachado, paesani_precio = excluded.paesani_precio,
  paesani_pvp = excluded.paesani_pvp, paesani_oculto = excluded.paesani_oculto, desde = excluded.desde
  where precio_programado.aplicado_at is null;

create or replace function public.aplicar_precios_programados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_stock int := 0; n_pae int := 0;
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

  -- Paesani: precio exclusivo + precio de venta de referencia + ocultos.
  insert into cliente_precio_especial (cod_cliente, modelo, precio_neto, precio_ref, oculto)
  select 'AG-MAR-0762', p.modelo, p.paesani_precio, p.paesani_pvp, p.paesani_oculto
  from precio_programado p
  where p.desde <= now() and p.aplicado_at is null and coalesce(p.paesani_precio, 0) > 0
  on conflict (cod_cliente, modelo) do update
    set precio_neto = excluded.precio_neto, precio_ref = excluded.precio_ref, oculto = excluded.oculto;
  get diagnostics n_pae = row_count;

  update precio_programado set aplicado_at = now() where desde <= now() and aplicado_at is null;
  return jsonb_build_object('skus_stock', n_stock, 'paesani_modelos', n_pae);
end $$;
revoke all on function public.aplicar_precios_programados() from public, anon, authenticated;

-- 01/11 00:05 hora Argentina = 03:05 UTC. Si corre de nuevo otro año, no hace nada (todo queda aplicado).
select cron.unschedule('precios-nov-2026') where exists (select 1 from cron.job where jobname = 'precios-nov-2026');
select cron.schedule('precios-nov-2026', '5 3 1 11 *', 'select public.aplicar_precios_programados()');

-- Referencias de precio para el catálogo (Paesani: precio de venta sugerido) y modelos ocultos para el cliente.
create or replace function public.catalogo_precio_ref(p_clave text)
returns table(modelo text, precio_ref numeric, oculto boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cod text;
begin
  if not catalogo_clave_ok(p_clave) then raise exception 'Clave inválida'; end if;
  select ca.cod_cliente into v_cod from catalogo_acceso ca
    where ca.codigo = p_clave and ca.activo and ca.tipo = 'optica' limit 1;
  if v_cod is null then return; end if;
  return query select pe.modelo, pe.precio_ref, pe.oculto from cliente_precio_especial pe
    where pe.cod_cliente = v_cod and (pe.precio_ref is not null or pe.oculto);
end $$;
revoke all on function public.catalogo_precio_ref(text) from public;
grant execute on function public.catalogo_precio_ref(text) to anon, authenticated;

-- Modelos ocultos para un cliente (Paesani: los marcados en verde) no salen en su catálogo.
-- Se parchea solo el WHERE de las dos funciones (misma firma: se conservan los permisos).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.catalogo_home(text)'::regprocedure);
  if position('not coalesce(pe.oculto, false)' in d) = 0 then
    n := replace(d, E'    where l.libre > 0\n  ),', E'    where l.libre > 0 and not coalesce(pe.oculto, false)\n  ),');
    if n = d then raise exception 'catalogo_home: no encontré el WHERE a parchear'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.catalogo_modelo_v2(text,text,text,text,text)'::regprocedure);
  if position('not coalesce(pe.oculto, false)' in d) = 0 then
    n := replace(d, E'  where s.modelo = p_modelo and l.libre > 0\n', E'  where s.modelo = p_modelo and l.libre > 0 and not coalesce(pe.oculto, false)\n');
    if n = d then raise exception 'catalogo_modelo_v2: no encontré el WHERE a parchear'; end if;
    execute n;
  end if;
end $$;

-- ── Web (Shopify) ──────────────────────────────────────────────────────────────
alter table public.precio_programado add column if not exists web_aplicado_at timestamptz;

create table if not exists public._bkp_shopify_precios_nov2026 (
  variant_id bigint primary key,
  producto text, sku text, modelo text,
  price numeric, compare_at_price numeric,
  guardado_at timestamptz not null default now(),
  aplicado boolean not null default false,
  aplicado_at timestamptz
);
alter table public._bkp_shopify_precios_nov2026 enable row level security;
revoke all on public._bkp_shopify_precios_nov2026 from anon, authenticated;

select cron.unschedule('precios-web-nov-2026') where exists (select 1 from cron.job where jobname = 'precios-web-nov-2026');
select cron.schedule('precios-web-nov-2026', '*/5 3 1 11 *', $c$
  select net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/precios-web-programados',
    headers := jsonb_build_object('x-cron-key', (select valor from app_config where clave = 'cron_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$c$);
-- Después de la web, traer los precios nuevos a precios_publicos (IRIS / Mercado Libre) sin esperar al sync de las 9.
select cron.unschedule('precios-publicos-resync-nov-2026') where exists (select 1 from cron.job where jobname = 'precios-publicos-resync-nov-2026');
select cron.schedule('precios-publicos-resync-nov-2026', '15 4 1 11 *', $c$
  select net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/precios-shopify-sync',
    headers := jsonb_build_object('x-cron-key', (select valor from app_config where clave = 'cron_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$c$);
