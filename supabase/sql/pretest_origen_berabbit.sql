-- beRabbit Vision Lab (2026-10-09): los chequeos hechos en /berabbit/lab llegan con origen 'berabbit'.
-- Sin este cambio pretest_guardar los guarda como 'web'. Solo se agrega 'berabbit' a la lista de orígenes válidos.
do $$
declare d text;
begin
  select pg_get_functiondef('public.pretest_guardar(jsonb)'::regprocedure) into d;
  d := replace(d, $q$not in ('web','tienda','qr','suite')$q$, $q$not in ('web','tienda','qr','suite','berabbit')$q$);
  execute d;
end $$;
