// Loads a SQLite dump into a libSQL server over its HTTP pipeline, the same way the
// worker talks to it.
//
//   node scripts/loaddump.mjs <dump.sql>
//
// Reads CATALOGUE_URL, CATALOGUE_TOKEN and CATALOGUE_NAMESPACE from the environment.
// The token may be a bearer token or a complete header such as "Basic ...".

import { readFileSync } from "node:fs";

import { endpoint, runInBatches, statementsIn } from "./pipeline.mjs";

const dump = process.argv[2];

if (!dump) {
  console.error("usage: node scripts/loaddump.mjs <dump.sql>");
  process.exitCode = 1;
} else {
  const statements = statementsIn(readFileSync(dump, "utf8"))
    .filter((one) => !/^PRAGMA\b/i.test(one));

  console.log(`${statements.length} statements to run against ${endpoint().where}`);

  try {
    await runInBatches(statements, (done, all) => {
      if (done % 1000 < 100) {
        console.log(`  ${done}/${all}`);
      }
    });
    console.log(`\nloaded ${statements.length} statements`);
  } catch (failed) {
    console.error(`\nfailed: ${String(failed).slice(0, 300)}`);
    process.exitCode = 1;
  }
}
