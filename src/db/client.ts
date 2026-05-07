import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function readEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function getDb() {
  const connectionUrl =
    readEnv("DATABASE_URL") ??
    readEnv("SUPABASE_DB_POOLER_URL") ??
    readEnv("POSTGRES_URL") ??
    readEnv("POSTGRES_PRISMA_URL") ??
    readEnv("POSTGRES_URL_NON_POOLING");
  if (!connectionUrl) {
    throw new Error(
      "DATABASE_URL, SUPABASE_DB_POOLER_URL, POSTGRES_URL, POSTGRES_PRISMA_URL or POSTGRES_URL_NON_POOLING is required to use the database client.",
    );
  }

  if (!client) {
    client = postgres(connectionUrl, { prepare: false });
  }

  if (!db) {
    db = drizzle(client, { schema });
  }

  return db;
}
