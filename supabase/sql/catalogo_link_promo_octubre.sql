-- Link genérico de la promo "Precio de octubre" para que los vendedores lo reenvíen a sus grupos.
-- No es de ninguna óptica: la óptica se identifica en el checkout (código/CUIT/mail o razón social),
-- y el pedido va a su vendedor asignado (o a Ulises si es prospecto). Se corta solo el 31/10 a la noche.

alter table catalogo_acceso add column if not exists vence_at timestamptz;

-- Clave válida = existe, activa y sin vencer. La usan home, fichas y checkout.
create or replace function catalogo_clave_ok(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_config where clave='catalogo_clave' and valor = p)
      or exists(select 1 from catalogo_acceso
                 where codigo = p and activo
                   and (vence_at is null or vence_at > now())
                   and coalesce(tipo,'') not in ('zn','zn_orbital'));
$$;

create or replace function catalogo_entrar(p text, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; h json; v_ip text; v_ua text; v_dev text;
        n_perm int; is_allowed boolean; v_max int; v_tel text; es_vendedor boolean;
begin
  if exists(select 1 from app_config where clave='catalogo_clave' and valor = p) then
    return jsonb_build_object('ok', true, 'tipo', 'clave');
  end if;
  select * into a from catalogo_acceso where codigo = p and activo limit 1;
  if a.codigo is null then return jsonb_build_object('ok', false); end if;
  -- los tokens del cobranding solo sirven en /zn (catálogo sin precios)
  if coalesce(a.tipo,'') in ('zn','zn_orbital') then return jsonb_build_object('ok', false); end if;
  -- link con fecha de corte (promo): pasada la fecha, se avisa que terminó
  if a.vence_at is not null and a.vence_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'vencido', 'label', a.label, 'vence_at', a.vence_at);
  end if;

  v_dev := nullif(p_device,'');
  begin
    h := current_setting('request.headers', true)::json;
    v_ip := split_part(coalesce(h->>'x-forwarded-for',''), ',', 1);
    v_ua := left(coalesce(h->>'user-agent',''), 300);
  exception when others then v_ip := null; v_ua := null; end;

  es_vendedor := exists (select 1 from vendedores v where v.user_id = auth.uid() and v.activo);

  select coalesce((select valor::int from app_config where clave='catalogo_max_dispositivos'), 2)
    into v_max;

  if a.tipo = 'optica' and v_dev is not null and not es_vendedor then
    select count(*) into n_perm from catalogo_dispositivos
      where codigo = a.codigo and estado = 'permitido';
    is_allowed := null;
    select true into is_allowed from catalogo_dispositivos
      where codigo = a.codigo and device_id = v_dev and estado = 'permitido' limit 1;

    if coalesce(is_allowed, false) then
      null;
    elsif n_perm < v_max then
      insert into catalogo_dispositivos(codigo, cod_cliente, device_id, estado, ip, user_agent)
        values (a.codigo, a.cod_cliente, v_dev, 'permitido', nullif(v_ip,''), nullif(v_ua,''))
        on conflict (codigo, device_id) do update set estado='permitido', updated_at=now();
    else
      insert into catalogo_dispositivos(codigo, cod_cliente, device_id, estado, ip, user_agent)
        values (a.codigo, a.cod_cliente, v_dev, 'pendiente', nullif(v_ip,''), nullif(v_ua,''))
        on conflict (codigo, device_id) do update
          set ip=excluded.ip, user_agent=excluded.user_agent, updated_at=now()
          where catalogo_dispositivos.estado <> 'permitido';
      select v.telefono_remitente into v_tel from vendedores v
        where v.codigo = a.vendedor and v.activo limit 1;
      return jsonb_build_object('ok', false, 'motivo', 'otro_dispositivo',
        'label', a.label, 'vendedor', a.vendedor, 'vendedor_tel', nullif(v_tel,''));
    end if;
  end if;

  insert into catalogo_visitas(codigo, cod_cliente, tipo, vendedor, device_id, ip, user_agent)
  values (a.codigo, a.cod_cliente, a.tipo, a.vendedor, v_dev, nullif(v_ip,''), nullif(v_ua,''));

  select v.telefono_remitente into v_tel from vendedores v
    where v.codigo = a.vendedor and v.activo limit 1;

  return jsonb_build_object('ok', true, 'tipo', a.tipo, 'codigo', a.codigo,
    'cod_cliente', a.cod_cliente, 'label', a.label, 'vendedor', a.vendedor,
    'vendedor_tel', nullif(v_tel,''), 'interno', es_vendedor, 'vence_at', a.vence_at);
end; $$;

-- La pantalla de envío de la Suite también lista los links de promo vigentes.
create or replace function catalogo_accesos_suite()
returns table(codigo text, tipo text, vendedor text, label text)
language sql stable security definer set search_path = public as $$
  select a.codigo, a.tipo, a.vendedor, a.label
  from catalogo_acceso a
  where a.activo and a.tipo in ('vendedor','corporativo','general','promo')
    and (a.vence_at is null or a.vence_at > now())
  order by a.tipo, a.vendedor;
$$;

insert into catalogo_acceso (codigo, tipo, cod_cliente, label, activo, creado_por, vendedor, vence_at)
values ('promo-octubre-' || substr(md5(random()::text), 1, 5), 'promo', null,
        'Precio de octubre · link para grupos (vence 31/10)', true, 'Gaston', null,
        '2026-11-01 00:00:00-03');
