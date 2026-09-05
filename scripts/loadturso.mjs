// Loads a SQLite dump into Turso. Used once, to carry the catalogue over from D1.
//
//   node scripts/loadturso.mjs <dump.sql>
//
// Reads the credentials from the environment, so the token never lands in a file
// that is read back by anything else.

import { readFileSync } from "node:fs";

import { createClient } from "@libsql/client";

const dump = process.argv[2];

if (!dump) {
  console.error("usage: node scripts/loadturso.mjs <dump.sql>");
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

// A semicolon inside a string literal does not end a statement, and SQLite writes a
// quote inside one by doubling it, so the split has to read the quotes rather than
// just look for the separator.
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

  if (last) {
    found.push(last);
  }

  return found;
}

const client = createClient({ url, authToken });
const statements = statementsIn(readFileSync(dump, "utf8"))
  .filter((one) => !/^PRAGMA\b/i.test(one));

console.log(`${statements.length} statements to run`);

const PER_BATCH = 100;
let done = 0;

for (let at = 0; at < statements.length; at += PER_BATCH) {
  const chunk = statements.slice(at, at + PER_BATCH);

  try {
    await client.batch(chunk, "write");
    done += chunk.length;
  } catch (failed) {
    console.error(`\nfailed around statement ${at}: ${String(failed).slice(0, 200)}`);
    console.error(`first of the failing chunk: ${chunk[0].slice(0, 160)}`);
    process.exit(1);
  }

  if (done % 1000 < PER_BATCH) {
    console.log(`  ${done}/${statements.length}`);
  }
}

console.log(`\nloaded ${done} statements`);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__turso%' ORDER BY name"
);

console.log(`${tables.rows.length} tables now present`);
