# Deploy: GitHub + Vercel

## 1. Preparar repo local
```bash
npm install
npm run lint
npm run test
npm run build
```

## 2. Publicar en GitHub
1. Crear repo nuevo (público o privado).
2. Subir código (sin `.env.local`).
3. Verificar que `.gitignore` excluya secretos.

## 3. Conectar en Vercel
1. Importar el repo desde Vercel.
2. Framework detectado: `Next.js`.
3. Build command: `npm run build`.
4. Output: automático para Next.js.

## 4. Variables de entorno en Vercel
Configurar mínimo:
- `AUTH_SECRET`
- `AUTH_URL` (URL pública del deploy)
- `DEFAULT_TENANT_SLUG`
- `DEFAULT_TENANT_NAME`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` o `SUPABASE_DB_POOLER_URL`

Opcionales:
- `CRON_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## 5. DB y migraciones
Ejecutar migraciones antes o durante cutover:
```bash
npm run db:push
npm run db:seed:auth
npm run db:seed
```

## 6. Cron en Vercel
El proyecto incluye:
- `/api/cron/sla`
- `/api/cron/notifications`

Si usás `CRON_SECRET`, enviar header:
`Authorization: Bearer <CRON_SECRET>`

## 7. Checklist post-deploy
- Login OK por rol.
- Badge `DB online`.
- Crear/editar unidad.
- Crear ticket/tarea.
- Importar reservas CSV.
- Subir evidencia.
- Probar SLA + notificaciones.

## 8. Rollback
- Mantener último deploy estable en Vercel.
- Si falla, promover deploy anterior.
- No ejecutar migraciones destructivas sin backup.
