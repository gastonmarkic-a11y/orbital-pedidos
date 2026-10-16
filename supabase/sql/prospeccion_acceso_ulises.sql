-- Ulises ve y trabaja el pool de Prospección (vendedor_asignado = 'Marketing' / 'ProspeccionVenta' / sin dueño),
-- igual que Luna (Marketing) y Damián. Administración ya lo ve por su rol.
-- No se le da DELETE: solo ver y actualizar.

alter policy "vendedor ve su cartera" on clientes using (
  current_is_admin()
  OR (current_vendedor_rol() = ANY (ARRAY['administracion'::text, 'deposito'::text, 'logistica'::text]))
  OR (vendedor_asignado = current_vendedor_codigo())
  OR ((current_vendedor_codigo() = ANY (ARRAY['Marketing'::text, 'Damian'::text, 'Ulises'::text]))
      AND ((vendedor_asignado = ANY (ARRAY['Marketing'::text, 'ProspeccionVenta'::text])) OR (vendedor_asignado IS NULL)))
);

alter policy "vendedor actualiza su cartera" on clientes using (
  current_is_admin()
  OR (current_vendedor_rol() = 'administracion'::text)
  OR (vendedor_asignado = current_vendedor_codigo())
  OR ((current_vendedor_codigo() = ANY (ARRAY['Marketing'::text, 'Damian'::text, 'Ulises'::text]))
      AND ((vendedor_asignado = ANY (ARRAY['Marketing'::text, 'ProspeccionVenta'::text])) OR (vendedor_asignado IS NULL)))
);
