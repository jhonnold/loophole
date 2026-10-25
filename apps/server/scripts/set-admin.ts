// Grants or revokes admin rights (PRD §5: admins unpublish content and view system health). There
// is no UI for this on purpose. Run from the repo root, so the root settings apply:
//   bun run admin <email>            grant
//   bun run admin <email> --revoke   revoke
import { openDatabase } from "../src/adapters/db/database.ts";
import { SqliteUserRepository } from "../src/adapters/db/user-repository.ts";
import { loadConfig } from "../src/config.ts";
import { normalizeEmail } from "../src/managers/account-manager.ts";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const emails = args.filter((a) => a !== "--revoke");
if (emails.length !== 1) {
  console.error("Usage: bun run admin <email> [--revoke]");
  process.exit(2);
}

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
const email = normalizeEmail(emails[0]);
const found = new SqliteUserRepository(db).setAdmin(email, !revoke);
db.close();
if (!found) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}
console.log(`${email} is ${revoke ? "no longer an admin" : "now an admin"}.`);
