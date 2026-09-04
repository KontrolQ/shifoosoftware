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

export async function slugsFor(database, manager, kind, offered, report) {
  const many = Array.isArray(offered) ? offered : [offered];
  const held = [];

  for (const one of many) {
    const slug = await slugFor(database, manager, kind, one, report);

    if (slug && !held.includes(slug)) {
      held.push(slug);
    }
  }

  return held;
}

export async function relinked(database, table, ownerColumn, owner, valueColumn, slugs) {
  await database.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).bind(owner).run();

  for (const slug of slugs) {
    await database
      .prepare(`INSERT INTO ${table} (${ownerColumn}, ${valueColumn}) VALUES (?, ?)`)
      .bind(owner, slug)
      .run();
  }
}
