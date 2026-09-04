import { can, refuse } from "./permissions.js";
import { goTo, htmlPage, noteChange, rowsOf, slugFrom, textFrom } from "./shared.js";
import { applyMatch } from "../searching.js";
import { tidyFileType } from "../rendering.js";

export const KINDS = {
  platforms: {
    table: "platforms",
    label: "Platforms",
    singular: "A Platform",
    slugHint: "windows-98",
    nameHint: "Windows 98",
    countTable: "software_platforms",
    countColumn: "platform_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug AS path, s.name AS label, '' AS version, '' AS software_name
      FROM software s JOIN software_platforms j ON j.software_slug = s.slug
      WHERE j.platform_slug = ? ORDER BY s.name LIMIT 200`,
    flag: "atPlatforms",
  },
  languages: {
    table: "languages",
    label: "Languages",
    singular: "A Language",
    slugHint: "english",
    nameHint: "English",
    countTable: "file_languages",
    countColumn: "language_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug || '/' || v.slug || '/' || f.slug AS path,
             f.display_name AS label, v.version, s.name AS software_name
      FROM files f JOIN versions v ON v.id = f.version_id JOIN software s ON s.slug = v.software_slug
      JOIN file_languages j ON j.file_id = f.id
      WHERE j.language_slug = ? ORDER BY s.name, v.version LIMIT 200`,
    flag: "atLanguages",
  },
  interfaces: {
    table: "interfaces",
    label: "Interfaces",
    singular: "An Interface",
    slugHint: "command-line",
    nameHint: "Command line",
    countTable: "software_interfaces",
    countColumn: "interface_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug AS path, s.name AS label, '' AS version, '' AS software_name
      FROM software s JOIN software_interfaces j ON j.software_slug = s.slug
      WHERE j.interface_slug = ? ORDER BY s.name LIMIT 200`,
    flag: "atInterfaces",
  },
  devices: {
    table: "devices",
    label: "Hardware",
    singular: "A Device",
    slugHint: "voodoo-3",
    nameHint: "3dfx Voodoo 3",
    extras: [
      { name: "vendor_slug", label: "Vendor", hint: "who built it", from: "publishers" },
      { name: "kind_slug", label: "Kind", hint: "what sort of part it is", from: "device_kinds" },
      { name: "released_on", label: "Released on", hint: "1999-04-03" },
    ],
    countTable: "file_devices",
    countColumn: "device_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug || '/' || v.slug AS path, f.display_name AS label,
             v.version, s.name AS software_name
      FROM file_devices fd
      JOIN files f ON f.id = fd.file_id
      JOIN versions v ON v.id = f.version_id
      JOIN software s ON s.slug = v.software_slug
      WHERE fd.device_slug = ? ORDER BY s.name, f.display_name LIMIT 200`,
    flag: "atHardware",
  },
  architectures: {
    table: "architectures",
    label: "Architectures",
    singular: "An Architecture",
    slugHint: "x86",
    nameHint: "x86",
    countTable: "version_architectures",
    countColumn: "architecture_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug || '/' || v.slug AS path, v.version AS label,
             v.version, s.name AS software_name
      FROM version_architectures va
      JOIN versions v ON v.id = va.version_id
      JOIN software s ON s.slug = v.software_slug
      WHERE va.architecture_slug = ? ORDER BY s.name, v.version LIMIT 200`,
    flag: "atArchitectures",
  },
  filetypes: {
    table: "file_types",
    label: "File Types",
    singular: "A File Type",
    slugHint: "iso",
    nameHint: "ISO",
    extras: [{ name: "extension", label: "Extension", hint: ".iso" }],
    countTable: "files",
    countColumn: "file_type_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug || '/' || v.slug || '/' || f.slug AS path,
             f.display_name AS label, v.version, s.name AS software_name
      FROM files f JOIN versions v ON v.id = f.version_id JOIN software s ON s.slug = v.software_slug
      WHERE f.file_type_slug = ? ORDER BY s.name, v.version LIMIT 200`,
    flag: "atFileTypes",
  },
  processors: {
    table: "processors",
    label: "Processors",
    singular: "A Processor",
    slugHint: "486dx",
    nameHint: "486DX",
    countTable: "software",
    countColumn: "minimum_cpu_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug AS path, s.name AS label, '' AS version, '' AS software_name
      FROM software s WHERE s.minimum_cpu_slug = ? ORDER BY s.name LIMIT 200`,
    flag: "atProcessors",
  },
  publishers: {
    table: "publishers",
    label: "Publishers",
    singular: "A Publisher",
    slugHint: "microsoft",
    nameHint: "Microsoft",
    countTable: "software_publishers",
    countColumn: "publisher_slug",
    usedBy: `
      SELECT s.category || '/' || s.slug AS path, s.name AS label, '' AS version, '' AS software_name
      FROM software s JOIN software_publishers j ON j.software_slug = s.slug
      WHERE j.publisher_slug = ? ORDER BY s.name LIMIT 200`,
    flag: "atPublishers",
  },
};

// An extra that names another table is picked from it rather than typed.
export async function extrasFor(database, shape, held) {
  const filled = [];

  for (const one of shape.extras ?? []) {
    const value = held?.[one.name] ?? "";

    if (!one.from) {
      filled.push({ ...one, value });
      continue;
    }

    const rows = await rowsOf(database.prepare(`SELECT slug, name FROM ${one.from} ORDER BY name`));

    filled.push({
      ...one,
      value,
      choices: true,
      options: [{ value: "", label: "—", selected: value === "" }].concat(
        rows.map((row) => ({ value: row.slug, label: row.name, selected: row.slug === value }))
      ),
    });
  }

  return filled;
}

// A file type typed as "ISO" ends its files with ".iso" unless told otherwise.
function grownExtra(column, name) {
  return column === "extension" ? tidyFileType(name) : null;
}

export function isKind(kind) {
  return Object.hasOwn(KINDS, kind);
}


export async function taxonomyView(environment, root, manager, kind, slug, message, saved) {
  const shape = KINDS[kind];

  if (!can(manager, `${kind}.view`)) {
    return refuse(`see ${shape.label.toLowerCase()}`);
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare(`SELECT * FROM ${shape.table} WHERE slug = ?`).bind(slug).first();

  if (!held) {
    return goTo(`${root}/${kind}`);
  }

  const files = await rowsOf(database.prepare(shape.usedBy).bind(slug));

  return htmlPage(database, "edit-taxonomy", {
    root,
    manager,
    message,
    saved,
    title: held.name,
    heading: held.name,
    [shape.flag]: true,
    kind,
    label: shape.label,
    entry: held,
    extras: await extrasFor(database, shape, held),
    hasExtras: Boolean(shape.extras),
    used: files.length,
    files,
    hasFiles: files.length > 0,
    mayDelete: can(manager, `${kind}.delete`) && files.length === 0,
  });
}

export async function taxonomySave(environment, root, manager, kind, slug, form) {
  const shape = KINDS[kind];

  if (!can(manager, `${kind}.edit`)) {
    return refuse(`change ${shape.label.toLowerCase()}`);
  }

  const database = environment.CATALOGUE;
  const wanted = slugFrom(form, "slug", ["name"]) ?? slug;
  const name = textFrom(form, "name");

  if (!name) {
    return taxonomyView(environment, root, manager, kind, slug, "A name is required.", null);
  }

  if (wanted !== slug) {
    const clash = await database.prepare(`SELECT 1 FROM ${shape.table} WHERE slug = ?`).bind(wanted).first();

    if (clash) {
      return taxonomyView(environment, root, manager, kind, slug, `${wanted} is already taken.`, null);
    }

    await database
      .prepare(`
        INSERT INTO ${shape.table} (slug, name${(shape.extras ?? []).map((one) => `, ${one.name}`).join("")}, sort_order)
        SELECT ?, name${(shape.extras ?? []).map((one) => `, ${one.name}`).join("")}, sort_order
        FROM ${shape.table} WHERE slug = ?`)
      .bind(wanted, slug)
      .run();
    await database
      .prepare(`UPDATE ${shape.countTable} SET ${shape.countColumn} = ? WHERE ${shape.countColumn} = ?`)
      .bind(wanted, slug)
      .run();
    await database.prepare(`DELETE FROM ${shape.table} WHERE slug = ?`).bind(slug).run();
  }

  const extras = shape.extras ?? [];
  const sets = extras.map((one) => `, ${one.name} = ?`).join("");
  const filled = extras.map((one) => textFrom(form, one.name) ?? grownExtra(one.name, name));

  await database
    .prepare(`UPDATE ${shape.table} SET name = ?${sets} WHERE slug = ?`)
    .bind(name, ...filled, wanted)
    .run();
  await noteChange(database, manager, `${kind}:${wanted}`, "updated", slug !== wanted ? `renamed from ${slug}` : null);

  return goTo(`${root}/${kind}/${wanted}?saved=Saved.`);
}

export async function taxonomyCreate(environment, root, manager, kind, form) {
  const shape = KINDS[kind];

  if (!can(manager, `${kind}.create`)) {
    return refuse(`add ${shape.label.toLowerCase()}`);
  }

  const database = environment.CATALOGUE;
  const slug = slugFrom(form, "slug", ["name"]);
  const name = textFrom(form, "name");

  if (!slug || !name) {
    return goTo(`${root}/${kind}`);
  }

  const extras = shape.extras ?? [];
  const columns = extras.map((one) => one.name);
  const filled = columns.map((one) => textFrom(form, one) ?? grownExtra(one, name));

  await database
    .prepare(`
      INSERT INTO ${shape.table} (slug, name${columns.map((one) => `, ${one}`).join("")}, sort_order)
      VALUES (?, ?${columns.map(() => ", ?").join("")}, 9999) ON CONFLICT(slug) DO NOTHING`)
    .bind(slug, name, ...filled)
    .run();

  const rows = await rowsOf(database.prepare(`SELECT slug FROM ${shape.table} ORDER BY sort_order, name`));
  let position = 10;

  for (const row of rows) {
    await database.prepare(`UPDATE ${shape.table} SET sort_order = ? WHERE slug = ?`).bind(position, row.slug).run();
    position += 10;
  }

  await noteChange(database, manager, `${kind}:${slug}`, "created", name);

  return goTo(`${root}/${kind}/${slug}?saved=Created.`);
}

export async function taxonomyDelete(environment, root, manager, kind, slug) {
  const shape = KINDS[kind];

  if (!can(manager, `${kind}.delete`)) {
    return refuse(`delete ${shape.label.toLowerCase()}`);
  }

  const database = environment.CATALOGUE;
  const counted = await database
    .prepare(`SELECT COUNT(*) AS held FROM ${shape.countTable} WHERE ${shape.countColumn} = ?`)
    .bind(slug)
    .first();

  if ((counted?.held ?? 0) > 0) {
    return taxonomyView(environment, root, manager, kind, slug,
      `${counted.held} files still point at this.`, null);
  }

  await database.prepare(`DELETE FROM ${shape.table} WHERE slug = ?`).bind(slug).run();
  await noteChange(database, manager, `${kind}:${slug}`, "deleted", null);

  return goTo(`${root}/${kind}?saved=Deleted.`);
}
