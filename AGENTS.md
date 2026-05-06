# Proyecto: MRAnalytics Departments

## Comportamiento De Codex
- Priorizar costo operativo 0 en v1. No agregar servicios pagos, APIs pagas ni IA con costo sin aprobacion explicita.
- Construir mobile-first para Android/iPhone como PWA responsive. La app nativa queda fuera de v1.
- La primera version es interna: admin, supervisor, limpieza y mantenimiento. No crear portal de huesped salvo pedido explicito.
- Reservas v1: CSV/manual. Futuro: PMS/channel manager como fuente canonica; evitar integrar canales uno por uno.
- IA/subagentes: preparar contratos, permisos y auditoria, pero no ejecutar automatizaciones de IA en v1.
- Mantener multi-tenant desde el modelo de datos aunque haya un solo cliente piloto.
- Proteger trazabilidad: cada cierre operativo debe conservar responsable, timestamps y evidencia/link cuando aplique.

## Stack Permitido V1
- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, lucide-react.
- Auth.js, Drizzle ORM, Supabase Postgres/Storage, Nodemailer, Papa Parse, Zod.
- Tests/lint/build locales con npm. Deploy objetivo: Vercel free.

## Reglas De Producto
- La pantalla inicial debe ser una herramienta utilizable, no una landing.
- Los estados de unidad validos son: `pendiente_limpieza`, `en_limpieza`, `mantenimiento`, `inspeccion`, `lista`, `bloqueada`.
- Las prioridades validas son: `critico`, `alto`, `normal`, `bajo`.
- Las notificaciones v1 son in-app + email fallback. Web Push queda documentado para fase posterior.
