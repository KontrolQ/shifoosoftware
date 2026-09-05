// Talking to the libSQL server the way the worker does — over its HTTP pipeline, with
// no client library. Shared by the loader and the migrator, which differ only in where
// their statements come from.

const PER_BATCH = 100;

export function endpoint() {
  const where = (process.env.TURSO_DATABASE_URL ?? "")
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/+$/, "");

  if (!where) {
    throw new Error("TURSO_DATABASE_URL must be set");
  }

  const token = process.env.TURSO_AUTH_TOKEN ?? "";

  return {
    where: `${where}/v2/pipeline`,
    // A server holding several databases picks between them by the first label of the
    // address it was asked on; naming the one we want settles it, and a server holding
    // only one ignores it.
    headers: {
      "content-type": "application/json",
      "x-namespace": process.env.TURSO_NAMESPACE || "default",
      authorization: /^(Basic|Bearer) /i.test(token) ? token : `Bearer ${token}`,
    },
  };
}

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

// A statement is either bare SQL or a { sql, args } pair, the way the worker sends them.
function asked(one) {
  const { sql, args } = typeof one === "string" ? { sql: one, args: [] } : one;

  return {
    type: "execute",
    stmt: { sql, args: (args ?? []).map((value) => ({ type: "text", value: String(value) })) },
  };
}

export async function run(statements) {
  const { where, headers } = endpoint();

  const answer = await fetch(where, {
    method: "POST",
    headers,
    body: JSON.stringify({ requests: [...statements.map(asked), { type: "close" }] }),
  });

  if (!answer.ok) {
    throw new Error(`${answer.status}: ${(await answer.text()).slice(0, 200)}`);
  }

  const held = await answer.json();

  return (held.results ?? []).map((one, at) => {
    if (one.type !== "ok") {
      const sql = typeof statements[at] === "string" ? statements[at] : statements[at]?.sql;

      throw new Error(`${one.error?.message ?? "failed"} on: ${String(sql).slice(0, 140)}`);
    }

    return one.response.result;
  });
}

// A dump is far too long for one request, so it goes in fixed runs, each reported.
export async function runInBatches(statements, note) {
  for (let at = 0; at < statements.length; at += PER_BATCH) {
    await run(statements.slice(at, at + PER_BATCH));
    note?.(Math.min(at + PER_BATCH, statements.length), statements.length);
  }
}

export function rowsOf(result) {
  return (result?.rows ?? []).map((row) => row.map((cell) => (cell?.value ?? null)));
}
