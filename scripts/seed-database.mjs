import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    process.env[key] ??= valueParts.join("=");
  }
}

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Create .env.local first.");
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const unitCount = Number.parseInt(process.env.DEMO_UNITS_COUNT ?? "60", 10);
const safeUnitCount = Number.isFinite(unitCount) && unitCount > 0 ? Math.min(unitCount, 2000) : 60;
const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "mranalytics_departments";
const tenantName = process.env.DEFAULT_TENANT_NAME ?? "MRAnalytics Departments";

const ZONES = ["Palermo", "Recoleta", "San Nicolas", "Belgrano", "San Telmo", "Caballito", "Almagro", "Villa Crespo"];
const STREETS = [
  "Nicaragua",
  "Junin",
  "Av. Corrientes",
  "Mendoza",
  "Defensa",
  "Pedro Goyena",
  "Av. Santa Fe",
  "Armenia",
  "Honduras",
  "Scalabrini Ortiz",
  "Rivadavia",
  "Av. Cordoba",
];
const OWNERS = [
  "Fideicomiso Norte",
  "Lopez Propiedades",
  "BA Rentals",
  "Rios Group",
  "Puerto Chico",
  "Alquileres Sur",
  "Gestion Urbana",
];
const STATUSES = ["pendiente_limpieza", "en_limpieza", "mantenimiento", "inspeccion", "lista", "bloqueada"];
const SOURCES = ["Airbnb", "Booking", "Directo"];
const CATEGORIES = ["limpieza", "mantenimiento", "plomeria", "electricidad", "cerradura", "aire"];
const PRIORITIES = ["critico", "alto", "normal", "bajo"];
const TASK_ROLES = ["limpieza", "mantenimiento", "supervisor"];
const TICKET_STATUS = ["nuevo", "asignado", "en_curso"];

function makeCode(zone, index) {
  const prefix = zone
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, "X");
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function buildUnits(count, tenantId) {
  return Array.from({ length: count }, (_, i) => {
    const zone = ZONES[i % ZONES.length];
    const street = STREETS[i % STREETS.length];
    const owner = OWNERS[i % OWNERS.length];
    const number = 800 + ((i * 37) % 4200);
    const status = STATUSES[i % STATUSES.length];
    const bedrooms = (i % 3) + 1;
    const floor = `${(i % 12) + 1}${String.fromCharCode(65 + (i % 6))}`;

    return {
      id: crypto.randomUUID(),
      tenantId,
      code: makeCode(zone, i),
      address: `${street} ${number}, ${zone}, CABA`,
      zone,
      ownerName: owner,
      status,
      metadata: { bedrooms, floor },
    };
  });
}

function isoFromNow(hoursAhead) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return date.toISOString();
}

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  admin: "22222222-2222-4222-8222-222222222222",
  supervisor: "33333333-3333-4333-8333-333333333333",
  cleaning: "44444444-4444-4444-8444-444444444444",
  tech: "55555555-5555-4555-8555-555555555555",
};

