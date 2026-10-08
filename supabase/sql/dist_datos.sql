-- Datos diarios para distribuidores por el bot de distribuidores (Cristaldo, 2026-10-08, Gastón).
-- Córdoba + Entre Ríos + NOA + NEA. Compartidas con los vendedores: el primero que la activa se la queda.
-- Nunca se le pasa una óptica con la que un vendedor está hablando, ni se le dice quién habla.
-- Lo usa la función dist-datos (cron dist-datos-dia, 9 h ART L-V). Aplicado como migración dist_datos_cristaldo.

alter table distribuidores add column if not exists datos_rev text, add column if not exists datos_zona text;

insert into vendedores (codigo, nombre, rol, activo, cod_cliente)
select 'DistCristaldo', 'Cristaldo (Distribuidor)', 'revendedor', true, '010001'
where not exists (select 1 from vendedores where codigo = 'DistCristaldo');

update distribuidores set datos_rev = 'DistCristaldo',
  datos_zona = '(cordoba|entre rios|salta|jujuy|chaco|formosa|tucuman|catamarca|la rioja|santiago del estero|misiones|corrientes)'
where id = 1;

create table if not exists dist_sugerencia (
  id bigserial primary key,
  fecha date not null,
  distribuidor_id int not null references distribuidores(id),
  fuente text not null check (fuente in ('lead', 'base')),
  cod_cliente text,
  prospeccion_id bigint,
  orden int not null,
  motivo text,
  chat_id bigint,
  message_id bigint,
  resultado text,
  resultado_at timestamptz,
  resultado_por text,
  created_at timestamptz default now()
);
create index if not exists dist_sugerencia_dist_fecha on dist_sugerencia (distribuidor_id, fecha);
alter table dist_sugerencia enable row level security;

-- provincia normalizada (sin tildes, minúscula)
create or replace function dist_norm(p text) returns text language sql immutable as
$$ select translate(lower(trim(coalesce(p, ''))), 'áéíóúü', 'aeiouu') $$;

-- Ópticas de la zona libres: no compraron en 2026 y ningún vendedor las trabajó en 2026.
create or replace function dist_cargar_base(p_dist int) returns int
language plpgsql security definer set search_path to 'public' as $$
declare d distribuidores; n int;
begin
  select * into d from distribuidores where id = p_dist;
  if d.datos_rev is null then return 0; end if;
  insert into cliente_revendedor (cod_cliente, revendedor, desde, motivo, activo)
  select c.cod, d.datos_rev, now(), 'Distribuidor: óptica de su zona sin compras ni contacto en 2026', true
  from clientes c
  where dist_norm(c.provincia) ~ ('^' || d.datos_zona || '$')
    and c.cod not in (select cod_cliente from distribuidores where cod_cliente is not null)
    and c.cod not in (select cod_cliente from vendedores where cod_cliente is not null)
    and coalesce(c.ultima_compra_fecha, '1900-01-01') < '2026-01-01'
    and not exists (select 1 from cliente_revendedor cr where cr.cod_cliente = c.cod and cr.activo)
    and not exists (select 1 from actividad_diaria a where a.cod_cliente = c.cod and a.created_at >= '2026-01-01'
                    and coalesce(a.vendedor, '') not in ('Marketing', '', d.datos_rev))
    and not exists (select 1 from pedidos p where p.cod_cliente = c.cod and p.created_at >= '2026-01-01' and coalesce(p.estado, '') <> 'anulado')
    and not exists (select 1 from visitas_checkin v where v.cod_cliente = c.cod and v.creado_en >= '2026-01-01' and v.estado = 'confirmado');
  get diagnostics n = row_count;
  return n;
end $$;

