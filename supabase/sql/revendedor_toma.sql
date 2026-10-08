-- Clientes compartidos con un revendedor: «el primero que la activa se la queda» (2026-10-08, Gastón).
-- Lola trabaja Cuyo y Omar también. Dueño de la óptica = quien la activó primero dentro de los
-- últimos 30 días (actividad, pedido o visita; Marketing no cuenta). Si nadie la toca en 30 días, se libera.
-- Si el otro la toca igual, Ojo le avisa (trigger → ojo-revendedor?tarea=pisada).

create or replace view public.v_cliente_toma with (security_invoker = true) as
with act as (
  select cod_cliente, vendedor, created_at as cuando from public.actividad_diaria
  union all select cod_cliente, vendedor, created_at from public.pedidos where coalesce(estado, '') <> 'anulado'
  union all select cod_cliente, vendedor, creado_en from public.visitas_checkin where estado = 'confirmado'
),
recientes as (
  select a.cod_cliente, a.vendedor, a.cuando
  from act a
  join public.cliente_revendedor cr on cr.cod_cliente = a.cod_cliente and cr.activo
  where a.cuando >= now() - interval '30 days' and coalesce(a.vendedor, '') not in ('Marketing', '')
)
select distinct on (cod_cliente) cod_cliente, vendedor as dueno, cuando as desde,
       (select max(r2.cuando) from recientes r2 where r2.cod_cliente = r.cod_cliente and r2.vendedor = r.vendedor) as ultima
from recientes r
order by cod_cliente, cuando;
revoke all on public.v_cliente_toma from anon;

-- Para la Cartera de los vendedores: las compartidas que tomó un revendedor.
create or replace function public.clientes_tomados_revendedor()
returns table (cod text, revendedor text, nombre text, desde date)
language sql stable security definer set search_path = public as $$
  select t.cod_cliente, t.dueno, split_part(coalesce(cl.razon, v.nombre, t.dueno), ' ', 1), t.desde::date
  from v_cliente_toma t
  join vendedores v on v.codigo = t.dueno and v.rol = 'revendedor'
  left join clientes cl on cl.cod = v.cod_cliente;
$$;
revoke all on function public.clientes_tomados_revendedor() from public, anon;
grant execute on function public.clientes_tomados_revendedor() to authenticated;

-- Las sugeridas del día: fuera las que tiene otro (antes: cualquier charla de vendedor en 30 días).
create or replace function public.revendedor_armar_dia(p_rev text, p_n int default 6)
returns setof public.revendedor_sugerencia
language plpgsql security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not exists (select 1 from revendedor_sugerencia where fecha = hoy and revendedor = p_rev) then
    insert into revendedor_sugerencia (fecha, revendedor, cod_cliente, orden, motivo)
    select hoy, p_rev, x.cod, row_number() over (order by x.prio, x.ult desc nulls last, x.azar), x.motivo
    from (
      select c.cod,
             case when c.ultima_compra_fecha is not null then 1 else 2 end as prio,
             c.ultima_compra_fecha::date as ult,
             md5(c.cod || hoy::text) as azar,
             case when c.ultima_compra_fecha is not null
                  then 'Ya nos compró (última vez ' || to_char(c.ultima_compra_fecha::date, 'MM/YYYY') || '). Retomar.'
                  else 'Óptica de la zona que todavía no nos compra.' end as motivo
      from cliente_revendedor cr
      join clientes c on c.cod = cr.cod_cliente
      where cr.revendedor = p_rev and cr.activo
        and coalesce(nullif(c.whatsapp, ''), nullif(c.telefono, '')) is not null
        and not exists (select 1 from v_cliente_toma t where t.cod_cliente = c.cod and t.dueno <> p_rev)
        and not exists (select 1 from revendedor_sugerencia s
                        where s.cod_cliente = c.cod and s.revendedor = p_rev
                          and (s.fecha >= hoy - 21 or s.resultado in ('no_interesa', 'pedido')))
    ) x
    order by x.prio, x.ult desc nulls last, x.azar
    limit p_n;
  end if;
  return query select * from revendedor_sugerencia where fecha = hoy and revendedor = p_rev order by orden;
