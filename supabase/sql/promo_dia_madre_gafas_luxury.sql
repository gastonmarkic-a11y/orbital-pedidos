-- Día de la Madre: GAFAS LUXURY S.A.S. (Paesani, 031022) a $37.778 en vez de $48.000 (15/10/2026).
-- promo_precio pasa a admitir precio por cliente: cod_cliente null = todos; con cod_cliente = solo ese cliente.
-- Para ese cliente vale el menor de los dos (min); para el resto, las filas de cliente no existen.

alter table promo_precio add column if not exists cod_cliente text;

drop function if exists _promo_precio(text, timestamptz);
create or replace function _promo_precio(p_modelo text, p_at timestamptz default now(), p_cli text default null)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select min(precio) from promo_precio
   where activo and modelo = p_modelo and p_at >= desde and p_at < hasta
     and (cod_cliente is null or cod_cliente = p_cli)
$$;

drop function if exists _promo_precio_sku(text, text, timestamptz);
create or replace function _promo_precio_sku(p_codigo text, p_modelo text, p_at timestamptz default now(), p_cli text default null)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select min(precio) from promo_precio
   where activo and modelo = p_modelo and (codigo is null or codigo = p_codigo)
     and p_at >= desde and p_at < hasta
     and (cod_cliente is null or cod_cliente = p_cli)
$$;

-- Misma cobertura (modelos / colores) que la promo general, a 37.778 para 031022.
insert into promo_precio (promo, modelo, codigo, precio, desde, hasta, activo, cod_cliente)
select p.promo, p.modelo, p.codigo, 37778, now(), p.hasta, true, '031022'
  from promo_precio p
 where p.promo = 'Día de la Madre' and p.activo and p.cod_cliente is null
   and not exists (select 1 from promo_precio x where x.promo = p.promo and x.cod_cliente = '031022'
                     and x.modelo = p.modelo and x.codigo is not distinct from p.codigo);

-- Catálogo y checkout le pasan el cliente a la promo (texto reemplazado sobre la definición en vivo).
do $$
declare f record; d text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('catalogo_home','catalogo_modelo_v2','catalogo_checkout')
              and pg_get_functiondef(p.oid) like '%_promo_precio_sku(s.codigo, s.modelo)%' loop
    d := pg_get_functiondef(f.oid);
    d := replace(d, '_promo_precio_sku(s.codigo, s.modelo)',
                 case when f.proname = 'catalogo_checkout' then '_promo_precio_sku(s.codigo, s.modelo, now(), v_pcli)'
                      else '_promo_precio_sku(s.codigo, s.modelo, now(), v_cod)' end);
    execute d;
  end loop;
end $$;
