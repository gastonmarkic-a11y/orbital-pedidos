-- Los 25 contactos diarios para agendar visitas entran en Mi tanda (16/10/2026).
-- 7:05 AR (después de la tanda de las 7): se generan los contactos del día y se suman a tanda_diaria como
-- WhatsApp con su mensaje armado ("paso por <barrio> el <día>…"). Enviar desde la tanda los marca como
-- enviados en contactos_dia (y en la actividad); marcarlos desde Mi día los cierra en la tanda.

alter table tanda_diaria add column if not exists origen text;
alter table tanda_diaria add column if not exists mensaje text;

create or replace function contactos_a_tanda(p_fecha date default null) returns int
language plpgsql security definer set search_path = public as $$
declare f date := coalesce(p_fecha, hoy_ar()); n int;
begin
  insert into tanda_diaria (fecha, vendedor, cod_cliente, posta, canal, origen, mensaje)
  select c.fecha, c.vendedor, c.cod_cliente, 'AGENDA', 'whatsapp', 'contacto_agenda',
         mensaje_contacto(c.vendedor, c.motivo, c.micro_zona, c.fecha_visita, cl.contacto)
  from contactos_dia c join clientes cl on cl.cod = c.cod_cliente
  where c.fecha = f and c.estado = 'pendiente'
  order by c.vendedor, c.orden
  on conflict (fecha, vendedor, cod_cliente) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Tanda → contactos_dia: enviado desde la tanda = contacto hecho; deshacer lo vuelve a pendiente.
create or replace function tanda_sync_contacto() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.origen is distinct from 'contacto_agenda' or new.estado is not distinct from old.estado then return new; end if;
  if new.estado = 'enviado' then
    update contactos_dia set estado = 'enviado', actualizado_en = now()
    where fecha = new.fecha and vendedor = new.vendedor and cod_cliente = new.cod_cliente and estado = 'pendiente';
    get diagnostics n = row_count;
    if n > 0 then
      insert into actividad_diaria (fecha, vendedor, cod_cliente, nombre_comercio, origen, resultado_contacto, actividad_desarrollo)
      select hoy_ar(), new.vendedor, new.cod_cliente, coalesce(nullif(trim(c.nomcomerc), ''), c.razon), 'contacto_agenda', 'mensaje',
             'Mensaje para agendar visita del ' || to_char(cd.fecha_visita, 'DD/MM')
      from clientes c join contactos_dia cd on cd.cod_cliente = c.cod and cd.fecha = new.fecha and cd.vendedor = new.vendedor
      where c.cod = new.cod_cliente;
    end if;
  elsif new.estado = 'pendiente' and old.estado = 'enviado' then
    update contactos_dia set estado = 'pendiente', actualizado_en = now()
    where fecha = new.fecha and vendedor = new.vendedor and cod_cliente = new.cod_cliente and estado = 'enviado';
    delete from actividad_diaria where id in (
      select id from actividad_diaria where cod_cliente = new.cod_cliente and vendedor = new.vendedor
        and origen = 'contacto_agenda' and resultado_contacto = 'mensaje' and fecha = hoy_ar() order by id desc limit 1);
  end if;
  return new;
end $$;
drop trigger if exists tanda_sync_contacto on tanda_diaria;
create trigger tanda_sync_contacto after update of estado on tanda_diaria
  for each row execute function tanda_sync_contacto();

-- contactos_dia → tanda: si lo marca desde Mi día, sale de la tanda.
create or replace function contacto_sync_tanda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado <> 'pendiente' and old.estado = 'pendiente' then
    update tanda_diaria set estado = 'enviado', cerrado_at = now()
    where fecha = new.fecha and vendedor = new.vendedor and cod_cliente = new.cod_cliente
      and origen = 'contacto_agenda' and estado = 'pendiente';
  end if;
  return new;
end $$;
drop trigger if exists contacto_sync_tanda on contactos_dia;
create trigger contacto_sync_tanda after update of estado on contactos_dia
  for each row execute function contacto_sync_tanda();

