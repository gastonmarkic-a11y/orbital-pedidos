-- Ojo dividido por tema (2026-09-30, Gastón).
-- Seis grupos de Telegram, uno por tema; Gastón está en todos. Mientras un grupo no se creó,
-- lo suyo sigue cayendo en el grupo general. Ojo hace de puente entre grupos (ojo_puente).

create table if not exists public.ojo_temas (
  tema         text primary key,
  label        text not null,
  emoji        text not null,
  creador      text not null,          -- código (tarjetas_tg) de quien crea el grupo
  creador_tg   bigint,
  miembros     text[] not null default '{}',
  para_que     text not null,
  claves       text[] not null default '{}', -- para reconocer el grupo por su nombre
  orden        int not null default 0,
  chat_id      bigint,                 -- se completa cuando crean el grupo y agregan a Ojo
  creado_at    timestamptz,
  recordado_at timestamptz
);
alter table public.ojo_temas enable row level security;

insert into public.ojo_temas (tema, label, emoji, creador, creador_tg, miembros, para_que, claves, orden) values
  ('ventas', 'Ventas', '🛒', 'Adrian', 8932091802, '{Adrian,Bruno,Lola}',
   'consultas de ópticas (🆘 comerciales), carritos, catálogo y propuestas abiertas, agenda del día, reuniones y leads', '{venta}', 1),
  ('prospeccion', 'Prospección', '🎯', 'Mauro', 1492284323, '{Mauro,Ulises,Administracion}',
   'las reuniones que consiguen (Ojo se las pasa a Ventas y trae la confirmación), seguimiento de prospectos', '{prospec}', 2),
  ('consumidor', 'Consumidor final', '🛍️', 'Gustavo', 8882886609, '{Gustavo}',
   'consumidores finales: consultas de compra, recomendaciones, sugerencias y búsquedas que IRIS no resolvió', '{consumidor,tienda,publico,público}', 3),
  ('postventa', 'Postventa', '🔧', 'Postventa', 8787491746, '{Postventa,Mauro}',
   'roturas, garantías, repuestos, cambios, devoluciones, demoras y reclamos (ópticas y consumidores)', '{postventa,post venta,post-venta}', 4),
  ('deposito', 'Depósito', '📦', 'Deposito', 8620041870, '{Deposito}',
   'pedidos nuevos y su avance (preparación, listo, despacho), faltantes y conteos de stock', '{deposito,depósito,logistic}', 5),
  ('administracion', 'Administración', '🧾', 'Administracion', 8975944081, '{Administracion}',
   'facturas, cobranzas, pagos y números de cliente', '{admin}', 6)
on conflict (tema) do update set label = excluded.label, emoji = excluded.emoji, creador = excluded.creador,
  creador_tg = excluded.creador_tg, miembros = excluded.miembros, para_que = excluded.para_que,
  claves = excluded.claves, orden = excluded.orden;

-- Pregunta que Ojo lleva de un grupo a otro; respondiendo el mensaje en destino, vuelve al origen.
create table if not exists public.ojo_puente (
  id            bigserial primary key,
  origen_chat   bigint not null,
  origen_msg    bigint not null,
  destino_chat  bigint not null,
  destino_msg   bigint,
  autor         text,
  texto         text,
  respondido_at timestamptz,
  creado_at     timestamptz not null default now()
);
create index if not exists ojo_puente_destino on public.ojo_puente (destino_chat, destino_msg);
alter table public.ojo_puente enable row level security;

-- Grupo del tema; si todavía no se creó, el grupo general (el que recibe avisos).
create or replace function public.ojo_chat_tema(p_tema text) returns bigint
language sql stable as $$
  select coalesce(
    (select chat_id from public.ojo_temas where tema = p_tema),
    (select telegram_chat_id from public.ojo_grupos where recibe_avisos and activo limit 1),
    -5504692394)
$$;

-- Tema de una derivación (🆘): postventa / administración / consumidor final / ventas.
create or replace function public.ojo_tema_derivacion(p_derivacion uuid) returns text
language sql stable as $$
  select case
    when d.motivo in ('postventa_repuesto','reclamo_excepcion','entrega','envio_incidencia','postventa_garantia') then 'postventa'
    when d.motivo = 'pagos_cobranza' then 'administracion'
    when k.tipo_cliente = 'minorista' then 'consumidor'
    else 'ventas' end
  from public.derivaciones d
  left join public.at_conversaciones c on c.id = d.conversacion_id
  left join public.contactos k on k.id = c.contacto_id
  where d.id = p_derivacion
$$;

-- Los grupos y pendientes aceptan los temas nuevos.
alter table public.ojo_grupos drop constraint if exists ojo_grupos_tipo_check;
alter table public.ojo_grupos add constraint ojo_grupos_tipo_check check (tipo = any (array[
  'ventas','administracion','produccion','gerencia','deposito','finanzas','general','prospeccion','consumidor','postventa']));
alter table public.ojo_pendientes drop constraint if exists ojo_pendientes_grupo_origen_check;
alter table public.ojo_pendientes add constraint ojo_pendientes_grupo_origen_check check (grupo_origen = any (array[
  'ventas','administracion','produccion','gerencia','deposito','finanzas','general','prospeccion','consumidor','postventa']));
