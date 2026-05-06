# Manual de Operación (V1)

## 1. Objetivo
Operar departamentos con foco en check-in/check-out, limpieza, mantenimiento, evidencia y cumplimiento SLA.

## 2. Roles
- `admin`: acceso total.
- `supervisor`: coordina, despacha, escala, cierra bloqueadores.
- `limpieza`: ejecuta tareas de limpieza y evidencia.
- `mantenimiento`: ejecuta incidencias/tareas técnicas.

## 3. Flujo diario recomendado
1. `Reservas`: validar próximas 24h.
2. `Kanban`: mover unidades por estado.
3. `Riesgo`: resolver score alto y críticos.
4. `SLA`: vaciar vencidos y pre-escalar <=8h.
5. `Operación`: cierre con checklist + evidencia.
6. `Go-Live`: confirmar readiness de salida.

## 4. Módulos principales
- `Operación`: detalle por unidad, tickets, tareas y evidencia.
- `Kanban`: tablero por estado de unidad.
- `Riesgo`: priorización de check-in con score y acciones masivas.
- `Reservas`: carga manual/CSV + calendario operativo diario.
- `SLA`: vencidos y cola de escalamiento.
- `Ayuda`: guía de uso in-app.

## 5. Módulos avanzados
- `Departamentos`: gestión masiva (filtros, orden, bulk updates).
- `Tareas`: estado por equipo.
- `Ejecutivo`: KPIs de operación.
- `Go-Live`: checklist de salida.
- `Control`: timeline unificada.
- `Agentes`: registro de sugerencias (sin IA autónoma activa en v1).

## 6. Estados válidos
### Unidad
- `pendiente_limpieza`
- `en_limpieza`
- `mantenimiento`
- `inspeccion`
- `lista`
- `bloqueada`

### Prioridad
- `critico`
- `alto`
- `normal`
- `bajo`

## 7. Checklist de cierre por unidad
- Fotos antes/después (si aplica).
- Limpieza validada.
- Mantenimiento sin bloqueos.
- Unidad marcada `lista`.
- Notas de cierre y responsable.

## 8. Protocolo de incidencias
- `Crítico`: atender primero, escalamiento supervisor inmediato.
- `Alto`: resolver dentro de ventana operativa del día.
- `Normal/Bajo`: planificar por carga y disponibilidad.

## 9. Trabajo offline
- Si la DB cae, la app entra en modo local/mock.
- Las acciones se encolan localmente.
- Al volver la red/DB, usar `Sincronizar pendientes`.

## 10. Errores comunes
- No login: revisar `.env.local` y seeds de auth.
- `DB local` permanente: usar `SUPABASE_DB_POOLER_URL`.
- Menú no visible en mobile: usar botón `Más`.
- Sin datos en reservas: revisar formato CSV.
