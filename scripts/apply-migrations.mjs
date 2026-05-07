import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const migrationsDir = path.resolve("drizzle");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => a.localeCompare(b));

const sql = postgres(connectionString, { prepare: false });

try {
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const raw = fs.readFileSync(fullPath, "utf8");
    const cleaned = raw.replace(/--> statement-breakpoint/g, "\n");
    if (!cleaned.trim()) continue;
    console.log(`Applying ${file}...`);
    await sql.unsafe(cleaned);
  }
  console.log(`Applied ${files.length} migration files.`);
} finally {
  await sql.end({ timeout: 5 });
}

