import { migrateLegacyDbToPostgres, clearLegacyMongoState } from "../src/store.js";

async function main() {
  const db = await migrateLegacyDbToPostgres();
  const clearedLegacyMongo = await clearLegacyMongoState().catch(() => false);
  console.log(
    `Migrated ${db.users.length} users, ${db.orders.length} orders, and ${db.patients.length} patients to PostgreSQL.`,
  );
  if (clearedLegacyMongo) {
    console.log("Legacy MongoDB state was cleared after migration.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
