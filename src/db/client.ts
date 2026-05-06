import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const connectionUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_POOLER_URL;
  if (!connectionUrl) {
    throw new Error("DATABASE_URL or SUPABASE_DB_POOLER_URL is required to use the database client.");
  }

  if (!client) {
    client = postgres(connectionUrl, { prepare: false });
  }

  if (!db) {
    db = drizzle(client, { schema });
  }

  return db;
}
