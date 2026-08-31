const PIECE = /"([^"]+)"|(\S+)/g;
const MOST_TERMS = 8;

// D1 rejects a LIKE pattern longer than 50 characters as "too complex", so a long
// word is cut rather than allowed to fail the whole request.
const MOST_CHARACTERS = 40;

export function escaped(word) {
  return word.replace(/[~%_]/g, (one) => `~${one}`);
}

export function termsIn(query) {
  const held = [];

  for (const match of String(query ?? "").matchAll(PIECE)) {
    const word = (match[1] ?? match[2]).trim();

    if (word !== "") {
      held.push(word.slice(0, MOST_CHARACTERS));
    }
  }

  return held.slice(0, MOST_TERMS);
}

// Every term must appear somewhere, but each may appear in a different column, so
// "windows 98 oem" matches a title called Windows 98 holding a file called OEM Full.
export function matching(query, fields, reach) {
  const words = termsIn(query);

  if (words.length === 0) {
    return null;
  }

  const holes = (reach ?? "").split("?t").length - 1;
  const own = fields.map((one) => `${one} LIKE ? ESCAPE '~'`).join(" OR ");
  const below = reach ? ` OR ${reach.replace(/\?t/g, "?")}` : "";
  const clauses = [];
  const bindings = [];

  for (const word of words) {
    clauses.push(`(${own}${below})`);

    for (let hole = 0; hole < fields.length + holes; hole += 1) {
      bindings.push(`%${escaped(word)}%`);
    }
  }

  return { clause: clauses.join(" AND "), bindings };
}

export function applyMatch(query, fields, reach, conditions, bindings) {
  const held = matching(query, fields, reach);

  if (held) {
    conditions.push(`(${held.clause})`);
    bindings.push(...held.bindings);
  }

  return Boolean(held);
}
