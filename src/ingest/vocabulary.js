import { noteChange, slugOf } from "../admin/shared.js";
import { tidyFileType } from "../rendering.js";

const TABLES = {
  category: "categories",
  publisher: "publishers",
  platform: "platforms",
  language: "languages",
  interface: "interfaces",
  architecture: "architectures",
  processor: "processors",
  filetype: "file_types",
  device: "devices",
};

// A document names its vocabulary rather than addressing it, because the sender
// has no way to know which slugs this catalogue already holds.
function named(offered) {
  if (offered == null) {
    return null;
  }

  const name = String(typeof offered === "object" ? offered.name ?? "" : offered).trim();

  if (!name) {
    return null;
  }

  const wanted = String(typeof offered === "object" ? offered.slug ?? "" : "").trim();

  return { name, slug: wanted || slugOf(name) };
}

// Hardware is the one vocabulary with more to it than a name. A sender that knows
// the vendor and the sort of part should not leave somebody to fill them in by hand,
// but it must not overwrite what the catalogue was told before either.
async function describedDevice(database, manager, slug, offered, report) {
  if (typeof offered !== "object" || offered === null) {
    return;
  }

  const vendor = await slugFor(database, manager, "publisher", offered.vendor, report);
  const kind = String(offered.kind ?? "").trim() || null;
  const released = String(offered.releasedOn ?? "").trim() || null;
  const known = kind
    ? await database.prepare("SELECT slug FROM device_kinds WHERE slug = ?").bind(kind).first()
    : null;

  await database
    .prepare(`
      UPDATE devices
      SET vendor_slug = COALESCE(vendor_slug, ?),
          kind_slug = COALESCE(kind_slug, ?),
          released_on = COALESCE(released_on, ?)
      WHERE slug = ?`)
    .bind(vendor, known?.slug ?? null, released, slug)
    .run();
}

function insertFor(database, table, wanted) {
  if (table === "file_types") {
    return database
      .prepare("INSERT INTO file_types (slug, name, extension, sort_order) VALUES (?, ?, ?, 9999)")
      .bind(wanted.slug, wanted.name, tidyFileType(wanted.name));
  }

  if (table === "categories") {
    return database
      .prepare("INSERT INTO categories (slug, name, summary, sort_order) VALUES (?, ?, NULL, 9999)")
      .bind(wanted.slug, wanted.name);
  }

  return database
    .prepare(`INSERT INTO ${table} (slug, name, sort_order) VALUES (?, ?, 9999)`)
    .bind(wanted.slug, wanted.name);
}

// The vendors a batch of hardware names are settled first, so the facts can then be
// filled in with one write for the lot.
async function describeDevices(database, manager, wanted, report) {
  const told = wanted.filter((one) => typeof one.offered === "object" && one.offered !== null);

  if (told.length === 0) {
    return;
  }

  const vendors = new Map();

  for (const one of told) {
    if (one.offered.vendor && !vendors.has(one.offered.vendor)) {
      vendors.set(one.offered.vendor,
        await slugFor(database, manager, "publisher", one.offered.vendor, report));
    }
  }

  const kinds = new Set();
  const asked = [...new Set(told.map((one) => String(one.offered.kind ?? "").trim()).filter(Boolean))];

  if (asked.length > 0) {
    const found = await database
      .prepare(`SELECT slug FROM device_kinds WHERE slug IN (${asked.map(() => "?").join(", ")})`)
      .bind(...asked)
      .all();

    for (const row of found.results ?? []) {
      kinds.add(row.slug);
    }
  }

  const writes = told.map((one) => database
    .prepare(`
      UPDATE devices
      SET vendor_slug = COALESCE(vendor_slug, ?),
          kind_slug = COALESCE(kind_slug, ?),
          released_on = COALESCE(released_on, ?)
      WHERE slug = ?`)
    .bind(
      vendors.get(one.offered.vendor) ?? null,
      kinds.has(String(one.offered.kind ?? "").trim()) ? String(one.offered.kind).trim() : null,
      String(one.offered.releasedOn ?? "").trim() || null,
      one.slug
    ));

  for (const chunk of inChunks(writes)) {
    await database.batch(chunk);
  }
}

