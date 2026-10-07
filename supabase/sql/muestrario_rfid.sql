-- Muestrario (valija) con etiquetas RFID. 2026-10-05
-- Cada pieza de la valija del vendedor lleva una etiqueta (NFC o UHF). El teléfono es el
-- receptor: en la óptica se separan las piezas que el cliente quiere, se leen, se ponen las
-- cantidades y sale la precarga (escaneo_precarga_crear) sin elegir artículos a mano.
-- La misma tabla arma la vista "Mi valija": qué piezas no tienen stock (no ofrecer), qué
-- colores con stock le faltan a la valija y qué piezas no aparecieron en el último control.

-- 1. Piezas de la valija
create table if not exists public.muestrario (
  id bigserial primary key,
  vendedor text not null,                 -- vendedores.codigo (igual que pedidos.vendedor)
  tag text not null,                      -- UID NFC / EPC UHF / código impreso, normalizado en mayúsculas
  codigo text not null,                   -- SKU (stock.codigo)
  estado text not null default 'en_valija',  -- en_valija | fuera (no apareció en el control / la sacó)
  creado_en timestamptz not null default now(),
  ultima_lectura timestamptz,             -- último control de valija en que apareció
  unique (vendedor, tag)
);
create index if not exists muestrario_vend_idx on public.muestrario (vendedor, estado);
create index if not exists muestrario_cod_idx on public.muestrario (codigo);

alter table public.muestrario enable row level security;
drop policy if exists muestrario_lectura on public.muestrario;
create policy muestrario_lectura on public.muestrario for select to authenticated using (true);
drop policy if exists muestrario_escritura on public.muestrario;
create policy muestrario_escritura on public.muestrario for all to authenticated using (true) with check (true);
