-- ============================================================================
-- Protección del sistema · 07/10/2026
-- El rol anon (la clave pública que viaja en el sitio) deja de ver tablas y
-- vistas, y solo ejecuta las funciones que usan las páginas públicas
-- (catálogo, consigna, colab, pretest/Vision Lab, landings, cobro público, ZN).
--
-- Por qué: hoy cualquiera con la clave pública puede leer, modificar y borrar
-- pedidos, stock, consignación y leads (políticas "permitir todo" para public),
-- y ejecutar ~540 funciones internas. Eso permite copiar datos y estructura.
--
-- Lista de funciones públicas: lo que el frontend llama sin sesión (código en
-- src/ y public/) cruzado con 7 días de registros de la API (30/09 → 07/10).
-- Las Edge Functions usan la clave secreta (service_role) y no se ven afectadas.
-- Los usuarios con sesión (authenticated) conservan exactamente sus permisos.
--
-- Respaldo de los permisos previos: respaldo.acl_20261007 (ya creado).
-- Para volver atrás: 2026-10-07_anon_minimo_privilegio_ROLLBACK.sql
--
-- IMPORTANTE para funciones nuevas que deban ser públicas: desde este cambio,
-- una función nueva NO queda abierta a anon. Hay que agregar a mano:
--   grant execute on function public.<nombre>(<args>) to anon;
-- ============================================================================

-- 1) Tablas, vistas y secuencias: anon sin acceso directo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- 2) Funciones: authenticated y service_role conservan lo que tenían;
--    anon/PUBLIC pierden ejecución salvo la lista de funciones públicas.
do $$
declare
  r record;
  had_anon boolean;
  publicas text[] := array['ar_modelos_catalogo','catalogo_autoacceso','catalogo_bono_estado','catalogo_buscar_clientes','catalogo_carrito_guardar','catalogo_carrito_recuperar','catalogo_chat_escuchar','catalogo_checkout','catalogo_cod','catalogo_dispositivo_ok','catalogo_entrar','catalogo_ficha_tienda','catalogo_home','catalogo_inspiracion','catalogo_medidas','catalogo_mis_compras','catalogo_mis_modelos','catalogo_mis_modelos_baja','catalogo_modelo_v2','catalogo_pagar','catalogo_postventa_crear','catalogo_postventa_lista','catalogo_pretest_actualizar','catalogo_pretests','catalogo_publicacion_crear','catalogo_publicaciones','catalogo_sesion_ping','catalogo_usa_checkout','catalogo_usa_home','catalogo_usa_login','catalogo_usa_medidas','cobro_comprobante','cobro_cuentas','cobro_publico','colab_admin_guardar','colab_admin_influencers','colab_catalogo','colab_coleccion_marcar','colab_coleccion_opciones','colab_coleccion_rechazar','colab_crear_link','colab_entrar','colab_inspiracion_lista','colab_link_editar','colab_link_eliminar','colab_link_video','colab_links_todos','colab_liquidacion','colab_mis_links','colab_modelos_stock','colab_orbital_admins','colab_orbital_guardar_admin','colab_orbital_propuestas','colab_origenes','colab_resumen','consigna_accesos','consigna_catalogo','consigna_central','consigna_chat','consigna_consulta_estado','consigna_consultas','consigna_devolucion_central','consigna_dispositivo_ok','consigna_envios','consigna_exhibicion','consigna_exhibicion_guardar','consigna_exhibidores','consigna_lista_precios','consigna_pedido_crear','consigna_pedido_resolver','consigna_postventa_crear','consigna_postventa_lista','consigna_recibir_envio','consigna_transferir','consigna_ventas','current_is_admin','current_vendedor_codigo','current_vendedor_rol','donde_probar','es_admin','es_admin_o_tienda','es_financiero','gastos_puede_ver','ig_infl_equipo','ig_infl_listar','ig_infl_marcar','ig_infl_resumen','ig_infl_tomar','link_vendedor_on_login','modelo_landing','oftalmo_derivar','oftalmologos_cercanos','opticas_cercanas','opticas_con_modelo','pretest_actualizar','pretest_codigo_vigente','pretest_extras','pretest_guardar','pretest_marcos','pretest_obra_social','pretest_red','proteccion_destacados','region_de','registrar_visita_landing','rostro_medidas','vendedor_del_token','zn_clave_ok','zn_colab_clave','zn_guardar','zn_home','zn_marcar','zn_resumen','zn_rol'];
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind in ('f','p')
      and pg_get_userbyid(p.proowner) = current_user
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    had_anon := has_function_privilege('anon', r.oid, 'execute');
    if has_function_privilege('authenticated', r.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if has_function_privilege('service_role', r.oid, 'execute') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    if had_anon and r.proname = any(publicas) then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
  end loop;
end $$;

-- 3) Vistas que ignoran RLS (security definer) y no usa la app: solo Edge Functions (service_role).
do $$
declare v text;
begin
  foreach v in array array['ojo_v_respuestas_tanda','ojo_v_derivaciones','ojo_v_tanda_hoy','ojo_v_catalogo_carritos','ojo_v_catalogo_visitas','colab_venta_origen','_v_adrian_detalle','v_trazabilidad_cliente','zn_universo','v_interaccion_contacto','mv_embudo_b2b','v_embudo_b2b','colab_venta_ef','colab_coleccion_venta','v_ruta_dia','stock_reservado_deposito','v_cartera_valores','v_cartera_kpis','v_visitas_checkin'] loop
    if to_regclass('public.'||quote_ident(v)) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end $$;
