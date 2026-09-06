// The whole of the catalogue transport. It hands the rest of the code one shape: a
// statement that binds and then answers, with its rows under `results`.
//
// It speaks the libSQL HTTP pipeline directly rather than through a client library. The
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

// A token may arrive as a bearer token or as a whole header, so a scheme already on
// the front of it is left alone.
function authorized(token) {
  if (!token) {
    return {};
  }

  return { authorization: /^(Basic|Bearer) /i.test(token) ? token : `Bearer ${token}` };
}

// A server holding several databases picks between them by the first label of the
// address it was asked on, which would make ours the name of its own hostname. Naming
// the one we want outright settles it, and a server holding only one ignores it.
function addressed(token, namespace) {
  return { "content-type": "application/json", "x-namespace": namespace, ...authorized(token) };
}

async function pipelined(where, headers, statements) {
  const answer = await fetch(`${where}${PIPELINE}`, {
    method: "POST",
    headers,
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
    throw new Error(`the catalogue answered ${answer.status}: ${(await answer.text()).slice(0, 200)}`);
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

// A page asks for several things at once and waits for all of them. Sent one at a time
// those are separate requests, each paying for its own connection to a database that is
// not nearby. Everything asked for in the same tick is therefore gathered and sent as
// one pipeline, so a page costs a single round trip rather than one per query.
function gatheringFrom(where, headers) {
  let waiting = null;

  async function flush(batch) {
    try {
      const held = await pipelined(where, headers, batch.map((one) => one.asked));

      batch.forEach((one, at) => one.settle(held[at]));
    } catch (failed) {
      batch.forEach((one) => one.fail(failed));
    }
  }

  return (asked) => new Promise((settle, fail) => {
    if (!waiting) {
      waiting = [];

      queueMicrotask(() => {
        const batch = waiting;

        waiting = null;
        flush(batch);
      });
    }

    waiting.push({ asked, settle, fail });
  });
}

function statement(gather, sql, args) {
  const asked = { sql, args };

  return {
    ...asked,
    bind: (...bound) => statement(gather, sql, bound),
    first: async () => (await gather(asked)).rows[0] ?? null,
    all: async () => ({ results: (await gather(asked)).rows, success: true }),
    run: async () => ({ success: true, meta: { changes: (await gather(asked)).changes } }),
  };
}

export function catalogueOn(environment) {
  // A libsql:// address is the same host over https, which is the only scheme a
  // worker can reach.
  const where = (environment.CATALOGUE_URL ?? "")
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/+$/, "");

  if (!where) {
    throw new Error("CATALOGUE_URL is not set");
  }

  const headers = addressed(environment.CATALOGUE_TOKEN, environment.CATALOGUE_NAMESPACE || "default");
  const gather = gatheringFrom(where, headers);

  return {
    prepare: (sql) => statement(gather, sql, []),
    // An explicit batch is already one round trip and is sent as it stands, rather than
    // being gathered with whatever else the page happens to be asking for.
    batch: (statements) =>
      pipelined(where, headers, statements.map((one) => ({ sql: one.sql, args: one.args }))),
  };
}
