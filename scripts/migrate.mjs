// Applies the SQL under migrations/ to the catalogue, in name order, once each.
//
//   node scripts/migrate.mjs            apply anything outstanding
//   node scripts/migrate.mjs --dry-run  say what would be applied, change nothing
//
// What has already run is recorded in d1_migrations, the same table the database
// carried over from D1, so nothing is replayed on top of the catalogue that is there.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rowsOf, run, statementsIn } from "./pipeline.mjs";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const dryRun = process.argv.includes("--dry-run");

await run([`
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`]);

const [held] = await run(["SELECT name FROM d1_migrations"]);
const done = new Set(rowsOf(held).map(([name]) => name));

const all = (await readdir(HERE)).filter((one) => one.endsWith(".sql")).sort();
const waiting = all.filter((one) => !done.has(one));

console.log(`${all.length} migrations, ${done.size} already applied, ${waiting.length} outstanding`);

if (waiting.length === 0) {
  console.log("nothing to do");
}

for (const name of waiting) {
  const statements = statementsIn(await readFile(join(HERE, name), "utf8"))
    .filter((one) => !/^PRAGMA\b/i.test(one));

  if (dryRun) {
    console.log(`would apply ${name} (${statements.length} statements)`);
    continue;
  }

  try {
    // The record of the migration goes in the same request as the migration, so a
    // failure part way through cannot leave it marked as done.
    await run([
      ...statements,
      { sql: "INSERT INTO d1_migrations (name) VALUES (?)", args: [name] },
    ]);
    console.log(`applied ${name} (${statements.length} statements)`);
  } catch (failed) {
    console.error(`FAILED ${name}: ${String(failed).slice(0, 300)}`);
    process.exitCode = 1;
    break;
  }
}