export async function slugFor(database, manager, kind, offered, report) {
  const table = TABLES[kind];
  const wanted = named(offered);

  if (!table || !wanted || !wanted.slug) {
    return null;
  }

  const held = await database
    .prepare(`SELECT slug FROM ${table} WHERE slug = ?`)
    .bind(wanted.slug)
    .first();

  if (held) {
    if (kind === "device") {
      await describedDevice(database, manager, held.slug, offered, report);
    }

    return held.slug;
  }

  if (table === "file_types") {
    await database
      .prepare("INSERT INTO file_types (slug, name, extension, sort_order) VALUES (?, ?, ?, 9999)")
      .bind(wanted.slug, wanted.name, tidyFileType(wanted.name))
      .run();
  } else if (table === "categories") {
    await database
      .prepare("INSERT INTO categories (slug, name, summary, sort_order) VALUES (?, ?, NULL, 9999)")
      .bind(wanted.slug, wanted.name)
      .run();
  } else {
    await database
      .prepare(`INSERT INTO ${table} (slug, name, sort_order) VALUES (?, ?, 9999)`)
      .bind(wanted.slug, wanted.name)
      .run();
  }

  if (kind === "device") {
    await describedDevice(database, manager, wanted.slug, offered, report);
  }

  await noteChange(database, manager, `${kind}:${wanted.slug}`, "created", wanted.name);
  report.made.push(`${kind}:${wanted.slug}`);

  return wanted.slug;
}

// A worker is allowed only so many calls while answering one request, and a release
// naming forty cards would spend them one at a time. Everything a list needs is asked
// for at once instead, and only what is genuinely new is written.
const AT_ONCE = 90;

function inChunks(held) {
  const made = [];

  for (let at = 0; at < held.length; at += AT_ONCE) {
    made.push(held.slice(at, at + AT_ONCE));
  }

  return made;
}

export async function slugsFor(database, manager, kind, offered, report) {
  const table = TABLES[kind];
  const many = Array.isArray(offered) ? offered : [offered];
  const wanted = [];

  for (const one of many) {
    const held = named(one);

    if (held && held.slug && !wanted.some((each) => each.slug === held.slug)) {
      wanted.push({ ...held, offered: one });
    }
  }

  if (!table || wanted.length === 0) {
    return [];
  }

  const standing = new Set();

  for (const chunk of inChunks(wanted)) {
    const found = await database
      .prepare(`SELECT slug FROM ${table} WHERE slug IN (${chunk.map(() => "?").join(", ")})`)
      .bind(...chunk.map((one) => one.slug))
      .all();

    for (const row of found.results ?? []) {
      standing.add(row.slug);
    }
  }

  const missing = wanted.filter((one) => !standing.has(one.slug));

  if (missing.length > 0) {
    await database.batch(missing.map((one) => insertFor(database, table, one)));

    for (const one of missing) {
      await noteChange(database, manager, `${kind}:${one.slug}`, "created", one.name);
      report.made.push(`${kind}:${one.slug}`);
    }
  }

  if (kind === "device") {
    await describeDevices(database, manager, wanted, report);
  }

  return wanted.map((one) => one.slug);
}

export async function relinked(database, table, ownerColumn, owner, valueColumn, slugs) {
  const writes = [database.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).bind(owner)];

  for (const slug of slugs) {
    writes.push(database
      .prepare(`INSERT INTO ${table} (${ownerColumn}, ${valueColumn}) VALUES (?, ?)`)
      .bind(owner, slug));
  }

  // one call rather than one per link, so a release with forty cards costs the same
  // as a release with one
  for (const chunk of inChunks(writes)) {
    await database.batch(chunk);
  }
}
