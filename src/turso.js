// The archive reads its catalogue through D1's statement API in six hundred places.
// Rather than rewrite each of them, this hands back the same shape over libSQL: a
// statement that binds and then answers, with rows under `results` the way D1 does.

// The http entry point, not web: web carries a websocket transport a worker cannot
// open, and pulls node built-ins in with it.
import { createClient } from "@libsql/client/http";

function rowsFrom(answer) {
  return answer.rows.map((row) =>
    Object.fromEntries(answer.columns.map((name, at) => [name, row[at]])));
}

function statement(client, sql, args) {
  const asked = { sql, args };

  return {
    ...asked,
    bind: (...bound) => statement(client, sql, bound),
    first: async () => rowsFrom(await client.execute(asked))[0] ?? null,
    all: async () => ({ results: rowsFrom(await client.execute(asked)), success: true }),
    run: async () => {
      const answer = await client.execute(asked);

      return { success: true, meta: { changes: answer.rowsAffected } };
    },
  };
}

// One client per worker, not per request: it holds no connection, only the address it
// posts to, and building it again on every request would be waste.
let held = null;

export function catalogueOn(environment) {
  // A libsql:// address asks the client for its websocket transport, which a worker
  // cannot open; over https it talks the same protocol with fetch.
  const url = (environment.TURSO_DATABASE_URL ?? "").replace(/^libsql:\/\//, "https://");

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  if (!held || held.url !== url) {
    held = {
      url,
      // Whole numbers come back as numbers rather than BigInt, because that is what D1
      // handed back and the pages count and format with them.
      client: createClient({ url, authToken: environment.TURSO_AUTH_TOKEN, intMode: "number" }),
    };
  }

  const { client } = held;

  return {
    prepare: (sql) => statement(client, sql, []),
    batch: (statements) =>
      client.batch(statements.map((one) => ({ sql: one.sql, args: one.args })), "write"),
  };
}
