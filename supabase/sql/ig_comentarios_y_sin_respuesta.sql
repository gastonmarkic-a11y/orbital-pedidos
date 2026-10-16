-- Comentarios de Instagram (publicaciones y anuncios) y charlas que IRIS no contestó → grupo Ojo Consumidor Final.
-- 2026-10-16. Meta no manda los comentarios al webhook mientras la app no esté aprobada: ig-comentarios
-- los va a buscar por API cada 5 min y ojo-sin-respuesta avisa las charlas donde el cliente quedó hablando solo.

create table if not exists public.ig_comentarios (
  comment_id text primary key,
  media_id text not null,
  origen text not null check (origen in ('anuncio', 'publicacion')),
  titulo text,
  permalink text,
  texto text not null,
  username text,
  comentado_en timestamptz,
  consulta boolean not null default false,
  privado_ok boolean not null default false,
  publico_ok boolean not null default false,
  detalle text,
  conversacion_id uuid,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  respondido_por text,
  respondido_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists ig_comentarios_tg on public.ig_comentarios (telegram_chat_id, telegram_message_id);
alter table public.ig_comentarios enable row level security;

-- Cuántos comentarios tenía cada publicación la última vez: solo se baja la lista de las que cambiaron.
create table if not exists public.ig_media_estado (
  media_id text primary key,
  comments_count int not null default 0,
  actualizado_en timestamptz not null default now()
);
alter table public.ig_media_estado enable row level security;

create table if not exists public.ojo_sin_respuesta_aviso (
  mensaje_id uuid primary key,
  conversacion_id uuid not null,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  creado_en timestamptz not null default now()
);
alter table public.ojo_sin_respuesta_aviso enable row level security;

-- Charlas de consumidores donde el último mensaje es del cliente y nadie contestó entre p_min minutos y p_horas horas.
-- Las derivadas no: esas ya tienen su 🆘 y la escalada de ojo-escalar.
create or replace function public.ojo_conversaciones_sin_respuesta(p_min int default 4, p_horas int default 12)
returns table (conversacion_id uuid, canal text, estado text, contacto text, mensaje_id uuid, contenido text, enviado_en timestamptz)
language sql stable security definer set search_path = public as $$
  with ult as (
    select distinct on (m.conversacion_id) m.conversacion_id, m.id, m.emisor, m.contenido, m.created_at
    from at_mensajes m
    where m.created_at > now() - make_interval(hours => p_horas + 1)
    order by m.conversacion_id, m.created_at desc
  )
  select c.id, c.canal_origen, c.estado,
         coalesce(nullif(ct.nombre, ''), ct.telefono, 'sin nombre'),
         u.id, u.contenido, u.created_at
  from ult u
  join at_conversaciones c on c.id = u.conversacion_id
  left join contactos ct on ct.id = c.contacto_id
  where u.emisor = 'cliente'
    and c.estado in ('bot_activo', 'resuelta')
    and u.created_at between now() - make_interval(hours => p_horas) and now() - make_interval(mins => p_min)
    and ct.cod_cliente is null
    and coalesce(ct.tipo_cliente, '') <> 'mayorista'
    and u.contenido !~* '^\s*(muchas\s+)?(gracias|grac|ok|oka?y?|dale|listo|genial|perfecto|buen[ií]simo|b[aá]rbaro|joya|chau|saludos|👍|🙏|❤️|😊|🙌)[\s!.¡]*$'
    and not exists (select 1 from ojo_sin_respuesta_aviso a where a.mensaje_id = u.id)
  order by u.created_at;
$$;
revoke all on function public.ojo_conversaciones_sin_respuesta(int, int) from public, anon, authenticated;

-- Crons (aplicados 16/10): barrido de comentarios y aviso de charlas sin respuesta, cada 5 min.
select cron.schedule('ig-comentarios-barrer', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ig-comentarios',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select valor from app_config where clave = 'cron_key')),
    body := '{"accion":"barrer"}'::jsonb, timeout_milliseconds := 120000);
$$);
select cron.schedule('ojo-sin-respuesta', '2-59/5 * * * *', $$
  select net.http_post(
    url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-sin-respuesta',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select valor from app_config where clave = 'cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
