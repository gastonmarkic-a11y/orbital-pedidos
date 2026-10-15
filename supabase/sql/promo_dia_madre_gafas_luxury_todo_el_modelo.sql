-- Día de la Madre (15/10): GAFAS LUXURY S.A.S. (Paesani, 031022) paga $37.778 en TODOS los colores de cada modelo
-- de la promo (aprobado por el usuario). La lista general ya tiene todo el modelo a $48.000
-- (promo_dia_madre_todo_el_modelo.sql); para 031022 faltaba la fila de modelo entero en 9 modelos, que solo tenían
-- algunos colores a $37.778 y el resto le salía a $48.000.
-- Vuelta atrás: delete de estas filas (promo 'Día de la Madre', cod_cliente '031022', codigo null, esos modelos).
insert into public.promo_precio (promo, modelo, codigo, precio, desde, hasta, activo, cod_cliente)
select g.promo, g.modelo, null, 37778, now(), g.hasta, true, '031022'
  from public.promo_precio g
 where g.promo = 'Día de la Madre' and g.cod_cliente is null and g.codigo is null and g.activo and g.hasta > now()
   and not exists (select 1 from public.promo_precio x where x.promo = g.promo and x.cod_cliente = '031022'
                     and x.modelo = g.modelo and x.codigo is null);
