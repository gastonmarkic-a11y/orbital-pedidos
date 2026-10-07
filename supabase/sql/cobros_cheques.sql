-- Cobros a plazo (2026-10-05)
-- Si el pedido es con cheque / e-cheq a X días, el cobro muestra el plan (vencimientos y montos) y el cliente
-- o el vendedor sube la copia de cada cheque/e-cheq. Quedan "declarados" hasta que administración los imputa:
-- recién ahí entran a cheques_cartera (con pago_id, pedido_id y fotos) y el pago queda verificado.

create table if not exists pago_cheques (
  id                uuid primary key default gen_random_uuid(),
  pago_id           uuid not null references pagos(id) on delete cascade,
  tipo              text not null default 'echeck' check (tipo in ('fisico','echeck')),
  numero            text,
  banco             text,
  monto             numeric(14,2) not null check (monto > 0),
  fecha_vencimiento date not null,
  echeq_id          text,
  cuit_librador     text,
  nombre_librador   text,
  foto_frente       text,
  foto_dorso        text,
  estado            text not null default 'declarado' check (estado in ('declarado','imputado','descartado')),
  cheque_id         bigint references cheques_cartera(id) on delete set null,
  origen            text not null default 'cliente',
  nota              text,
  created_at        timestamptz not null default now()
);
create index if not exists pago_cheques_pago_idx on pago_cheques(pago_id);

alter table pago_cheques enable row level security;
drop policy if exists pago_cheques_lectura on pago_cheques;
create policy pago_cheques_lectura on pago_cheques for select to authenticated using (
  es_financiero()
  or exists (select 1 from pagos g join pedidos p on p.id = g.pedido_id
             where g.id = pago_cheques.pago_id and p.vendedor = current_vendedor_codigo())
);
drop policy if exists pago_cheques_admin on pago_cheques;
create policy pago_cheques_admin on pago_cheques for all to authenticated using (es_financiero()) with check (es_financiero());

