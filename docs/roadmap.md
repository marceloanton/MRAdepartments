# Roadmap: MRAnalytics Departments + Mantenimiento

## Resumen
PWA interna para operar 300+ departamentos desde celular, con costo inicial 0. La v1 cubre tickets, limpieza, mantenimiento, estados de unidad, evidencias, reservas por CSV/manual, notificaciones in-app/email y roles. La IA queda preparada para fase 2.

## Fase 0: Discovery
- Relevar planillas actuales, flujo check-out/check-in, roles y puntos de perdida.
- Confirmar catalogo de incidencias: limpieza, mantenimiento, plomeria, electricidad, cerradura, aire, faltantes, dano, reclamo, check-in.
- Cerrar SLA por prioridad.
- Confirmar CSV minimo: unidad, direccion, plataforma, huesped, check-in, check-out, observaciones.

## Fase 1: Base
- Next.js, TypeScript, Tailwind, shadcn/ui, Auth.js, Drizzle, Supabase Postgres/Storage.
- Multi-tenant basico.
- Roles: admin, supervisor, limpieza, mantenimiento.
- Entidades: unidades, usuarios, tickets, tareas, reservas, evidencias, eventos, notificaciones.
- Estado actual: UI con CRUD local optimista para unidades, tickets y tareas; datos fake de departamentos CABA; imagenes fake inline sin costo.
- Estado actual: Server Actions y loader inicial preparados para Supabase/Drizzle con fallback a mock local.
- Estado actual: migraciones aplicadas en Supabase (`0000_panoramic_leper_queen`, `0001_icy_vanisher`) y seed cargado para `mranalytics_departments`.
- Nota operativa: la conexion Postgres directa puede fallar por DNS local; en ese caso usar MCP de Supabase para migrar/seedear.

## Fase 2: Operacion Mobile
- PWA responsive instalable en Android/iPhone.
- Pantallas: tareas de hoy, unidad, ticket, evidencia, checklist, tablero supervisor.
- Estados de unidad operativos completos.
- Fotos comprimidas en navegador + links externos.
- Estado actual: carga de foto desde camara/archivo, compresion client-side, preview local y asociacion a ticket/unidad.
- Estado actual: bucket `evidence` privado en Supabase, subida de fotos por Server Action y visualizacion con URLs firmadas.
- Estado actual: autenticacion operativa con Auth.js + ACL por rol/tenant en Server Actions y UI restringida por rol.

## Fase 3: Reservas
- Importador CSV/manual.
- Lista diaria de check-outs, check-ins y ventanas operativas.
- Riesgo de check-in por unidad no lista, ticket critico, limpieza pendiente o mantenimiento vencido.
- Preparar futuro con PMS/channel manager.
- Estado actual: importador CSV con preview confirmable, descarga de errores y validaciones (unidad/fecha/duplicados).
- Estado actual: importacion en DB transaccional con rollback completo ante conflicto/duplicado.

## Fase 4: Notificaciones
- Eventos internos para ticket creado/asignado/vencido/resuelto, unidad lista y riesgo de check-in.
- Notificaciones in-app por usuario/rol.
- Email fallback con Nodemailer.
- Cola con deduplicacion y auditoria.
- Estado actual: bandeja `Avisos`, marcado local como leido y generacion de avisos ante acciones operativas principales.
- Estado actual: Server Action para persistir evento + notificacion en Supabase cuando DB este accesible.
- Estado actual: reglas SLA detectan tickets vencidos, tareas vencidas y unidades con check-in cercano en riesgo.
- Estado actual: endpoint `GET /api/cron/sla` preparado para cron con `CRON_SECRET` opcional.
- Estado actual: endpoint `GET /api/cron/notifications` procesa `notifications.pending`, envia email fallback y marca `sent/failed`.
- Estado actual: `vercel.json` define crons para SLA (15m) y notifications (20m).
- Estado actual: `notifications.read` persistente y acciones para marcar uno/todos como leidos.
- Estado actual: deduplicacion persistente por `event_key` en creacion de notificaciones.

## Fase 5: Subagentes
- TriageAgent, DispatchAgent, SLAAgent, CommsAgent y ReviewAgent.
- Sin ejecucion de IA en produccion v1.
- Toda sugerencia debe registrarse en `agent_action_log`.
