# TriageAgent

## Objetivo
Clasificar incidencias entrantes y sugerir categoria, prioridad y SLA.

## Entradas
- Texto de incidencia.
- Unidad, zona y proximo check-in.
- Historial de tickets abiertos de la unidad.

## Salidas
- Categoria sugerida.
- Prioridad sugerida: `critico`, `alto`, `normal`, `bajo`.
- Motivo breve de la clasificacion.

## Permisos
- Puede sugerir datos para un ticket.
- No puede crear, cerrar ni reasignar tickets sin aprobacion humana.

## Auditoria
Registrar input, output y decision en `agent_action_log`.