-- Cliente (página pública) o vendedor (Suite): declara un cheque / e-cheq con sus fotos.
create or replace function public.cobro_cheque_declarar(p_ref text, p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v pagos; pref text; quien text;
begin
  select * into v from pagos where referencia = upper(trim(p_ref));
  if v.id is null or v.estado = 'verificado' then return false; end if;
  pref := 'publico/' || v.referencia || '/%';
  if coalesce(p->>'foto_frente', '') = '' or p->>'foto_frente' not like pref
     or (coalesce(p->>'foto_dorso', '') <> '' and p->>'foto_dorso' not like pref) then return false; end if;
  if coalesce((p->>'monto')::numeric, 0) <= 0 or nullif(p->>'fecha_vencimiento', '') is null then return false; end if;
  quien := current_vendedor_codigo();
  insert into pago_cheques (pago_id, tipo, numero, banco, monto, fecha_vencimiento, echeq_id, cuit_librador,
                            nombre_librador, foto_frente, foto_dorso, origen)
  values (v.id, case when p->>'tipo' = 'fisico' then 'fisico' else 'echeck' end,
          nullif(trim(p->>'numero'), ''), nullif(trim(p->>'banco'), ''), round((p->>'monto')::numeric, 2),
          (p->>'fecha_vencimiento')::date, nullif(trim(p->>'echeq_id'), ''), nullif(trim(p->>'cuit_librador'), ''),
          nullif(trim(p->>'nombre_librador'), ''), p->>'foto_frente', nullif(p->>'foto_dorso', ''),
          coalesce(quien, 'cliente'));
  update pagos set estado = case when estado in ('pendiente','rechazado') then 'comprobante' else estado end,
    updated_at = now() where id = v.id;
  perform cobro_avisar_ojo('🧾 ' || case when p->>'tipo' = 'fisico' then 'Cheque' else 'E-cheq' end || ' cargado · '
    || v.referencia || ' · ' || regexp_replace(coalesce(v.cliente,''), '^\d+ - ', '')
    || ' · $' || to_char((p->>'monto')::numeric, 'FM999G999G999') || ' vence ' || to_char((p->>'fecha_vencimiento')::date, 'DD/MM/YYYY')
    || coalesce(' (lo cargó ' || quien || ')', '') || E'\nImputalo en la Suite → Cobros');
  return true;
end $$;

-- Staff: descartar un cheque declarado (foto ilegible, cargado dos veces, etc.)
create or replace function public.cobro_cheque_descartar(p_id uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_financiero() then raise exception 'Solo administración'; end if;
  update pago_cheques set estado = 'descartado', nota = nullif(p_nota, '') where id = p_id and estado = 'declarado';
end $$;

-- Staff: imputar los cheques declarados → cheques_cartera. El pago queda verificado (la plata entra a la cuenta
-- cuando el cheque se cobra en /finanzas → Cheques, no ahora). Si cubre el total, el pedido queda cobrado.
create or replace function public.cobro_imputar_cheques(p_id uuid, p_razon text) returns pagos
language plpgsql security definer set search_path = public as $$
declare v pagos; ped pedidos; c pago_cheques; nuevo bigint; total numeric := 0; tipos text[] := '{}'; pend numeric;
begin
  if not es_financiero() then raise exception 'Solo administración imputa cheques'; end if;
  if p_razon not in ('Ejemplar','Plenorius','Plastic') then raise exception 'Elegí la razón social'; end if;
  select * into v from pagos where id = p_id for update;
  if v.id is null then raise exception 'Pago inexistente'; end if;
  select * into ped from pedidos where id = v.pedido_id;
  for c in select * from pago_cheques where pago_id = p_id and estado = 'declarado' order by fecha_vencimiento loop
    if coalesce(c.numero, c.echeq_id) is null then raise exception 'Falta el número de un cheque (vence %)', to_char(c.fecha_vencimiento, 'DD/MM'); end if;
    insert into cheques_cartera (numero, banco, monto, tipo, fecha_recepcion, fecha_vencimiento, cliente_id, cliente_nombre,
                                 razon_social, pedido_id, pago_id, echeq_id, cuit_librador, nombre_librador,
                                 foto_frente, foto_dorso, nota, creado_por)
    values (coalesce(c.numero, c.echeq_id), coalesce(c.banco, case when c.tipo = 'echeck' then 'E-cheq' else 'Sin banco' end),
            c.monto, c.tipo, current_date, c.fecha_vencimiento, ped.cod_cliente,
            regexp_replace(coalesce(v.cliente, ''), '^\d+ - ', ''), p_razon, v.pedido_id, v.id, c.echeq_id,
            c.cuit_librador, c.nombre_librador, c.foto_frente, c.foto_dorso, 'Cobro ' || v.referencia, current_vendedor_codigo())
    returning id into nuevo;
    update pago_cheques set estado = 'imputado', cheque_id = nuevo where id = c.id;
    total := total + c.monto;
    tipos := array_append(tipos, c.tipo);
  end loop;
  if total = 0 then raise exception 'No hay cheques para imputar'; end if;
  update pagos set estado = 'verificado', monto_recibido = coalesce(monto_recibido, 0) + total,
    origen = case when 'fisico' = any(tipos) then 'cheque' else 'echeq' end,
    fecha_pago = coalesce(fecha_pago, now()), verificado_por = current_vendedor_codigo(), verificado_en = now(), updated_at = now()
  where id = p_id returning * into v;
  if v.pedido_id is not null then
    select sum(monto_esperado) - coalesce(sum(monto_recibido) filter (where estado = 'verificado'), 0) into pend
      from pagos where pedido_id = v.pedido_id and estado <> 'rechazado';
    if coalesce(pend, 0) <= 1 then update pedidos set cobrado = true where id = v.pedido_id; end if;
  end if;
  return v;
exception when unique_violation then
  raise exception 'Ese número de cheque ya está en la cartera para ese banco';
end $$;

-- Página pública: suma plan de pago y cheques ya cargados
create or replace function public.cobro_publico(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v pagos; cuentas jsonb; ped pedidos; ch jsonb;
begin
  select * into v from pagos where referencia = upper(trim(p_ref));
  if v.id is null then return null; end if;
  if v.cuenta_id is not null then
    select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'razon_social', razon_social,
             'alias', alias, 'cbu_cvu', cbu_cvu, 'titular', titular, 'cuit', cuit))
      into cuentas from cuentas_financieras where id = v.cuenta_id and cobro_activa;
  end if;
  select * into ped from pedidos where id = v.pedido_id;
  select jsonb_agg(jsonb_build_object('tipo', tipo, 'monto', monto, 'fecha_vencimiento', fecha_vencimiento,
           'numero', right(coalesce(numero, echeq_id, ''), 4), 'estado', estado) order by fecha_vencimiento)
    into ch from pago_cheques where pago_id = v.id and estado <> 'descartado';
  return jsonb_build_object(
    'referencia', v.referencia,
    'monto', coalesce(v.monto_esperado, 0),
    'estado', v.estado,
    'cliente', regexp_replace(coalesce(v.cliente, ''), '^\d+ - ', ''),
    'comprobante', v.comprobante_path is not null,
    'cuentas', coalesce(cuentas, cobro_cuentas()),
    'cond_pago', ped.cond_pago,
    'cuotas_detalle', ped.cuotas_detalle,
    'medios_pago', to_jsonb(ped.medios_pago),
    'fecha_base', ped.fecha_factura,
    'cheques', coalesce(ch, '[]'::jsonb));
end $$;

revoke all on function public.cobro_cheque_descartar(uuid, text), public.cobro_imputar_cheques(uuid, text) from public, anon;
grant execute on function public.cobro_cheque_descartar(uuid, text), public.cobro_imputar_cheques(uuid, text) to authenticated;
grant execute on function public.cobro_cheque_declarar(text, jsonb), public.cobro_publico(text) to anon, authenticated;
