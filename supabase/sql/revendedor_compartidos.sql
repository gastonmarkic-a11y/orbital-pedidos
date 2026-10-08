-- Clientes compartidos con un revendedor (2026-10-08, Gastón).
-- El cliente sigue con su vendedor; el revendedor se suma. Quien vende se lo queda.
-- Si un vendedor está hablando con el cliente, se avisa (v_cliente_revendedor_charla).

create table if not exists public.cliente_revendedor (
  cod_cliente text not null references public.clientes(cod) on delete cascade,
  revendedor  text not null,              -- vendedores.codigo con rol revendedor
  desde       timestamptz not null default now(),
  motivo      text,
  activo      boolean not null default true,
  primary key (cod_cliente, revendedor)
);
alter table public.cliente_revendedor enable row level security;
revoke all on public.cliente_revendedor from anon;
create policy cliente_revendedor_leer on public.cliente_revendedor for select to authenticated using (true);

-- Actividad de vendedores (no del revendedor) sobre los clientes compartidos.
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
where cr.activo and a.cuando >= '2026-01-01'
group by 1, 2, 3, 4, 5;
revoke all on public.v_cliente_revendedor_charla from anon;

-- Carga inicial: Santa Fe para Omar (RevCuyoSF), menos los de Adrián con actividad o compra en 2026.
insert into public.cliente_revendedor (cod_cliente, revendedor, motivo)
select c.cod, 'RevCuyoSF', 'Santa Fe compartido con Omar'
from public.clientes c
where c.provincia ilike '%santa fe%'
  -- coalesce: sin fecha de compra la condición da null y dejaba afuera a los de Adrián sin actividad.
  and not coalesce(
    coalesce(c.vendedor_asignado, '') = 'Adrian' and (
      coalesce(c.ultima_compra_fecha::date >= '2026-01-01', false)
      or exists (select 1 from public.actividad_diaria a where a.cod_cliente = c.cod and a.created_at >= '2026-01-01')
      or exists (select 1 from public.pedidos p where p.cod_cliente = c.cod and p.created_at >= '2026-01-01' and coalesce(p.estado, '') <> 'anulado')
      or exists (select 1 from public.visitas_checkin v where v.cod_cliente = c.cod and v.creado_en >= '2026-01-01' and v.estado = 'confirmado')
    ), false)
on conflict do nothing;

-- Cuyo para Omar (2026-10-08, misma lógica): todas menos las que un vendedor trabajó o compraron en 2026.
insert into public.cliente_revendedor (cod_cliente, revendedor, motivo)
select c.cod, 'RevCuyoSF', 'Cuyo compartido con Omar'
from public.clientes c
where region_de(c.provincia, c.localidad) = 'CUYO'
  and not (
    coalesce(c.ultima_compra_fecha::date >= '2026-01-01', false)
    or exists (select 1 from public.actividad_diaria a where a.cod_cliente = c.cod and a.created_at >= '2026-01-01' and coalesce(a.vendedor, '') not in ('Marketing', ''))
    or exists (select 1 from public.pedidos p where p.cod_cliente = c.cod and p.created_at >= '2026-01-01' and coalesce(p.estado, '') <> 'anulado')
    or exists (select 1 from public.visitas_checkin v where v.cod_cliente = c.cod and v.creado_en >= '2026-01-01' and v.estado = 'confirmado')
  )
on conflict do nothing;
