import { migrateLegacyDbToMongo } from "../src/store.js";

async function main() {
  const db = await migrateLegacyDbToMongo();
  console.log(
    `Migrated ${db.users.length} users, ${db.orders.length} orders, and ${db.patients.length} patients to MongoDB.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
