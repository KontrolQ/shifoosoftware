import { describedSize, render } from "../rendering.js";

export { render };

export const LARGEST_UPLOAD_BYTES = 95 * 1024 * 1024;

export async function rowsOf(statement) {
  const held = await statement.all();

  return held.results ?? [];
}

export function textFrom(form, name) {
  const held = form.get(name);

  return typeof held === "string" && held.trim() !== "" ? held.trim() : null;
}

export function numberFrom(form, name, fallback) {
  const held = Number(textFrom(form, name));

  return Number.isFinite(held) ? held : fallback;
}

export function slugOf(words) {
  return String(words ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A blank slug box means "name it after what I typed", so nothing has to be slugged by hand.
// A stored thing keeps its extension so its address reads like the file it is.
export function namedPath(words) {
  const held = String(words ?? "").trim();
  const at = held.lastIndexOf(".");
  const stem = at > 0 ? held.slice(0, at) : held;
  const kind = at > 0 ? held.slice(at).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";

  return `${slugOf(stem)}${kind}`;
}

export function slugFrom(form, name, fallbackFields = []) {
  const held = slugOf(textFrom(form, name));

  if (held !== "") {
    return held;
  }

  for (const field of fallbackFields) {
    const grown = slugOf(textFrom(form, field));

    if (grown !== "") {
      return grown;
    }
  }

  return null;
}

export function htmlPage(database, name, data) {
  return new Response(render(name, data), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function goTo(location) {
  return new Response(null, { status: 303, headers: { location } });
}

export async function titleList(database, current) {
  const rows = await rowsOf(database.prepare("SELECT slug, name FROM software ORDER BY name"));

  return rows.map((row) => ({ ...row, here: row.slug === current }));
}

export function lookups(database) {
  return Promise.all([
    rowsOf(database.prepare("SELECT slug, name, summary, sort_order FROM categories ORDER BY sort_order, name")),
    rowsOf(database.prepare("SELECT slug, name, sort_order FROM platforms ORDER BY sort_order, name")),
    rowsOf(database.prepare("SELECT slug, name, sort_order FROM languages ORDER BY sort_order, name")),
  ]);
}

export async function digestOf(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function noteChange(database, manager, subject, deed, detail) {
  await database
    .prepare("INSERT INTO changes (happened_at, manager_id, subject, deed, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), manager?.id ?? null, subject, deed, detail ?? null)
    .run();
}

export async function measuredObject(bucket, objectKey) {
  const held = await bucket.get(objectKey);

  if (!held) {
    return null;
  }

  const stream = new crypto.DigestStream("SHA-256");

  await held.body.pipeTo(stream);

  const digest = await stream.digest;

  return {
    checksum: Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
    algorithm: "SHA-256",
    size: held.size,
  };
}

const DIGEST_LENGTHS = { 40: "SHA-1", 64: "SHA-256", 128: "SHA-512" };

// A digest names its own algorithm by how long it is, so a checksum copied from
// elsewhere does not have to arrive with a label attached.
export function algorithmFor(checksum) {
  return DIGEST_LENGTHS[String(checksum ?? "").trim().length] ?? null;
}

export async function movedObject(bucket, fromKey, toKey) {
  if (fromKey === toKey) {
    return toKey;
  }

  if (bucket.copy) {
    await bucket.copy(fromKey, toKey);
    await bucket.delete(fromKey);

    return toKey;
  }

  const held = await bucket.get(fromKey);

  if (held) {
    await bucket.put(toKey, held.body);
    await bucket.delete(fromKey);
  }

  return toKey;
}

export const MONTHS = [
  { value: "01", label: "January" }, { value: "02", label: "February" },
  { value: "03", label: "March" }, { value: "04", label: "April" },
  { value: "05", label: "May" }, { value: "06", label: "June" },
  { value: "07", label: "July" }, { value: "08", label: "August" },
  { value: "09", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" }, { value: "12", label: "December" },
];

// A release may be known to the day, the month, or only the year, so each part stands alone.
export function dateFieldFor(name, label, held) {
  const [year = "", month = "", day = ""] = String(held ?? "").split("-");

  return {
    name,
    label,
    day,
    year,
    months: MONTHS.map((one) => ({ ...one, chosen: one.value === month })),
  };
}

export function dateFrom(form, name) {
  const year = textFrom(form, `${name}_year`);
  const month = textFrom(form, `${name}_month`);
  const day = textFrom(form, `${name}_day`);

  if (!year) {
    return null;
  }

  if (!month) {
    return year;
  }

  if (!day) {
    return `${year}-${month}`;
  }

  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

export const SPEED_UNITS = ["MHz", "GHz"];
export const SIZE_UNITS = ["KB", "MB", "GB", "TB"];

export function measureFieldFor(name, label, size, unit, units) {
  return {
    name,
    label,
    size: size ?? "",
    units: units.map((one) => ({ value: one, chosen: one === unit })),
  };
}

export function measureFrom(form, name) {
  const size = textFrom(form, `${name}_size`);

  return {
    size: size ? Number(size) : null,
    unit: size ? textFrom(form, `${name}_unit`) : null,
  };
}
