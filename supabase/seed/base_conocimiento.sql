-- ============================================================================
-- Seed de base_conocimiento — Fase 1
-- Respuestas curadas por intención. segmentos_permitidos define QUIÉN las ve
-- (el filtro se aplica en el WHERE SQL). Idempotente: sólo inserta si la tabla
-- está vacía, para no pisar ediciones posteriores del panel (Fase 5).
--
-- Tono: español rioplatense, voseo, cercano. Sin precios (esos son datos vivos).
-- ⚠️ horarios y direccion quedan activa=false hasta cargar los datos reales.
-- ============================================================================

insert into base_conocimiento (intencion, pregunta, respuesta, segmentos_permitidos, activa, prioridad)
select v.intencion, v.pregunta, v.respuesta, v.segmentos::text[], v.activa, v.prioridad
from (values

  -- ---- Accesibles a todos --------------------------------------------------
  ('catalogo_modelos',
   '¿Qué modelos tienen?',
   E'La colección 2026 son cuatro modelos:\n\n• ASCARI\n• CIVIC CENTER\n• CASA BLANCA\n• 5TH AVENUE\n\nTodos con armazón XYLON® y lentes con tecnología VSL™ HD Real. ¿Querés que te cuente de alguno en particular?',
   array['b2b_activo','b2b_inactivo','b2c'], true, 100),

  ('tecnologia_lentes',
   '¿Qué tecnología tienen los lentes?',
   E'Los Orbital vienen con lentes VSL™ HD Real, que suman:\n\n• UV400 (bloqueo total de rayos UV)\n• Blue Light Cut a 420nm (filtra la luz azul de pantallas)\n• Filtro infrarrojo\n\nArmazón XYLON®, liviano y resistente. Visión nítida y ojos protegidos.',
   array['b2b_activo','b2b_inactivo','b2c'], true, 100),

  ('cuidado_producto',
   '¿Cómo limpio los anteojos?',
   E'Fácil: limpialos con el paño de microfibra que viene en el estuche, siempre con la lente apenas húmeda. Nada de remeras ni papel, que rayan. Y cuando no los uses, guardalos en el estuche. Así te duran como el primer día.',
   array['b2b_activo','b2b_inactivo','b2c'], true, 100),

  ('garantia',
   '¿Qué garantía tienen?',
   E'Todos los Orbital tienen garantía por defectos de fabricación. Si algo viene fallado de fábrica, lo cambiamos. Si se te rompió o querés gestionar una garantía puntual, decímelo y te paso con alguien del equipo.',
   array['b2b_activo','b2b_inactivo','b2c'], true, 100),

  ('redes_contacto',
   '¿Tienen Instagram?',
   E'Sí, seguinos en Instagram: @orbital.eyewear. Ahí subimos la colección, novedades y todo lo nuevo de la marca.',
   array['b2b_activo','b2b_inactivo','b2c'], true, 100),

  -- ---- Sólo b2c ------------------------------------------------------------
  ('donde_comprar',
   '¿Dónde consigo Orbital?',
   E'Orbital se vende en ópticas de todo el país. Pasame tu localidad y te digo qué óptica cerca tuyo tiene la colección 2026.',
   array['b2c'], true, 100),

  ('como_ser_cliente',
   'Quiero sumar Orbital a mi óptica (prospecto)',
   E'¡Buenísimo que quieras trabajar con Orbital! Contame el nombre de tu óptica y de dónde sos, y en un rato te contacta alguien del equipo para darte todos los detalles.',
   array['b2c'], true, 90),

  -- ---- Sólo B2B ------------------------------------------------------------
  ('como_ser_cliente',
   '¿Cómo hago para vender Orbital?',
   E'Sumar Orbital a tu óptica es simple: trabajamos con ópticas independientes en todo el país. Decime de dónde sos y qué óptica tenés, y tu vendedor de zona te arma la propuesta de ingreso con todo lo que necesitás para arrancar.',
   array['b2b_activo','b2b_inactivo'], true, 100),

  ('condiciones_generales',
   '¿Cómo son las condiciones de pago?',
   E'Manejamos distintas condiciones de pago y entrega según el volumen y la zona. Lo mejor es que tu vendedor te arme la propuesta que más te convenga. ¿Querés que te pase con él?',
   array['b2b_activo','b2b_inactivo'], true, 100),

  ('propuestas_comerciales',
   '¿Qué propuestas comerciales tienen? / ¿Qué es el Plan Canje?',
   E'Tenemos cinco propuestas según tu momento:\n\n• Bienvenida — para arrancar con la marca\n• Preventa Colección 2026 — asegurás la nueva colección\n• Plan Canje — entregás stock viejo y renovás\n• Propuesta Especial — condiciones a medida\n• Propuesta para Recuperar — para volver a trabajar juntos\n\n¿Sobre cuál querés que te cuente más?',
   array['b2b_activo','b2b_inactivo'], true, 100),

  ('zona_vendedor',
   '¿Quién me atiende en mi zona?',
   E'Pasame tu localidad o provincia y te digo quién te atiende del equipo (Adrián o Martín) para que se ponga en contacto con vos.',
   array['b2b_activo','b2b_inactivo'], true, 100),

  -- ---- Sólo b2b_activo -----------------------------------------------------
  ('preventa',
   '¿Cómo entro a la preventa 2026?',
   E'La Preventa Colección 2026 te deja asegurar los nuevos modelos antes que salgan a la venta general, con condiciones especiales. Te paso con tu vendedor para que te reserve el pedido. ¿Avanzamos?',
   array['b2b_activo'], true, 100),

  -- ---- Placeholders (completar datos reales y activar) ---------------------
  ('horarios',
   '¿Cuál es el horario de atención?',
   E'[COMPLETAR: horario de atención real de Orbital]',
   array['b2b_activo','b2b_inactivo','b2c'], false, 100),

  ('direccion',
   '¿Dónde están ubicados?',
   E'[COMPLETAR: dirección / showroom real de Orbital]',
   array['b2b_activo','b2b_inactivo','b2c'], false, 100)

) as v(intencion, pregunta, respuesta, segmentos, activa, prioridad)
where not exists (select 1 from base_conocimiento);
