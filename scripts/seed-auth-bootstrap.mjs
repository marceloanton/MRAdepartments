import fs from "node:fs";
import path from "node:path";
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

const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "mranalytics_departments";
const tenantName = process.env.DEFAULT_TENANT_NAME ?? "MRAnalytics Departments";
const adminEmail = process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local";
const adminName = process.env.DEMO_ADMIN_NAME ?? "Mora Admin";
const adminZone = process.env.DEMO_ADMIN_ZONE ?? "Todas";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

await sql.begin(async (tx) => {
  const [tenant] = await tx`
    insert into tenants (name, slug)
    values (${tenantName}, ${tenantSlug})
    on conflict (slug) do update
      set name = excluded.name,
          updated_at = now()
    returning id
  `;

  if (!tenant?.id) {
    throw new Error("Unable to create or resolve default tenant.");
  }

  await tx`
    insert into app_users (tenant_id, email, name, role, zone, active)
    select ${tenant.id}, ${adminEmail}, ${adminName}, 'admin', ${adminZone}, true
    where not exists (
      select 1
      from app_users
      where tenant_id = ${tenant.id} and email = ${adminEmail}
    )
  `;

  await tx`
    update app_users
    set
      name = ${adminName},
      zone = ${adminZone},
      role = 'admin',
      active = true,
      updated_at = now()
    where tenant_id = ${tenant.id} and email = ${adminEmail}
  `;
});

await sql.end();

console.log(`Auth bootstrap completed. tenant=${tenantSlug} admin=${adminEmail}`);
