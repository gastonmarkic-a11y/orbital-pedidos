-- Vuelve atrás 2026-10-07_anon_minimo_privilegio.sql (deja anon como estaba antes:
-- acceso a todas las tablas/funciones, filtrado solo por RLS).
-- Usar solo si algo público dejó de andar y no se puede resolver con un grant puntual:
--   grant execute on function public.<nombre>(<args>) to anon;

grant all on all tables in schema public to anon;
grant all on all sequences in schema public to anon;
grant execute on all functions in schema public to anon;
grant execute on all functions in schema public to public;
grant all on all tables in schema public to authenticated;  -- devuelve las 19 vistas internas
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres in schema public grant execute on functions to public;

-- Permisos exactos previos guardados en: select * from respaldo.acl_20261007;
