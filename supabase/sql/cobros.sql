-- Módulo de Cobros (2026-09-28)
-- Cobro sin intermediarios: transferencia a alias/CBU/CVU propio con referencia ORB-<pedido>.
-- Reusa cuentas_financieras (cuentas de cobro) y cheques_cartera (cartera de cheques) de /finanzas.

-- 1) Cuentas de cobro = cuentas_financieras con datos para transferir
alter table cuentas_financieras
  add column if not exists alias text,
  add column if not exists cbu_cvu text,
  add column if not exists titular text,
  add column if not exists cuit text,
  add column if not exists cobro_activa boolean not null default false; -- se muestra al cliente

-- 2) Cheques: vínculo con el pago + datos del e-cheq y fotos
alter table cheques_cartera
  add column if not exists pago_id uuid,
  add column if not exists echeq_id text,
  add column if not exists cuit_librador text,
  add column if not exists nombre_librador text,
  add column if not exists foto_frente text,
  add column if not exists foto_dorso text;

-- 3) Pagos: uno por pedido (referencia ORB-<id>)
create table if not exists pagos (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       bigint references pedidos(id) on delete set null,
  referencia      text unique not null,
  cliente         text,
  cuenta_id       bigint references cuentas_financieras(id),
  monto_esperado  numeric(14,2) not null,
  monto_recibido  numeric(14,2),
  comision        numeric(14,2) not null default 0,
  retenciones     numeric(14,2) not null default 0,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','comprobante','detectado','verificado','rechazado')),
  origen          text check (origen in ('transferencia','mp_cvu','banco','efectivo','cheque','echeq','mercadolibre','mp_link','shopify','tarjeta')),
  comprobante_path text,
  cuit_pagador    text,
  nombre_pagador  text,
  concepto        text,
  fecha_pago      timestamptz,
  verificado_por  text,
  verificado_en   timestamptz,
  notas           text,
  creado_por      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pagos_pedido_idx on pagos(pedido_id);
create index if not exists pagos_estado_idx on pagos(estado) where estado <> 'verificado';

create or replace function public.current_vendedor_codigo() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select codigo from vendedores where user_id = auth.uid() and activo limit 1),
    (select vl.codigo from vendedor_logins vl join vendedores v on v.codigo = vl.codigo
      where vl.user_id = auth.uid() and v.activo limit 1));
$$;

alter table pagos enable row level security;
drop policy if exists pagos_lectura on pagos;
create policy pagos_lectura on pagos for select to authenticated using (
  es_financiero()
  or exists (select 1 from pedidos p where p.id = pagos.pedido_id and p.vendedor = current_vendedor_codigo())
);
drop policy if exists pagos_admin on pagos;
create policy pagos_admin on pagos for all to authenticated using (es_financiero()) with check (es_financiero());

-- Aviso al grupo de Ojo (misma edge que usan los demás avisos)
create or replace function public.cobro_avisar_ojo(p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-avisar',
    headers := jsonb_build_object('x-cron-key', (select valor from app_config where clave = 'cron_key'),
                                  'Content-Type', 'application/json'),
    body := jsonb_build_object('texto', p_texto),
    timeout_milliseconds := 10000);
exception when others then null; -- un aviso caído nunca frena el cobro
end $$;

-- Staff: crea (o devuelve) el pago de un pedido. El monto lo calcula la Suite (neto + IVA de la parte facturada).
create or replace function public.cobro_de_pedido(p_pedido bigint, p_monto numeric, p_cuenta bigint default null)
returns pagos language plpgsql security definer set search_path = public as $$
declare v pagos; ped pedidos;
begin
  select * into ped from pedidos where id = p_pedido;
  if ped.id is null then raise exception 'Pedido inexistente'; end if;
  if not (es_financiero() or ped.vendedor = current_vendedor_codigo()) then raise exception 'Sin permiso'; end if;
  select * into v from pagos where referencia = 'ORB-' || p_pedido;
  if v.id is null then
    insert into pagos (pedido_id, referencia, cliente, cuenta_id, monto_esperado, creado_por)
    values (p_pedido, 'ORB-' || p_pedido, ped.cliente, p_cuenta, round(p_monto, 2), current_vendedor_codigo())
    returning * into v;
  elsif v.estado in ('pendiente','rechazado') and (v.monto_esperado <> round(p_monto,2) or p_cuenta is distinct from v.cuenta_id) then
    update pagos set monto_esperado = round(p_monto, 2), cuenta_id = coalesce(p_cuenta, cuenta_id), updated_at = now()
    where id = v.id returning * into v;
  end if;
  return v;
end $$;

-- Cuentas que ve el cliente (alias/CBU no son secretos: se los mandás igual por WhatsApp)
create or replace function public.cobro_cuentas() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'razon_social', razon_social,
           'alias', alias, 'cbu_cvu', cbu_cvu, 'titular', titular, 'cuit', cuit) order by orden, id), '[]'::jsonb)
  from cuentas_financieras where activo and cobro_activa and coalesce(alias, cbu_cvu) is not null;
$$;

