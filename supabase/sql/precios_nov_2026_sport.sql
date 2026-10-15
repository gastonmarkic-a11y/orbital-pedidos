-- Sport (deportivos) desde el 01/11/2026: ajuste pedido por Gastón el 15/10/2026 (reemplaza 46.154 / 120.000 / 37.778 / 102.000).
--  · Óptica 40.385 (distribuidor = óptica ÷ 1,41 = 28.642) · Público 105.000 · Tachado 180.000
--  · GAFAS LUXURY (Paesani, 031022): precio de compra 32.963 · precio público de referencia 89.000
-- Solo toca lo programado (aplicado_at nulo): el 01/11 lo aplican aplicar_precios_programados() (stock + Paesani)
-- y precios-web-programados (Shopify → precios_publicos → IRIS / Mercado Libre). catalogo_precios_nov() ya muestra el
-- precio nuevo en el catálogo apenas corre esto.

update public.precio_programado
   set precio_optica = 40385, precio_publico = 105000, tachado = 180000,
       paesani_precio = 32963, paesani_pvp = 89000
 where escala = 'Sport' and aplicado_at is null
   and modelo in ('ADRENALINE','CRYSTAL','ENDOR','HIGH PERFORMANCE','QUARTZ','SIGNATURE','SUBZERO','SUBZERO NEW',
                  'SUZUKA','VELOCITY','ZERO','ZETA 1','ZETA 1 PRO','ZETA 11','ZETA 2','ZETA 3','ZETA 4','ZETA 7',
                  'ZETA 8','ZETA 9','ZZR');
