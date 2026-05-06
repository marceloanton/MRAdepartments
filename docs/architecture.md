# Arquitectura

## Decision Base
- Frontend/backend: Next.js App Router con TypeScript.
- UI: Tailwind CSS, shadcn/ui y lucide-react.
- DB: Supabase Postgres con Drizzle ORM.
- Storage: Supabase Storage para fotos comprimidas, con links externos como fallback.
- Auth: Auth.js, preparado para usuarios por rol.
- Notificaciones: in-app + email con Nodemailer.
- Reservas: CSV/manual ahora; PMS/channel manager despues.

## Multi-Tenant
Todas las tablas principales tienen `tenant_id`. La v1 puede operar con un solo tenant piloto, pero el modelo evita rehacer datos si el producto se vende a otros administradores.

## Flujo Operativo
1. Se importa o carga una reserva.
2. El sistema muestra check-out/check-in y ventana operativa.
3. Supervisor crea/asigna tickets o tareas.
4. Limpieza/mantenimiento actualiza estado desde celular.
5. Se agrega evidencia por foto o link externo.
6. Supervisor inspecciona y marca unidad lista.
7. Eventos generan notificaciones y auditoria.

## Estado Actual De Implementacion
- El dashboard usa estado local en React para simular CRUD de unidades, tickets y tareas.
- Las unidades demo usan direcciones de CABA y fotos fake generadas como SVG inline, sin llamadas externas ni costo.
- El dashboard ya intenta hidratarse desde Drizzle + Supabase y vuelve a mock local si la DB no esta disponible.
- Las altas y cambios de estado llaman Server Actions; si Supabase no responde, la UI mantiene el cambio local para desarrollo.
- `.env.local` contiene credenciales locales y esta excluido por `.gitignore`.
- `npm run db:seed` carga el tenant `mranalytics_departments` con datos CABA cuando la conexion Postgres este accesible.
- La UI permite agregar evidencia con camara/archivo, comprime la imagen en navegador y la guarda como preview local si Supabase Storage no esta disponible.
- La app intenta subir fotos al bucket `evidence` de Supabase Storage y registrar metadata en la tabla `evidence`.
- Las Server Actions validan `actorUserId` contra `app_users` y aplican ACL por rol (`admin`, `supervisor`, `limpieza`, `mantenimiento`) para mutaciones operativas.
- La app usa Auth.js (credentials) contra `app_users` activos del tenant y las Server Actions resuelven actor desde sesion autenticada.

## Conexion Supabase
- URL publica configurada para Supabase JS.
- `DATABASE_URL` configurada en `.env.local` con password URL-encoded.
- Desde este entorno la conexion directa de Postgres resuelve solo IPv6, por lo que `db:push` puede fallar si la red local no soporta IPv6.
- Si falla la conexion directa, usar el connection string del pooler de Supabase como `DATABASE_URL`.

## Storage
- Bucket esperado: `evidence`.
- Bucket `evidence` creado en Supabase con limite 5 MB y MIME permitidos (`image/jpeg`, `image/png`, `image/webp`).
- Bucket `evidence` configurado como privado.
- La app persiste `storagePath` en DB, sube archivos por Server Action (service role) y genera URL firmada desde servidor para visualizar fotos.
- Requiere `SUPABASE_SERVICE_ROLE_KEY` en entorno para firmar URLs en runtime.
- Fase posterior: aplicar autenticacion estricta y politicas RLS por tenant/rol para uploads y lectura.

## Notificaciones
Los eventos crean elementos en una cola/log de notificaciones. V1 muestra avisos in-app y permite email fallback. Web Push se deja para una fase posterior porque requiere permisos, soporte de navegador y mas QA mobile.

## Estado Actual De Notificaciones
- La UI tiene tab `Avisos` con bandeja in-app, conteo de no leidos y marcado manual como leido.
- Crear unidad, ticket, tarea, resolver ticket, marcar unidad lista y cargar evidencia generan avisos locales.
- Las mismas acciones intentan persistir evento + notificacion con `createOperationalNotificationAction` si Postgres esta accesible.
- El estado `read` se persiste en DB (`notifications.read`) y se sincroniza desde acciones server.
- Se aplica deduplicacion persistente por `event_key` en creacion de notificaciones para evitar duplicados por reintentos.

## SLA Y Cron
- `src/lib/sla.ts` evalua tickets vencidos, tareas vencidas y unidades con check-in cercano en riesgo.
- La tab `Avisos` tiene accion manual `Evaluar SLA` para generar avisos in-app.
- Endpoint preparado para cron: `GET /api/cron/sla`.
- Endpoint preparado para cola email: `GET /api/cron/notifications`.
- `CRON_SECRET` es opcional en local; si se configura, el cron debe enviar `Authorization: Bearer <secret>`.
- `vercel.json` incluye cron de SLA cada 15 min y cron de notifications cada 20 min.
- Deduplicacion persistente por `event_key` implementada en la creacion de notificaciones.

## IA Y Subagentes
La arquitectura incluye `agent_action_log`, pero la v1 no llama modelos ni automatiza decisiones con IA. Los agentes solo pueden sugerir en fase 2 y requieren aprobacion humana para acciones criticas.