-- Página pública /cobro/ORB-xxx: solo lo necesario para pagar
create or replace function public.cobro_publico(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v pagos; cuentas jsonb;
begin
  select * into v from pagos where referencia = upper(trim(p_ref));
  if v.id is null then return null; end if;
  if v.cuenta_id is not null then
    select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'razon_social', razon_social,
             'alias', alias, 'cbu_cvu', cbu_cvu, 'titular', titular, 'cuit', cuit))
      into cuentas from cuentas_financieras where id = v.cuenta_id and cobro_activa;
  end if;
  return jsonb_build_object(
    'referencia', v.referencia,
    'monto', coalesce(v.monto_esperado, 0),
    'estado', v.estado,
    'cliente', regexp_replace(coalesce(v.cliente, ''), '^\d+ - ', ''),
    'comprobante', v.comprobante_path is not null,
    'cuentas', coalesce(cuentas, cobro_cuentas()));
end $$;

-- Cliente sube comprobante desde la página pública
create or replace function public.cobro_comprobante(p_ref text, p_path text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v pagos;
begin
  select * into v from pagos where referencia = upper(trim(p_ref));
  if v.id is null or p_path not like 'publico/' || v.referencia || '/%' then return false; end if;
  update pagos set comprobante_path = p_path,
    estado = case when estado in ('pendiente','rechazado') then 'comprobante' else estado end,
    updated_at = now() where id = v.id;
  perform cobro_avisar_ojo('🧾 Comprobante de pago subido · ' || v.referencia || ' · '
    || regexp_replace(coalesce(v.cliente,''), '^\d+ - ', '') || ' · $' || to_char(v.monto_esperado, 'FM999G999G999')
    || E'\nVerificalo en la Suite → Cobros');
  return true;
end $$;

-- Staff: verificar (mueve el saldo de la cuenta y marca el pedido cobrado si ya está todo)
create or replace function public.cobro_verificar(p_id uuid, p_monto numeric, p_cuenta bigint, p_origen text default 'transferencia', p_nota text default null)
returns pagos language plpgsql security definer set search_path = public as $$
declare v pagos; pend numeric;
begin
  if not es_financiero() then raise exception 'Solo administración verifica pagos'; end if;
  select * into v from pagos where id = p_id for update;
  if v.id is null then raise exception 'Pago inexistente'; end if;
  if v.estado = 'verificado' then return v; end if;
  if p_cuenta is null then raise exception 'Elegí la cuenta donde entró'; end if;
  update pagos set estado = 'verificado', monto_recibido = p_monto, cuenta_id = p_cuenta, origen = p_origen,
    fecha_pago = coalesce(fecha_pago, now()), verificado_por = current_vendedor_codigo(), verificado_en = now(),
    notas = coalesce(nullif(p_nota, ''), notas), updated_at = now()
  where id = p_id returning * into v;
  insert into movimientos_financieros (cuenta_id, fecha, monto, tipo, contraparte, detalle, origen, ref_externa, creado_por)
  values (p_cuenta, current_date, p_monto,
          case when p_origen = 'efectivo' then 'cobranza en efectivo' else 'transferencia recibida' end,
          regexp_replace(coalesce(v.cliente,''), '^\d+ - ', ''), 'Cobro ' || v.referencia, 'cobros', v.referencia,
          current_vendedor_codigo());
  update cuentas_financieras set saldo_actual = coalesce(saldo_actual, 0) + p_monto where id = p_cuenta;
  if v.pedido_id is not null then
    select sum(monto_esperado) - coalesce(sum(monto_recibido) filter (where estado = 'verificado'), 0) into pend
      from pagos where pedido_id = v.pedido_id and estado <> 'rechazado';
    if coalesce(pend, 0) <= 1 then update pedidos set cobrado = true where id = v.pedido_id; end if;
  end if;
  return v;
end $$;

create or replace function public.cobro_rechazar(p_id uuid, p_nota text) returns pagos
language plpgsql security definer set search_path = public as $$
declare v pagos;
begin
  if not es_financiero() then raise exception 'Solo administración rechaza pagos'; end if;
  update pagos set estado = 'rechazado', notas = trim(coalesce(notas,'') || ' ' || coalesce(p_nota,'')), updated_at = now()
  where id = p_id and estado <> 'verificado' returning * into v;
  return v;
end $$;

revoke all on function public.cobro_de_pedido(bigint, numeric, bigint), public.cobro_verificar(uuid, numeric, bigint, text, text),
  public.cobro_rechazar(uuid, text), public.cobro_avisar_ojo(text) from public, anon;
grant execute on function public.cobro_de_pedido(bigint, numeric, bigint), public.cobro_verificar(uuid, numeric, bigint, text, text),
  public.cobro_rechazar(uuid, text) to authenticated;
grant execute on function public.cobro_publico(text), public.cobro_comprobante(text, text), public.cobro_cuentas() to anon, authenticated;

-- 4) Storage: comprobantes (privado). El cliente solo puede SUBIR bajo publico/ORB-xxx/; nadie anónimo lee.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;
drop policy if exists comprobantes_subir_publico on storage.objects;
create policy comprobantes_subir_publico on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprobantes' and name like 'publico/ORB-%');
drop policy if exists comprobantes_staff on storage.objects;
create policy comprobantes_staff on storage.objects for all to authenticated
  using (bucket_id = 'comprobantes' and current_vendedor_rol() is not null)
  with check (bucket_id = 'comprobantes' and current_vendedor_rol() is not null);