revoke all on function contactos_a_tanda(date), tanda_sync_contacto(), contacto_sync_tanda() from public, anon, authenticated;

-- mi_tanda: el contacto para agendar trae su propio mensaje.
create or replace function mi_tanda(p_vendedor text, p_fecha date default current_date)
returns table(id bigint, cod_cliente text, razon text, provincia text, zona text, telefono text, email text, posta text, paso integer, pasos_totales integer, canal text, es_visita boolean, estado text, pieza_titulo text, pieza_mensaje text, pieza_guia text, pieza_link text, nota text, toques_previos integer, ultimo_toque timestamp with time zone, ultima_compra date, abrio_catalogo timestamp with time zone, abrio_propuesta timestamp with time zone, propuesta_abierta text, nota_vendedor text)
language sql security definer set search_path = public as $$
  with
  -- Tope: 30 llamadas por día. Lo que ya cerró hoy (hecha o salteada) descuenta del cupo.
  cupo as (
    select greatest(0, 30 - count(*))::int as n
      from tanda_diaria t
     where t.vendedor = p_vendedor and t.canal = 'llamada'
       and t.estado in ('enviado', 'omitido')
       and (t.cerrado_at at time zone 'America/Argentina/Buenos_Aires')::date = p_fecha
  ),
  base as (
    select t.*, c.razon, c.provincia as c_prov, c.whatsapp, c.telefono as c_tel, c.email as c_mail,
           c.ultima_compra_fecha as c_ucf, c.proximo_paso,
           row_number() over (
             partition by (t.canal = 'llamada')
             order by (t.pieza_id is distinct from 58), t.fecha,
                      case t.posta when 'P3_propuesta' then 0 when 'P2_interaccion' then 1
                                   when 'P5_dormido' then 2 when 'P4_activo' then 3 else 4 end, c.razon
           ) as rn
      from tanda_diaria t
      join clientes c on c.cod = t.cod_cliente
     where t.vendedor = p_vendedor and t.estado = 'pendiente'
       -- las llamadas quedan en la tanda hasta que se hagan (o venza el bloqueo), no solo el día que se cargaron
       and (t.fecha = p_fecha or (t.canal = 'llamada' and t.fecha <= p_fecha and t.bloqueado_hasta > now()))
  )
  select t.id, t.cod_cliente, t.razon, t.c_prov, e.zona,
         coalesce(t.whatsapp, t.c_tel), t.c_mail,
         t.posta, t.paso,
         (select count(*)::int from secuencia_posta s2 where s2.posta = t.posta and s2.activo),
         t.canal, t.es_visita, t.estado,
         case when t.origen = 'contacto_agenda' then 'Agendar visita' else p.titulo end,
         coalesce(t.mensaje, resolver_links(coalesce(p.mensaje_wa, p.contenido_texto), t.cod_cliente)),
         case when p.categoria = 'guion' then p.contenido_texto end,
         coalesce(p.url_corta, p.url_publica, p.url),
         sp.nota,
         (select count(*)::int from envio_contacto ec where ec.cod_cliente = t.cod_cliente),
         (select max(ec.enviado_at) from envio_contacto ec where ec.cod_cliente = t.cod_cliente),
         greatest(t.c_ucf, e.ultima_compra_fecha),
         e.abrio_catalogo, e.abrio_propuesta, e.propuesta_abierta,
         nullif(btrim(t.proximo_paso), '')
    from base t
    cross join cupo
    left join mv_embudo_b2b e on e.cod = t.cod_cliente
    left join piezas_marketing p on p.id = t.pieza_id
    left join secuencia_posta sp on sp.posta = t.posta and sp.paso = t.paso
   where t.canal <> 'llamada' or t.rn <= cupo.n
   order by (t.canal <> 'llamada'), t.rn;
$$;

-- 7:05 AR lun-vie, después de la tanda de las 7.
select cron.unschedule('contactos-tanda') where exists (select 1 from cron.job where jobname = 'contactos-tanda');
select cron.schedule('contactos-tanda', '5 10 * * 1-5', $$select generar_contactos_dia(hoy_ar()); select contactos_a_tanda(hoy_ar());$$);
