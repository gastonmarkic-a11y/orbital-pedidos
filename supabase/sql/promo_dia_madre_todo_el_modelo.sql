-- Día de la Madre (15/10): si un modelo participa, TODOS sus colores van a $48.000 (pedido del usuario:
-- "que ese modelo tenga siempre el mismo precio, 48.000 todos los Palermo... así con todos los que participen").
-- Hasta hoy, 9 modelos tenían apagada la fila de modelo entero (codigo null) y solo algunos colores en promo.
-- Se prende la fila de modelo entero de la lista general (cod_cliente null). Ojo GAFAS LUXURY (031022): la fila
-- general también le aplica (gana el menor), así que sus colores fuera de su promo de $37.778 pasaron de su
-- precio especial $50.000 a $48.000. Sus colores en promo siguen a $37.778.
-- Vuelta atrás: el mismo update con activo = false.
update public.promo_precio
   set activo = true
 where codigo is null and cod_cliente is null and not activo and hasta > now()
   and modelo in ('ATLANTIC CITY','BRERA','BROOKLYN','LOS HAMPTON','PALERMO','PARIS','ROMA','VENICE','WYNWOOD');
