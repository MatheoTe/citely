import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

async function main() {
  const url = getEnv().DATABASE_URL;
  const handle = await createDb(url);
  try {
    await runMigrations(handle);
    console.log(`✔ migrations applied (${handle.driver})`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
