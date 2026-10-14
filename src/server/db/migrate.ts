import path from "node:path";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { DbHandle } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(handle: DbHandle, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  if (handle.driver === "pglite") {
    await migratePglite(handle.db as unknown as PgliteDatabase, { migrationsFolder });
  } else {
    await migrateNodePg(handle.db as unknown as NodePgDatabase, { migrationsFolder });
  }
}
