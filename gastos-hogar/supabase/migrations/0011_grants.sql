-- =============================================================================
-- 0011 · GRANTs a los roles de Supabase
-- -----------------------------------------------------------------------------
-- En Supabase hosted, los roles anon/authenticated/service_role reciben estos
-- privilegios por "default privileges" y esta migración es redundante (pero
-- inofensiva). Se incluye para que el esquema sea auto-contenido y funcione
-- igual en Postgres local / self-hosted, donde esos defaults no existen.
--
-- IMPORTANTE: el privilegio de tabla NO es la frontera de seguridad — lo es RLS.
-- Con RLS habilitada y sin política de escritura, un INSERT/UPDATE/DELETE queda
-- denegado aunque el rol tenga el GRANT. Las tablas de referencia globales
-- (merchants, products, market_prices, promotions, inflation_index) solo tienen
-- política de SELECT, así que para authenticated quedan de facto de solo lectura.
-- service_role bypassa RLS (lo usa la ingesta/pipeline).
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Que también aplique a los objetos que se creen a futuro en public.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
