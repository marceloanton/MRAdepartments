# Roadmap V2: MRAnalytics Departments

## Estado de salida V1 (base para arrancar V2)
- PWA operativa mobile + desktop.
- Gestión de unidades, tickets, tareas, reservas y evidencias activa.
- Gestión masiva de departamentos activa.
- Riesgo de check-in + tablero de tiempos activos.
- Centro de ayuda operativo para equipos.

## Cierre V1 obligatorio antes de abrir V2
- Confirmaciones UX consistentes para todas las acciones críticas.
- Editor de reservas en modal/sheet controlado (sin fricción por scroll).
- Validación dura de cierre operativo (checklist + evidencia requerida).
- Feedback por acción con estados `guardando/eliminando/actualizando`.
- QA mobile (Android/iPhone) y desktop (notebook/monitor) con capturas finales.

## Objetivo
Escalar de operación interna v1 a operación multi-cliente más automatizada, con mejor experiencia móvil, integración de fuentes externas y activación controlada de subagentes IA.

## Principios
- Mantener costo controlado y activar capacidades pagas sólo con retorno claro.
- No romper trazabilidad: toda automatización debe dejar auditoría.
- Mobile-first real: tareas críticas resolubles en menos de 3 toques.

## Fase 1: Endurecimiento productivo (2-4 semanas)
- RLS completa en Supabase por `tenant_id` y rol.
- Políticas de Storage para evidencia (lectura/escritura granular).
- Alertas operativas con retries y observabilidad base.
- Catálogo configurable de categorías/SLAs por tenant.
- Auditoría de acciones críticas con reason-code obligatorio.

## Fase 2: Integraciones operativas (3-6 semanas)
- Ingesta de reservas por conectores (PMS/channel manager) como fuente canónica.
- Sincronización incremental y reconciliación con conflictos.
- Webhooks para cambios de reservas en tiempo real.
- Mapa por zona para despacho (limpieza/mantenimiento).
- Estado de sincronización visible por reserva/unidad.

## Fase 3: IA asistida con aprobación humana (3-6 semanas)
- Activar `TriageAgent`, `DispatchAgent`, `SLAAgent`, `CommsAgent`, `ReviewAgent`.
- Bandeja de sugerencias con aceptar/rechazar.
- Medir precisión por agente y tasa de aceptación.
- Auditoría obligatoria en `agent_action_log`.

## Fase 4: Experiencia de usuario avanzada (2-4 semanas)
- PWA offline más robusta (colas por módulo + reintentos inteligentes).
- Notificaciones push web (con fallback email).
- Timeline por unidad y replay de incidentes.
- Plantillas de respuesta por tipo de incidencia.
- Modo “Operación rápida” con acciones de 1-2 toques para guardias.

## Fase 5: Inteligencia de negocio (2-4 semanas)
- KPIs por tenant: ocupación, tiempo de resolución, cumplimiento SLA, costo por incidencia.
- Forecast operativo de picos (check-ins/check-outs).
- Reportes programados por email/export.

## Entregables clave V2
- Seguridad multi-tenant completa.
- Integración reservas en tiempo real.
- IA asistiva auditada (no autónoma total).
- UX móvil optimizada para operación de campo.

## Riesgos
- Dependencia de calidad de datos externos.
- Complejidad de reglas por tenant.
- Sobrecarga de notificaciones sin estrategia de prioridad.

## Criterios de éxito
- Reducción >=30% en tickets vencidos.
- Reducción >=20% en tiempo medio de resolución.
- Cumplimiento SLA >=90% en tickets críticos.
- Adopción móvil diaria por equipos operativos.
- Menos de 2% de errores por acción crítica (eliminación/cierre/masivo).