end $$;
revoke all on function public.revendedor_armar_dia(text, int) from public, anon, authenticated;

-- «Mis ópticas»: «no tocar» = la tiene otro (el que la activó primero).
create or replace function public.revendedor_compartidas()
returns table (
  cod text, nombre text, localidad text, provincia text, telefono text,
  vendedor text, ultima_compra date, ya_compro boolean,
  charla_vendedor text, charla_fecha date,
  hoy_orden int, hoy_motivo text,
  mi_resultado text, mi_resultado_fecha date
)
language sql stable security definer set search_path = public as $$
  with yo as (select current_vendedor_codigo() as rev),
  hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d)
  select c.cod,
         coalesce(nullif(c.nomcomerc, ''), c.razon),
         c.localidad, c.provincia,
         coalesce(nullif(c.whatsapp, ''), nullif(c.telefono, '')),
         c.vendedor_asignado,
         c.ultima_compra_fecha::date,
         c.ultima_compra_fecha is not null,
         case when t.dueno <> yo.rev then t.dueno end,
         case when t.dueno <> yo.rev then t.desde::date end,
         s.orden, s.motivo,
         r.resultado, r.resultado_at::date
  from yo
  join cliente_revendedor cr on cr.revendedor = yo.rev and cr.activo
  join clientes c on c.cod = cr.cod_cliente
  left join v_cliente_toma t on t.cod_cliente = c.cod
  left join revendedor_sugerencia s on s.cod_cliente = c.cod and s.revendedor = yo.rev and s.fecha = (select d from hoy)
  left join lateral (select x.resultado, x.resultado_at from revendedor_sugerencia x
                     where x.cod_cliente = c.cod and x.revendedor = yo.rev and x.resultado is not null
                     order by x.resultado_at desc limit 1) r on true
  order by s.orden nulls last, (t.dueno is not null and t.dueno <> yo.rev), c.ultima_compra_fecha desc nulls last, 2;
$$;
revoke all on function public.revendedor_compartidas() from public, anon;
grant execute on function public.revendedor_compartidas() to authenticated;

-- Aviso cuando alguien toca una compartida que ya es de otro. Una vez por día y por persona.
create table if not exists public.revendedor_pisada (
  cod_cliente text not null,
  quien       text not null,
  dueno       text not null,
  fecha       date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  primary key (cod_cliente, quien, fecha)
);
alter table public.revendedor_pisada enable row level security;
revoke all on public.revendedor_pisada from anon, authenticated;

create or replace function public.revendedor_pisada_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text;
begin
  if new.cod_cliente is null or coalesce(new.vendedor, '') in ('Marketing', '') then return new; end if;
  if not exists (select 1 from cliente_revendedor where cod_cliente = new.cod_cliente and activo) then return new; end if;
  select dueno into d from v_cliente_toma where cod_cliente = new.cod_cliente;
  if d is null or d = new.vendedor then return new; end if;
  insert into revendedor_pisada (cod_cliente, quien, dueno) values (new.cod_cliente, new.vendedor, d) on conflict do nothing;
  if found then
    perform net.http_post(
      url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-revendedor?tarea=pisada',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select valor from app_config where clave = 'cron_key')),
      body := jsonb_build_object('cod', new.cod_cliente, 'quien', new.vendedor, 'dueno', d),
      timeout_milliseconds := 30000);
  end if;
  return new;
exception when others then
  return new; -- un aviso que falla nunca frena la carga de actividad
end $$;

drop trigger if exists revendedor_pisada on public.actividad_diaria;
create trigger revendedor_pisada after insert on public.actividad_diaria
  for each row execute function public.revendedor_pisada_trg();
