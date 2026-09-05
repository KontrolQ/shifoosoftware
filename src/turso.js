// The archive reads its catalogue through D1's statement API in six hundred places.
// Rather than rewrite each of them, this hands back the same shape over Turso: a
// statement that binds and then answers, with rows under `results` the way D1 does.
//
// It speaks Turso's HTTP pipeline itself rather than through a client library. The
// published clients carry a websocket transport a worker cannot open and reach for
// node built-ins to do it, which left every query taking seconds. This is fetch and
// JSON, which is all a worker needs.

const PIPELINE = "/v2/pipeline";

function sentValue(one) {
  if (one === null || one === undefined) {
    return { type: "null" };
  }

  if (typeof one === "boolean") {
    return { type: "integer", value: one ? "1" : "0" };
  }

  if (typeof one === "number") {
    return Number.isInteger(one)
      ? { type: "integer", value: String(one) }
      : { type: "float", value: one };
  }

  if (typeof one === "bigint") {
    return { type: "integer", value: String(one) };
  }

  if (one instanceof ArrayBuffer || ArrayBuffer.isView(one)) {
    const bytes = one instanceof ArrayBuffer ? new Uint8Array(one) : new Uint8Array(one.buffer);

    return { type: "blob", base64: btoa(String.fromCharCode(...bytes)) };
  }

  return { type: "text", value: String(one) };
}

function heldValue(one) {
  if (!one || one.type === "null") {
    return null;
  }

  switch (one.type) {
    // Whole numbers come back as numbers, not strings or BigInt, because that is what
    // D1 handed back and the pages count and format with them.
    case "integer":
      return Number(one.value);
    case "float":
      return one.value;
    case "blob":
      return Uint8Array.from(atob(one.base64), (letter) => letter.charCodeAt(0)).buffer;
    default:
      return one.value;
  }
}

async function pipelined(where, token, statements) {
  const answer = await fetch(`${where}${PIPELINE}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      requests: [
        ...statements.map(({ sql, args }) => ({
          type: "execute",
          stmt: { sql, args: (args ?? []).map(sentValue) },
        })),
        { type: "close" },
      ],
    }),
  });

  if (!answer.ok) {
    throw new Error(`turso answered ${answer.status}: ${(await answer.text()).slice(0, 200)}`);
  }

  const held = await answer.json();
  const outcomes = (held.results ?? []).slice(0, statements.length);

  return outcomes.map((one, at) => {
    if (one.type !== "ok") {
      throw new Error(`${one.error?.message ?? "query failed"}: ${statements[at].sql.slice(0, 120)}`);
    }

    const result = one.response.result;
    const names = (result.cols ?? []).map((column) => column.name);

    return {
      rows: (result.rows ?? []).map((row) =>
        Object.fromEntries(row.map((cell, column) => [names[column], heldValue(cell)]))),
      changes: result.affected_row_count ?? 0,
    };
  });
}

function statement(where, token, sql, args) {
  const asked = { sql, args };

  return {
    ...asked,
    bind: (...bound) => statement(where, token, sql, bound),
    first: async () => (await pipelined(where, token, [asked]))[0].rows[0] ?? null,
    all: async () => ({ results: (await pipelined(where, token, [asked]))[0].rows, success: true }),
    run: async () => {
      const [held] = await pipelined(where, token, [asked]);

      return { success: true, meta: { changes: held.changes } };
    },
  };
}

export function catalogueOn(environment) {
  // A libsql:// address is the same host over https, which is the only scheme a
  // worker can reach.
  const where = (environment.TURSO_DATABASE_URL ?? "")
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/+$/, "");

  if (!where) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  const token = environment.TURSO_AUTH_TOKEN;

  return {
    prepare: (sql) => statement(where, token, sql, []),
    // One round trip for the lot, which is the point of asking for a batch.
    batch: (statements) =>
      pipelined(where, token, statements.map((one) => ({ sql: one.sql, args: one.args }))),
  };
}