await sql.begin(async (tx) => {
  await tx`insert into tenants (id, name, slug)
    values (${ids.tenant}, ${tenantName}, ${tenantSlug})
    on conflict (slug) do update set name = excluded.name, updated_at = now()`;

  await tx`delete from agent_action_log where tenant_id = ${ids.tenant}`;
  await tx`delete from notifications where tenant_id = ${ids.tenant}`;
  await tx`delete from events where tenant_id = ${ids.tenant}`;
  await tx`delete from evidence where tenant_id = ${ids.tenant}`;
  await tx`delete from tasks where tenant_id = ${ids.tenant}`;
  await tx`delete from tickets where tenant_id = ${ids.tenant}`;
  await tx`delete from reservations where tenant_id = ${ids.tenant}`;
  await tx`delete from units where tenant_id = ${ids.tenant}`;
  await tx`delete from app_users where tenant_id = ${ids.tenant}`;

  await tx`insert into app_users (id, tenant_id, email, name, role, zone) values
    (${ids.admin}, ${ids.tenant}, 'admin@demo.local', 'Mora Admin', 'admin', 'Todas'),
    (${ids.supervisor}, ${ids.tenant}, 'supervisor@demo.local', 'Leo Supervisor', 'supervisor', 'Centro'),
    (${ids.cleaning}, ${ids.tenant}, 'limpieza@demo.local', 'Equipo Limpieza A', 'limpieza', 'Palermo'),
    (${ids.tech}, ${ids.tenant}, 'mantenimiento@demo.local', 'Rafa Mantenimiento', 'mantenimiento', 'Recoleta')`;

  const units = buildUnits(safeUnitCount, ids.tenant);
  for (const unit of units) {
    await tx`
      insert into units (id, tenant_id, code, address, zone, owner_name, status, metadata)
      values (
        ${unit.id},
        ${unit.tenantId},
        ${unit.code},
        ${unit.address},
        ${unit.zone},
        ${unit.ownerName},
        ${unit.status},
        ${JSON.stringify(unit.metadata)}::jsonb
      )
    `;
  }

  const reservationsCount = Math.max(6, Math.ceil(safeUnitCount * 0.35));
  for (let i = 0; i < reservationsCount; i += 1) {
    const unit = units[i % units.length];
    const checkOutAt = isoFromNow((i % 24) - 10);
    const checkInAt = isoFromNow((i % 24) + 2);
    await tx`
      insert into reservations (tenant_id, unit_id, source, guest_name, check_out_at, check_in_at, notes)
      values (
        ${ids.tenant},
        ${unit.id},
        ${SOURCES[i % SOURCES.length]},
        ${`Huesped Demo ${i + 1}`},
        ${checkOutAt},
        ${checkInAt},
        ${i % 4 === 0 ? "Check-in tarde" : null}
      )
    `;
  }

  const ticketsCount = Math.max(8, Math.ceil(safeUnitCount * 0.22));
  const ticketIds = [];
  for (let i = 0; i < ticketsCount; i += 1) {
    const unit = units[i % units.length];
    const role = TASK_ROLES[i % TASK_ROLES.length];
    const assignee = role === "limpieza" ? ids.cleaning : role === "mantenimiento" ? ids.tech : ids.supervisor;
    const [ticket] = await tx`
      insert into tickets (tenant_id, unit_id, title, category, priority, status, source, assigned_to_id, due_at)
      values (
        ${ids.tenant},
        ${unit.id},
        ${`Incidencia ${CATEGORIES[i % CATEGORIES.length]} en ${unit.code}`},
        ${CATEGORIES[i % CATEGORIES.length]},
        ${PRIORITIES[i % PRIORITIES.length]},
        ${TICKET_STATUS[i % TICKET_STATUS.length]},
        'planilla',
        ${assignee},
        now() + (${(i % 48) + 1} || ' hours')::interval
      )
      returning id
    `;
    if (ticket?.id) ticketIds.push(ticket.id);
  }

  for (let i = 0; i < ticketsCount; i += 1) {
    const unit = units[i % units.length];
    const role = TASK_ROLES[i % TASK_ROLES.length];
    const assignee = role === "limpieza" ? ids.cleaning : role === "mantenimiento" ? ids.tech : ids.supervisor;
    await tx`
      insert into tasks (tenant_id, unit_id, title, role, assigned_to_id, status, due_at)
      values (
        ${ids.tenant},
        ${unit.id},
        ${`Tarea ${role} para ${unit.code}`},
        ${role},
        ${assignee},
        ${TICKET_STATUS[i % TICKET_STATUS.length]},
        now() + (${(i % 36) + 1} || ' hours')::interval
      )
    `;
  }

  const evidenceCount = Math.max(3, Math.ceil(safeUnitCount * 0.05));
  for (let i = 0; i < evidenceCount && i < ticketIds.length; i += 1) {
    const unit = units[i % units.length];
    await tx`
      insert into evidence (tenant_id, ticket_id, kind, url, size_kb)
      values (
        ${ids.tenant},
        ${ticketIds[i]},
        'external_link',
        ${`https://drive.google.com/demo/${unit.code.toLowerCase()}-${i + 1}`},
        0
      )
    `;
  }

  const notificationCount = Math.max(6, Math.ceil(safeUnitCount * 0.08));
  for (let i = 0; i < notificationCount; i += 1) {
    const unit = units[i % units.length];
    const role = TASK_ROLES[i % TASK_ROLES.length];
    await tx`
      insert into notifications (tenant_id, role, channel, status, event_key, title, body)
      values (
        ${ids.tenant},
        ${role === "mantenimiento" ? "supervisor" : role},
        'in_app',
        'pending',
        ${`demo_event:${unit.code}:${i + 1}`},
        ${`${unit.code} requiere atencion operativa`},
        ${`Zona ${unit.zone} · prioridad ${PRIORITIES[i % PRIORITIES.length]}`}
      )
    `;
  }
});

await sql.end();

console.log(`Seed completed for tenant ${tenantSlug} with ${safeUnitCount} units.`);
