// Loads a SQLite dump into a libSQL server over its HTTP pipeline, the same way the
// worker talks to it.
//
//   node scripts/loadturso.mjs <dump.sql>
//
// Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from the environment. The token may be
// a bearer token or a complete header such as "Basic ...".

import { readFileSync } from "node:fs";

const dump = process.argv[2];

if (!dump) {
  console.error("usage: node scripts/loadturso.mjs <dump.sql>");
  process.exit(1);
}

const where = (process.env.TURSO_DATABASE_URL ?? "")
  .replace(/^libsql:\/\//, "https://")
  .replace(/\/+$/, "");
const token = process.env.TURSO_AUTH_TOKEN ?? "";

if (!where) {
  console.error("TURSO_DATABASE_URL must be set");
  process.exit(1);
}

const authorization = /^(Basic|Bearer) /i.test(token) ? token : `Bearer ${token}`;

// A semicolon inside a string literal does not end a statement, and SQLite doubles a
// quote to put one inside a string, so the split has to read the quotes.
export function statementsIn(sql) {
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

async function run(statements) {
  const answer = await fetch(`${where}/v2/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify({
      requests: [
        ...statements.map((sql) => ({ type: "execute", stmt: { sql } })),
        { type: "close" },
      ],
    }),
  });

  if (!answer.ok) {
    throw new Error(`${answer.status}: ${(await answer.text()).slice(0, 200)}`);
  }

  const held = await answer.json();

  for (const [at, one] of (held.results ?? []).entries()) {
    if (one.type !== "ok") {
      throw new Error(`${one.error?.message ?? "failed"} on: ${statements[at]?.slice(0, 140)}`);
    }
  }
}

const statements = statementsIn(readFileSync(dump, "utf8"))
  .filter((one) => !/^PRAGMA\b/i.test(one));

console.log(`${statements.length} statements to run against ${where}`);

const PER_BATCH = 100;

for (let at = 0; at < statements.length; at += PER_BATCH) {
  try {
    await run(statements.slice(at, at + PER_BATCH));
  } catch (failed) {
    console.error(`\nfailed around statement ${at}: ${String(failed).slice(0, 300)}`);
    process.exit(1);
  }

  if ((at + PER_BATCH) % 1000 < PER_BATCH) {
    console.log(`  ${Math.min(at + PER_BATCH, statements.length)}/${statements.length}`);
  }
}

console.log(`\nloaded ${statements.length} statements`);
