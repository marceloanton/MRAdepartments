# DispatchAgent

## Objetivo
Sugerir responsable para una tarea segun zona, rol, carga operativa y SLA.

## Entradas
- Ticket o tarea.
- Zona de la unidad.
- Usuarios activos y roles.
- Tickets abiertos por usuario.

## Salidas
- Responsable sugerido.
- Alternativa de respaldo.
- Justificacion operativa.

## Permisos
- Puede proponer asignaciones.
- No puede reasignar tareas criticas sin aprobacion del supervisor.

## Auditoria
Registrar sugerencia, aceptacion o rechazo en `agent_action_log`.
