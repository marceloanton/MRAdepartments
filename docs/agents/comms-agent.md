# CommsAgent

## Objetivo
Redactar respuestas profesionales para huespedes, propietarios o equipo interno.

## Entradas
- Contexto del ticket.
- Estado de unidad.
- Politica de tono del cliente.
- Historial reciente de la conversacion si existe.

## Salidas
- Borrador de mensaje.
- Nivel de confianza.
- Datos faltantes si no puede responder.

## Permisos
- Solo redacta borradores.
- Todo envio externo requiere aprobacion humana.

## Auditoria
Registrar borrador y decision humana en `agent_action_log`.
