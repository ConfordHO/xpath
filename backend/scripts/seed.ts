import { resetDb } from "../src/store.js";

async function main() {
  await resetDb();
  console.log("Seed database written to MongoDB.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
