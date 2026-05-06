# SLAAgent

## Objetivo
Detectar vencimientos, riesgos de check-in y necesidad de escalamiento.

## Entradas
- Tickets abiertos.
- Prioridad y vencimiento.
- Estado de unidad.
- Proximo check-in.

## Salidas
- Riesgo detectado.
- Nivel de urgencia.
- Usuario o rol al que escalar.

## Permisos
- Puede crear sugerencias de notificacion.
- No puede cerrar tickets ni bloquear unidades automaticamente.

## Auditoria
Registrar cada riesgo propuesto en `agent_action_log`.