-- ¿Algún vendedor (no el distribuidor) habló con esta óptica en los últimos 60 días?
create or replace function dist_vendedor_hablando(p_cod text, p_rev text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p_cod is not null and (
    exists (select 1 from actividad_diaria a where a.cod_cliente = p_cod and a.created_at >= now() - interval '60 days'
            and coalesce(a.vendedor, '') not in ('Marketing', '', p_rev))
    or exists (select 1 from pedidos p where p.cod_cliente = p_cod and p.created_at >= now() - interval '60 days'
               and coalesce(p.estado, '') <> 'anulado' and coalesce(p.vendedor, '') <> p_rev)
    or exists (select 1 from visitas_checkin v where v.cod_cliente = p_cod and v.creado_en >= now() - interval '60 days'
               and v.estado = 'confirmado' and coalesce(v.vendedor, '') <> p_rev)
    or exists (select 1 from v_cliente_toma t where t.cod_cliente = p_cod and t.dueno <> p_rev)
  )
$$;

-- El día: primero los leads nuevos de la zona (últimos 60 días) que ningún vendedor contactó,
-- después la base. Se arma una vez por día; las que ya se le pasaron no vuelven por 21 días.
create or replace function dist_armar_dia(p_dist int, p_n int default 10) returns setof dist_sugerencia
language plpgsql security definer set search_path to 'public' as $$
declare hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; d distribuidores;
begin
  select * into d from distribuidores where id = p_dist;
  if d.datos_rev is null then return; end if;
  if not exists (select 1 from dist_sugerencia where fecha = hoy and distribuidor_id = p_dist) then
    perform dist_cargar_base(p_dist);
    insert into dist_sugerencia (fecha, distribuidor_id, fuente, cod_cliente, prospeccion_id, orden, motivo)
    select hoy, p_dist, x.fuente, x.cod, x.pid, row_number() over (order by x.prio, x.cuando desc nulls last, x.azar), x.motivo
    from (
      select 'lead' fuente, ps.cod_cliente cod, ps.id pid, 0 prio, ps.created_at cuando, md5(ps.id::text || hoy::text) azar,
             '🆕 Nos consultó el ' || to_char(ps.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') ||
             case when ps.canal = 'meta_b2b' then ' por un anuncio' else ' por redes' end || '. Está esperando que lo contacten.' motivo
      from prospeccion_social ps
      where ps.rubro ilike '%ptica%'
        and ps.created_at >= now() - interval '60 days'
        and nullif(regexp_replace(coalesce(ps.telefono, ''), '\D', '', 'g'), '') is not null
        and ps.estado not in ('descartado', 'cerrado')
        and coalesce(ps.zona, '') !~* 'no (es|tengo)( una)? [oó]ptica'
        and (dist_norm(coalesce(nullif(trim(substring(ps.zona from '[^,]*$')), ''), ps.zona)) ~ ('^' || d.datos_zona || '$')
             or dist_norm(ps.zona) ~ ('^' || d.datos_zona || '$')
             or (d.id = 1 and dist_norm(ps.zona) in ('noa', 'nea')))
        -- un vendedor ya habló (o está en seguimiento)
        and not exists (select 1 from lead_check l where l.prospeccion_id = ps.id
                        and l.estado in ('contactado', 'seguimiento', 'cerrado', 'no_interesa'))
        and not dist_vendedor_hablando(ps.cod_cliente, d.datos_rev)
        and not exists (select 1 from dist_sugerencia s where s.distribuidor_id = p_dist and s.prospeccion_id = ps.id)
      union all
      select 'base', c.cod, null, case when c.ultima_compra_fecha is not null then 1 else 2 end, c.ultima_compra_fecha::timestamptz,
             md5(c.cod || hoy::text),
             case when c.ultima_compra_fecha is not null
                  then 'Nos compró hace un tiempo (última vez ' || to_char(c.ultima_compra_fecha, 'MM/YYYY') || '). Para retomar.'
                  else 'Óptica de tu zona que todavía no trabaja Orbital.' end
      from cliente_revendedor cr join clientes c on c.cod = cr.cod_cliente
      where cr.revendedor = d.datos_rev and cr.activo
        and coalesce(nullif(c.whatsapp, ''), nullif(c.telefono, '')) is not null
        and coalesce(c.ultima_compra_fecha, '1900-01-01') < '2026-01-01'
        and not dist_vendedor_hablando(c.cod, d.datos_rev)
        and not exists (select 1 from dist_sugerencia s where s.distribuidor_id = p_dist and s.cod_cliente = c.cod
                        and (s.fecha >= hoy - 21 or s.resultado in ('no_interesa', 'pedido', 'hablo', 'reunion')))
    ) x
    order by x.prio, x.cuando desc nulls last, x.azar
    limit p_n;
  end if;
  return query select * from dist_sugerencia where fecha = hoy and distribuidor_id = p_dist order by orden;
end $$;

revoke all on function dist_armar_dia(int, int), dist_cargar_base(int), dist_vendedor_hablando(text, text) from public, anon, authenticated;

select cron.schedule('dist-datos-dia', '0 12 * * 1-5', $c$
  select net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/dist-datos?tarea=dia',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select valor from app_config where clave='cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$c$);
