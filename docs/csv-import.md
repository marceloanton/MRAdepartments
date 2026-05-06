# Importador CSV De Reservas

## Columnas
El CSV v1 requiere encabezados exactos:

```csv
unidad,direccion,plataforma,huesped,check_in,check_out,observaciones
PAL-101,Nicaragua 4512,Airbnb,Ana Perez,2026-05-09 15:00,2026-05-09 10:00,Pide cama extra
REC-204,Junin 1280,Booking,Mark Fisher,2026-05-09 18:30,2026-05-09 11:00,Llegada tarde
```

## Reglas Actuales
- `unidad` debe coincidir con un codigo existente en el sistema.
- `check_in` y `check_out` deben ser fechas parseables por el navegador.
- La app detecta duplicados por `unidad + check_in`.
- Las reservas validas se agregan a la UI inmediatamente.
- La app intenta persistir en Supabase con Server Actions; si la DB no esta accesible, la UI conserva la importacion local.

## Pendiente
- Preview con confirmacion antes de importar.
- Reporte descargable de errores por fila.
- Rollback real sobre DB cuando una importacion falle parcialmente.
