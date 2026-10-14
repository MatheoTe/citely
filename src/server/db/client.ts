import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { getEnv } from "../config/env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface DbHandle {
  db: Db;
  driver: "postgres" | "pglite";
  close(): Promise<void>;
}

/**
 * Two drivers behind one Drizzle type:
 *  - `postgres://…`  → node-postgres pool (docker-compose, CI service container, prod)
 *  - `pglite://<dir>` or `pglite://memory` → embedded WASM Postgres with pgvector,
 *    used by the eval harness and as a zero-dependency fallback when Docker
 *    is not available. Same SQL, same migrations, same extension.
 */
export async function createDb(url: string): Promise<DbHandle> {
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    const dataDir = target === "" || target === "memory" ? undefined : path.resolve(target);
    if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
    const client = await PGlite.create(dataDir, { extensions: { vector } });
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return { db, driver: "pglite", close: () => client.close() };
  }

  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzleNodePg(pool, { schema }) as unknown as Db;
  return { db, driver: "postgres", close: () => pool.end() };
}

const globalForDb = globalThis as unknown as { __citelyDb?: Promise<DbHandle> };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  globalForDb.__citelyDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__citelyDb.then((h) => h.db);
}
