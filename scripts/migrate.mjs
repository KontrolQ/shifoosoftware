// Applies the SQL under migrations/ to Turso, in name order, once each.
//
//   node scripts/migrate.mjs            apply anything outstanding
//   node scripts/migrate.mjs --dry-run  say what would be applied, change nothing
//
// What has already run is recorded in d1_migrations, the same table the database
// carried over from D1, so nothing is replayed on top of the catalogue that is there.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const dryRun = process.argv.includes("--dry-run");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

// A semicolon inside a string literal does not end a statement, and SQLite doubles a
// quote to put one inside a string, so the split reads the quotes.
function statementsIn(sql) {
  const found = [];
  let held = "";
  let quoted = false;

  for (let at = 0; at < sql.length; at += 1) {
    const letter = sql[at];

    if (letter === "'") {
      if (quoted && sql[at + 1] === "'") {
        held += "''";
        at += 1;
        continue;
      }

      quoted = !quoted;
    }

    if (letter === ";" && !quoted) {
      const whole = held.trim();

      if (whole) {
        found.push(whole);
      }

      held = "";
      continue;
    }

    held += letter;
  }

  const last = held.trim();

  return last ? [...found, last] : found;
}

const client = createClient({ url, authToken, intMode: "number" });

await client.execute(`
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

const done = new Set(
  (await client.execute("SELECT name FROM d1_migrations")).rows.map((row) => row[0])
);

const all = (await readdir(HERE)).filter((one) => one.endsWith(".sql")).sort();
const waiting = all.filter((one) => !done.has(one));

console.log(`${all.length} migrations, ${done.size} already applied, ${waiting.length} outstanding`);

if (waiting.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

for (const name of waiting) {
  const statements = statementsIn(await readFile(join(HERE, name), "utf8"))
    .filter((one) => !/^PRAGMA\b/i.test(one));

  if (dryRun) {
    console.log(`would apply ${name} (${statements.length} statements)`);
    continue;
  }

  try {
    await client.batch(
      [...statements, {
        sql: "INSERT INTO d1_migrations (name) VALUES (?)",
        args: [name],
      }],
      "write"
    );
    console.log(`applied ${name} (${statements.length} statements)`);
  } catch (failed) {
    console.error(`FAILED ${name}: ${String(failed).slice(0, 300)}`);
    process.exit(1);
  }
}
