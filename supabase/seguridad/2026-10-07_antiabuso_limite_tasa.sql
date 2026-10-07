-- ============================================================================
-- Antiabuso · 07/10/2026
-- Límite de solicitudes anónimas por IP para frenar descargas masivas
-- (scraping del catálogo, ópticas, oftalmólogos, precios).
-- Corre antes de cada pedido a la API (PostgREST db_pre_request).
--
-- Reglas:
--  - Solo cuenta pedidos POST de visitantes sin sesión (rol anon).
--  - Ignora usuarios logueados y la clave secreta (Edge Functions).
--  - Más de 240 pedidos por minuto desde una misma IP → 429 por ese minuto.
--    (El chat del catálogo consulta cada pocos segundos: queda muy por debajo.)
--  - Si la función falla por cualquier motivo propio, deja pasar (nunca corta el servicio).
-- Para desactivar:  alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
-- ============================================================================

create schema if not exists seguridad;
revoke all on schema seguridad from public;
grant usage on schema seguridad to anon, authenticated, service_role;

create unlogged table if not exists seguridad.tasa (
  ip text not null,
  minuto timestamptz not null,
  n int not null default 1,
  primary key (ip, minuto)
);
revoke all on seguridad.tasa from public, anon, authenticated;

-- Registro de IPs bloqueadas (para detectar a quién intentó copiar)
create table if not exists seguridad.bloqueos (
  ip text not null,
  minuto timestamptz not null,
  ruta text,
  user_agent text,
  primary key (ip, minuto)
);
revoke all on seguridad.bloqueos from public, anon, authenticated;

create or replace function seguridad.antiabuso_pre_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  rol text := coalesce(claims->>'role', 'anon');
  metodo text := current_setting('request.method', true);
  hdr json := nullif(current_setting('request.headers', true), '')::json;
  ip text;
  m timestamptz := date_trunc('minute', now());
  cuenta int;
begin
  if rol <> 'anon' or metodo is distinct from 'POST' then return; end if;
  if coalesce(hdr->>'apikey', '') like 'sb_secret_%' then return; end if;

  ip := coalesce(hdr->>'cf-connecting-ip', nullif(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1), ''), 'sin-ip');

  insert into seguridad.tasa as t (ip, minuto, n) values (ip, m, 1)
  on conflict (ip, minuto) do update set n = t.n + 1
  returning t.n into cuenta;

  if cuenta > 240 then
    if cuenta = 241 then
      insert into seguridad.bloqueos (ip, minuto, ruta, user_agent)
      values (ip, m, current_setting('request.path', true), left(hdr->>'user-agent', 300))
      on conflict do nothing;
    end if;
    raise sqlstate 'PGRST' using
      message = json_build_object('code', '429', 'message', 'Demasiadas solicitudes. Probá de nuevo en un minuto.')::text,
      detail  = json_build_object('status', 429, 'headers', json_build_object('Retry-After', '60'))::text;
  end if;
exception
  when sqlstate 'PGRST' then raise;
  when others then return;
end $$;

revoke all on function seguridad.antiabuso_pre_request() from public;
grant execute on function seguridad.antiabuso_pre_request() to anon, authenticated, service_role;

-- Limpieza: borra contadores de más de 1 hora (cada 15 min)
select cron.schedule('seguridad_tasa_limpieza', '*/15 * * * *',
  $$delete from seguridad.tasa where minuto < now() - interval '1 hour'$$);

-- Activación
alter role authenticator set pgrst.db_pre_request = 'seguridad.antiabuso_pre_request';
notify pgrst, 'reload config';
