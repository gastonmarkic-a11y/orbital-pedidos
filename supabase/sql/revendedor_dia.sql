-- Revendedor: con quién le conviene hablar hoy (2026-10-08, Gastón).
-- Los clientes son compartidos con los vendedores (cliente_revendedor). Para no pisarse:
--   • no se sugiere una óptica con la que un vendedor habló en los últimos 30 días;
--   • lo que marca el revendedor queda en actividad_diaria (origen 'revendedor') y lo ven todos.
-- La Suite lo muestra de solo lectura (revendedor_compartidas) y Telegram lo manda a la mañana (ojo-revendedor).

-- La charla de vendedores: Marketing (envíos masivos) no cuenta como "estar hablando".
create or replace view public.v_cliente_revendedor_charla with (security_invoker = true) as
with act as (
  select cod_cliente, vendedor, created_at as cuando, 'actividad' as que from public.actividad_diaria
  union all select cod_cliente, vendedor, created_at, 'pedido' from public.pedidos where coalesce(estado, '') <> 'anulado'
  union all select cod_cliente, vendedor, creado_en, 'visita' from public.visitas_checkin where estado = 'confirmado'
)
select cr.cod_cliente, cr.revendedor, c.razon, c.localidad, a.vendedor,
       max(a.cuando) as ultima, (array_agg(a.que order by a.cuando desc))[1] as ultima_que
from public.cliente_revendedor cr
join public.clientes c on c.cod = cr.cod_cliente
join act a on a.cod_cliente = cr.cod_cliente and a.vendedor is distinct from cr.revendedor
  and coalesce(a.vendedor, '') not in ('Marketing', '')
where cr.activo and a.cuando >= '2026-01-01'
group by 1, 2, 3, 4, 5;
revoke all on public.v_cliente_revendedor_charla from anon;

-- El grupo de Telegram de cada revendedor.
create table if not exists public.revendedor_grupo (
  revendedor text primary key references public.vendedores(codigo),
  chat_id    bigint unique not null,
  nombre     text,
  creado_at  timestamptz not null default now()
);
alter table public.revendedor_grupo enable row level security;
revoke all on public.revendedor_grupo from anon, authenticated;

-- Las sugeridas de cada día y lo que pasó.
create table if not exists public.revendedor_sugerencia (
  id           bigserial primary key,
  fecha        date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  revendedor   text not null references public.vendedores(codigo),
  cod_cliente  text not null references public.clientes(cod) on delete cascade,
  orden        int not null,
  motivo       text not null,
  message_id   bigint,
  resultado    text check (resultado in ('hablo', 'reunion', 'pedido', 'no_interesa', 'no_atiende')),
  resultado_at timestamptz,
  resultado_por text,
  unique (fecha, revendedor, cod_cliente)
);
alter table public.revendedor_sugerencia enable row level security;
revoke all on public.revendedor_sugerencia from anon, authenticated;

-- Arma (una vez por día) las N ópticas con las que le conviene hablar hoy.
-- Primero las que ya compraron alguna vez (recupero), después las demás; siempre con teléfono,
-- sin charla de vendedores en 30 días, sin repetir lo sugerido en 21 días y sin las que ya dijeron que no.
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
        and not exists (select 1 from v_cliente_revendedor_charla h
                        where h.cod_cliente = c.cod and h.revendedor = p_rev and h.ultima >= now() - interval '30 days')
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

-- Lo que ve el revendedor en la Suite: solo lectura, solo sus compartidas, sin montos.
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
         ch.vendedor, ch.ultima::date,
         s.orden, s.motivo,
         r.resultado, r.resultado_at::date
  from yo
  join cliente_revendedor cr on cr.revendedor = yo.rev and cr.activo
  join clientes c on c.cod = cr.cod_cliente
  left join lateral (select h.vendedor, h.ultima from v_cliente_revendedor_charla h
                     where h.cod_cliente = c.cod and h.revendedor = yo.rev and h.ultima >= now() - interval '30 days'
                     order by h.ultima desc limit 1) ch on true
  left join revendedor_sugerencia s on s.cod_cliente = c.cod and s.revendedor = yo.rev and s.fecha = (select d from hoy)
  left join lateral (select x.resultado, x.resultado_at from revendedor_sugerencia x
                     where x.cod_cliente = c.cod and x.revendedor = yo.rev and x.resultado is not null
                     order by x.resultado_at desc limit 1) r on true
  order by s.orden nulls last, (ch.vendedor is not null), c.ultima_compra_fecha desc nulls last, 2;
$$;
revoke all on function public.revendedor_compartidas() from public, anon;
grant execute on function public.revendedor_compartidas() to authenticated;

-- 9:00 (AR) de lunes a viernes: Ojo les manda el día.
select cron.schedule('ojo-revendedor-dia', '0 12 * * 1-5', $c$
  select net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-revendedor?tarea=dia',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select valor from app_config where clave='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$c$);
