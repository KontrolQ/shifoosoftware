import { describedSize, extensionOf, tidyFileType } from "../rendering.js";
import { plain, rendered } from "../markdown.js";
import { can, refuse } from "./permissions.js";
import { dropLooseHotlinks } from "./hotlinks.js";
import {
  LARGEST_UPLOAD_BYTES,
  SIZE_UNITS,
  SPEED_UNITS,
  algorithmFor,
  dateFieldFor,
  dateFrom,
  digestOf,
  goTo,
  htmlPage,
  measureFieldFor,
  measureFrom,
  measuredObject,
  movedObject,
  noteChange,
  numberFrom,
  rowsOf,
  slugFrom,
  slugOf,
  textFrom,
} from "./shared.js";
import { applyMatch } from "../searching.js";
import { filesFor } from "../storage/bucket.js";

const STEP = 10;

export function objectPathFor(categorySlug, softwareSlug, versionSlug, fileSlug, extension) {
  return `${categorySlug}/${softwareSlug}/${versionSlug}/${fileSlug}${extension ?? ""}`;
}

// The public icon route only serves published titles, so the admin previews the source itself.
export function iconPreviewFor(root, held) {
  if (held.icon_hotlink_slug) {
    return `/hotlink/${held.icon_hotlink_slug}`;
  }

  return held.icon_key ? `${root}/bucket/fetch?key=${encodeURIComponent(held.icon_key)}` : null;
}

export function iconPathFor(categorySlug, softwareSlug, extension) {
  return `icons/${categorySlug}/${softwareSlug}${extension ?? ".png"}`;
}

async function typeNameFor(database, slug) {
  if (!slug) {
    return "";
  }

  const held = await database
    .prepare("SELECT name, extension FROM file_types WHERE slug = ?")
    .bind(slug)
    .first();

  return tidyFileType(held?.extension ?? held?.name ?? "");
}

async function renumber(database, table, where, binding, shape = {}) {
  const key = shape.key ?? "slug";
  const order = shape.order ?? "name";

  const rows = await rowsOf(
    database
      .prepare(`SELECT ${key} AS handle FROM ${table} ${where} ORDER BY sort_order, ${order}`)
      .bind(...binding)
  );

  let position = STEP;

  for (const row of rows) {
    await database
      .prepare(`UPDATE ${table} SET sort_order = ? WHERE ${key} = ?`)
      .bind(position, row.handle)
      .run();

    position += STEP;
  }
}


export async function categoryView(environment, root, manager, slug, saved) {
  const database = environment.CATALOGUE;

  const held = await database.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const software = await rowsOf(
    database
      .prepare(`
        SELECT slug, name, publisher_names AS publisher, published, sort_order,
               version_count AS versions
        FROM catalogue_software WHERE category_slug = ? ORDER BY sort_order, name`)
      .bind(slug)
  );

  return htmlPage(database, "browse-category", {
    root,
    manager,
    saved,
    title: held.name,
    heading: held.name,
    subheading: held.slug,
    atCategories: true,
    category: held,
    here: `${root}/browse/${held.slug}`,
    summaryHtml: rendered(held.summary),
    software,
    hasSoftware: software.length > 0,
    mayEdit: can(manager, "categories.edit"),
    mayAddSoftware: can(manager, "software.create"),
  });
}

export async function categoryEdit(environment, root, manager, slug, message) {
  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  return htmlPage(database, "edit-category", {
    root,
    manager,
    message,
    title: `Edit ${held.name}`,
    heading: held.name,
    subheading: "editing",
    atCategories: true,
    category: held,
    mayDelete: can(manager, "categories.delete"),
  });
}

export async function categorySave(environment, root, manager, slug, form) {
  if (!can(manager, "categories.edit")) {
    return refuse("edit categories");
  }

  const database = environment.CATALOGUE;
  const wanted = slugFrom(form, "slug", ["name"]) ?? slug;
  const name = textFrom(form, "name");

  if (!name) {
    return categoryEdit(environment, root, manager, slug, "A name is required.");
  }

  if (wanted !== slug) {
    const clash = await database.prepare("SELECT 1 FROM categories WHERE slug = ?").bind(wanted).first();

    if (clash) {
      return categoryEdit(environment, root, manager, slug, `${wanted} is already taken.`);
    }

    await database.prepare("INSERT INTO categories (slug, name, summary, sort_order) SELECT ?, name, summary, sort_order FROM categories WHERE slug = ?")
      .bind(wanted, slug)
      .run();
    await database.prepare("UPDATE software SET category = ? WHERE category = ?").bind(wanted, slug).run();
    await database.prepare("DELETE FROM categories WHERE slug = ?").bind(slug).run();
  }

  await database
    .prepare("UPDATE categories SET name = ?, summary = ? WHERE slug = ?")
    .bind(name, textFrom(form, "summary"), wanted)
    .run();

  await noteChange(database, manager, `path:${wanted}`, "updated", slug !== wanted ? `renamed from ${slug}` : null);

  return goTo(`${root}/categories/${wanted}?saved=Category saved.`);
}

export async function categoryCreate(environment, root, manager, form) {
  if (!can(manager, "categories.create")) {
    return refuse("create categories");
  }

  const database = environment.CATALOGUE;
  const slug = slugFrom(form, "slug", ["name"]);
  const name = textFrom(form, "name");

  if (!slug || !name) {
    return goTo(`${root}/categories`);
  }

  await database
    .prepare("INSERT INTO categories (slug, name, summary, sort_order) VALUES (?, ?, ?, 9999) ON CONFLICT(slug) DO NOTHING")
    .bind(slug, name, textFrom(form, "summary"))
    .run();

  await renumber(database, "categories", "", []);
  await noteChange(database, manager, `path:${slug}`, "created", name);

  return goTo(`${root}/categories/${slug}?saved=Category created.`);
}

export async function categoryDelete(environment, root, manager, slug) {
  if (!can(manager, "categories.delete")) {
    return refuse("delete categories");
  }

  const database = environment.CATALOGUE;
  const counted = await database.prepare("SELECT COUNT(*) AS held FROM software WHERE category = ?").bind(slug).first();

  if ((counted?.held ?? 0) > 0) {
    return categoryEdit(environment, root, manager, slug, `${counted.held} titles still sit in this category.`);
  }

  await database.prepare("DELETE FROM categories WHERE slug = ?").bind(slug).run();
  await noteChange(database, manager, `path:${slug}`, "deleted", null);

  return goTo(`${root}/categories?saved=Category deleted.`);
}

export async function softwareView(environment, root, manager, slug, saved) {
  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM software WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const category = await database.prepare("SELECT slug, name FROM categories WHERE slug = ?").bind(held.category).first();

  const versions = await rowsOf(
    database
      .prepare(`
        SELECT v.id, v.slug, v.version, v.released_on, v.notes, v.sort_order,
               (SELECT COUNT(*) FROM files f WHERE f.version_id = v.id) AS files
        FROM versions v WHERE v.software_slug = ? ORDER BY v.sort_order, v.version`)
      .bind(slug)
  );

  return htmlPage(database, "browse-software", {
    root,
    manager,
    saved,
    title: held.name,
    heading: held.name,
    subheading: held.slug,
    atSoftware: true,
    software: held,
    here: `${root}/browse/${held.category}/${held.slug}`,
    descriptionHtml: rendered(held.description),
    category,
    iconHref: iconPreviewFor(root, held),
    isLive: held.published === 1,
    versions: versions.map((row) => ({ ...row, blurb: plain(row.notes, 120) })),
    hasVersions: versions.length > 0,
    mayEdit: can(manager, "software.edit"),
    mayAddVersion: can(manager, "versions.create"),
  });
}

export async function softwareEdit(environment, root, manager, slug, message) {
  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM software WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const categories = await rowsOf(database.prepare("SELECT slug, name FROM categories ORDER BY sort_order, name"));

  const joined = (table, column) => rowsOf(
    database
      .prepare(`
        SELECT t.slug, t.name FROM ${column}s t JOIN ${table} j ON j.${column}_slug = t.slug
        WHERE j.software_slug = ?`)
      .bind(slug)
  );

  const publishers = await joined("software_publishers", "publisher");
  const platforms = await joined("software_platforms", "platform");
  const interfaces = await joined("software_interfaces", "interface");

  const processor = held.minimum_cpu_slug
    ? await database.prepare("SELECT slug, name FROM processors WHERE slug = ?").bind(held.minimum_cpu_slug).first()
    : null;

  const linkedIcon = held.icon_hotlink_slug
    ? await database.prepare("SELECT slug, name FROM hotlinks WHERE slug = ?").bind(held.icon_hotlink_slug).first()
    : null;

  const labelled = (rows) => JSON.stringify(Object.fromEntries(rows.map((one) => [one.slug, one.name])));

  return htmlPage(database, "edit-software", {
    root,
    manager,
    message,
    title: `Edit ${held.name}`,
    heading: held.name,
    subheading: "editing",
    atSoftware: true,
    software: held,
    here: `${root}/browse/${held.category}/${held.slug}`,
    isLive: held.published === 1,
    categoryLabels: labelled(categories),
    iconPick: {
      objectField: "icon_key",
      hotlinkField: "icon_hotlink_slug",
      objectValue: held.icon_key ?? "",
      hotlinkValue: held.icon_hotlink_slug ?? "",
      opener: "Choose an icon",
      prefix: `icons/${held.category}`,
      labels: JSON.stringify({
        ...(held.icon_key ? { [held.icon_key]: held.icon_key } : {}),
        ...(linkedIcon ? { [linkedIcon.slug]: linkedIcon.name } : {}),
      }),
    },
    publisherValue: publishers.map((one) => one.slug).join(","),
    publisherLabels: labelled(publishers),
    platformValue: platforms.map((one) => one.slug).join(","),
    platformLabels: labelled(platforms),
    interfaceValue: interfaces.map((one) => one.slug).join(","),
    interfaceLabels: labelled(interfaces),
    processorLabels: JSON.stringify(processor ? { [processor.slug]: processor.name } : {}),
    cpuSpeed: measureFieldFor("minimum_cpu_speed", "Minimum clock speed",
      held.minimum_cpu_speed, held.minimum_cpu_speed_unit, SPEED_UNITS),
    ram: measureFieldFor("minimum_ram", "Minimum RAM",
      held.minimum_ram_size, held.minimum_ram_unit, SIZE_UNITS),
    disk: measureFieldFor("minimum_disk", "Free disk space",
      held.minimum_disk_size, held.minimum_disk_unit, SIZE_UNITS),
    releasedOn: dateFieldFor("released_on", "First released", held.released_on),
    endOfLife: dateFieldFor("end_of_life", "End of life", held.end_of_life),
    mayDelete: can(manager, "software.delete"),
  });
}

export async function softwareSave(environment, root, manager, slug, form) {
  if (!can(manager, "software.edit")) {
    return refuse("edit software");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM software WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/software`);
  }

  const name = textFrom(form, "name");
  const category = textFrom(form, "category") ?? held.category;
  const wanted = slugFrom(form, "slug", ["name"]) ?? slug;

  if (!name) {
    return softwareEdit(environment, root, manager, slug, "A name is required.");
  }

  if (wanted !== slug) {
    const clash = await database.prepare("SELECT 1 AS held FROM software WHERE slug = ?").bind(wanted).first();

    if (clash) {
      return softwareEdit(environment, root, manager, slug, `${wanted} is already taken.`);
    }
  }

  const hotlinkedIcon = textFrom(form, "icon_hotlink_slug");
  const iconKey = hotlinkedIcon ? null : textFrom(form, "icon_key");

  const speed = measureFrom(form, "minimum_cpu_speed");
  const ram = measureFrom(form, "minimum_ram");
  const disk = measureFrom(form, "minimum_disk");

  await database
    .prepare(`
      UPDATE software SET slug = ?, name = ?, category = ?, description = ?, homepage = ?,
        icon_key = ?, icon_hotlink_slug = ?, released_on = ?, end_of_life = ?, minimum_cpu_slug = ?,
        minimum_cpu_speed = ?, minimum_cpu_speed_unit = ?, minimum_ram_size = ?, minimum_ram_unit = ?,
        minimum_disk_size = ?, minimum_disk_unit = ?, published = ?, updated_at = ?
      WHERE slug = ?`)
    .bind(wanted, name, category, textFrom(form, "description"), textFrom(form, "homepage"),
          iconKey, hotlinkedIcon ?? null, dateFrom(form, "released_on"), dateFrom(form, "end_of_life"),
          textFrom(form, "minimum_cpu_slug"),
          speed.size, speed.unit, ram.size, ram.unit, disk.size, disk.unit,
          textFrom(form, "published") === "0" ? 0 : 1, new Date().toISOString(), slug)
    .run();

  if (wanted !== slug) {
    for (const table of ["versions", "software_publishers", "software_platforms", "software_interfaces"]) {
      await database
        .prepare(`UPDATE ${table} SET software_slug = ? WHERE software_slug = ?`)
        .bind(wanted, slug)
        .run();
    }
  }

  await relink(database, "software_publishers", "software_slug", wanted, "publisher_slug", form.get("publishers"));
  await relink(database, "software_platforms", "software_slug", wanted, "platform_slug", form.get("platforms"));
  await relink(database, "software_interfaces", "software_slug", wanted, "interface_slug", form.get("interfaces"));

  await noteChange(database, manager, `path:${category}/${wanted}`, "updated",
    slug !== wanted ? `renamed from ${slug}` : null);

  return goTo(`${root}/browse/${category}/${wanted}?saved=Saved.`);
}

export async function relink(database, table, keyColumn, key, valueColumn, offered) {
  const wanted = String(offered ?? "").split(",").map((one) => one.trim()).filter(Boolean);

  await database.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`).bind(key).run();

  for (const value of wanted) {
    await database
      .prepare(`INSERT INTO ${table} (${keyColumn}, ${valueColumn}) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .bind(key, value)
      .run();
  }
}

export async function softwareCreate(environment, root, manager, form) {
  if (!can(manager, "software.create")) {
    return refuse("create software");
  }

  const database = environment.CATALOGUE;
  const slug = slugFrom(form, "slug", ["name"]);
  const name = textFrom(form, "name");
  const category = textFrom(form, "category");

  if (!slug || !name || !category) {
    return goTo(`${root}/categories/${category ?? ""}`);
  }

  const now = new Date().toISOString();
  const hotlinkedIcon = textFrom(form, "icon_hotlink_slug");
  const iconKey = hotlinkedIcon ? null : textFrom(form, "icon_key");

  await database
    .prepare(`
      INSERT INTO software (slug, name, category, homepage, description, icon_key, icon_hotlink_slug,
                            released_on, end_of_life, minimum_cpu_slug, minimum_cpu_speed,
                            minimum_cpu_speed_unit, minimum_ram_size, minimum_ram_unit,
                            minimum_disk_size, minimum_disk_unit,
                            published, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9999, ?, ?) ON CONFLICT(slug) DO NOTHING`)
    .bind(slug, name, category, textFrom(form, "homepage"), textFrom(form, "description"),
          iconKey, hotlinkedIcon ?? null, dateFrom(form, "released_on"), dateFrom(form, "end_of_life"),
          textFrom(form, "minimum_cpu_slug"),
          measureFrom(form, "minimum_cpu_speed").size, measureFrom(form, "minimum_cpu_speed").unit,
          measureFrom(form, "minimum_ram").size, measureFrom(form, "minimum_ram").unit,
          measureFrom(form, "minimum_disk").size, measureFrom(form, "minimum_disk").unit,
          textFrom(form, "published") === "1" ? 1 : 0, now, now)
    .run();

  await relink(database, "software_publishers", "software_slug", slug, "publisher_slug", form.get("publishers"));
  await relink(database, "software_platforms", "software_slug", slug, "platform_slug", form.get("platforms"));
  await relink(database, "software_interfaces", "software_slug", slug, "interface_slug", form.get("interfaces"));

  await renumber(database, "software", "WHERE category = ?", [category]);
  await noteChange(database, manager, `path:${category}/${slug}`, "created", name);

  return goTo(`${root}/browse/${category}/${slug}?saved=Created. It is hidden until you publish it.`);
}

export async function softwareDelete(environment, root, manager, slug) {
  if (!can(manager, "software.delete")) {
    return refuse("delete software");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT category, icon_key FROM software WHERE slug = ?").bind(slug).first();

  const carried = await rowsOf(
    database
      .prepare(`
        SELECT f.object_key FROM files f JOIN versions v ON v.id = f.version_id
        WHERE v.software_slug = ?`)
      .bind(slug)
  );

  for (const file of carried) {
    await filesFor(environment).delete(file.object_key);
  }

  if (held?.icon_key) {
    await filesFor(environment).delete(held.icon_key);
  }

  await database.prepare("DELETE FROM software WHERE slug = ?").bind(slug).run();
  await dropLooseHotlinks(database, manager);
  await noteChange(database, manager, `path:${category}/${slug}`, "deleted", null);

  return goTo(`${root}/categories/${held?.category ?? ""}?saved=Deleted.`);
}

export async function versionView(environment, root, manager, identifier, saved) {
  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT v.*, s.name AS software_name, s.category
      FROM versions v JOIN software s ON s.slug = v.software_slug
      WHERE v.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const files = await rowsOf(
    database
      .prepare(`
        SELECT id, slug, display_name, file_type, size_bytes, published, downloads,
               object_key, hotlink_slug, hotlink_name, is_external, language_names AS language_name
        FROM catalogue_files
        WHERE version_id = ? ORDER BY sort_order, display_name`)
      .bind(held.id)
  );

  return htmlPage(database, "browse-version", {
    root,
    manager,
    saved,
    title: `${held.software_name} ${held.version}`,
    heading: `${held.software_name} ${held.version}`,
    subheading: held.released_on ?? "",
    atVersions: true,
    version: held,
    here: `${root}/browse/${held.category}/${held.software_slug}/${held.slug}`,
    notesHtml: rendered(held.notes),
    files: files.map((one) => ({
      ...one,
      size: describedSize(one.size_bytes),
      published: one.published === 1,
      is_external: one.is_external === 1,
      path: `${held.category}/${held.software_slug}/${held.slug}/${one.slug}`,
    })),
    hasFiles: files.length > 0,
    mayEdit: can(manager, "versions.edit"),
    mayAddFile: can(manager, "files.create"),
  });
}

async function versionIdFor(database, softwareSlug, versionSlug) {
  const held = await database
    .prepare("SELECT id FROM versions WHERE software_slug = ? AND slug = ?")
    .bind(softwareSlug, versionSlug)
    .first();

  return held?.id ?? 0;
}

export async function versionViewBySlug(environment, root, manager, softwareSlug, versionSlug, saved) {
  return versionView(environment, root, manager,
    await versionIdFor(environment.CATALOGUE, softwareSlug, versionSlug), saved);
}

export async function versionEditBySlug(environment, root, manager, softwareSlug, versionSlug) {
  return versionEdit(environment, root, manager,
    await versionIdFor(environment.CATALOGUE, softwareSlug, versionSlug), null);
}

export async function versionEdit(environment, root, manager, identifier, message) {
  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT v.*, s.name AS software_name, s.category FROM versions v
      JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const architecture = held.architecture_slug
    ? await database
        .prepare("SELECT slug, name FROM architectures WHERE slug = ?")
        .bind(held.architecture_slug)
        .first()
    : null;

  const platforms = await rowsOf(
    database
      .prepare(`
        SELECT p.slug, p.name FROM version_platforms vp
        JOIN platforms p ON p.slug = vp.platform_slug
        WHERE vp.version_id = ? ORDER BY p.sort_order, p.name`)
      .bind(held.id)
  );

  const processor = held.minimum_cpu_slug
    ? await database.prepare("SELECT slug, name FROM processors WHERE slug = ?").bind(held.minimum_cpu_slug).first()
    : null;

  const shots = await rowsOf(
    database
      .prepare(`
        SELECT vs.slug, vs.caption, vs.object_key, vs.hotlink_slug, h.name AS hotlink_name
        FROM version_screenshots vs
        LEFT JOIN hotlinks h ON h.slug = vs.hotlink_slug
        WHERE vs.version_id = ? ORDER BY vs.sort_order, vs.slug`)
      .bind(held.id)
  );

  const here = `${root}/browse/${held.category}/${held.software_slug}/${held.slug}`;

  return htmlPage(database, "edit-version", {
    root,
    manager,
    message,
    title: `Edit ${held.version}`,
    heading: `${held.software_name} ${held.version}`,
    subheading: "editing",
    atVersions: true,
    here,
    version: held,
    platformValue: platforms.map((one) => one.slug).join(","),
    platformLabels: JSON.stringify(Object.fromEntries(platforms.map((one) => [one.slug, one.name]))),
    architectureLabels: JSON.stringify(architecture ? { [architecture.slug]: architecture.name } : {}),
    processorLabels: JSON.stringify(processor ? { [processor.slug]: processor.name } : {}),
    cpuSpeed: measureFieldFor("minimum_cpu_speed", "Minimum clock speed",
      held.minimum_cpu_speed, held.minimum_cpu_speed_unit, SPEED_UNITS),
    ram: measureFieldFor("minimum_ram", "Minimum RAM",
      held.minimum_ram_size, held.minimum_ram_unit, SIZE_UNITS),
    disk: measureFieldFor("minimum_disk", "Free disk space",
      held.minimum_disk_size, held.minimum_disk_unit, SIZE_UNITS),
    releasedOn: dateFieldFor("released_on", "Released on", held.released_on),
    screenshots: shots.map((one) => ({
      ...one,
      comesFrom: one.hotlink_slug ? `hotlink · ${one.hotlink_name}` : one.object_key,
    })),
    hasScreenshots: shots.length > 0,
    shotPick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: "",
      hotlinkValue: "",
      opener: "Choose a picture",
      prefix: `shots/${held.category}/${held.software_slug}/${held.slug}`,
      labels: "{}",
    },
    mayDelete: can(manager, "versions.delete"),
  });
}

export async function versionSave(environment, root, manager, identifier, form) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM versions WHERE id = ?").bind(Number(identifier)).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const owner = await database
    .prepare("SELECT category FROM software WHERE slug = ?")
    .bind(held.software_slug)
    .first();

  const wanted = textFrom(form, "version");

  if (!wanted) {
    return versionEdit(environment, root, manager, identifier, "A version number is required.");
  }

  if (wanted !== held.version) {
    const carried = await rowsOf(
      database
        .prepare(`
          SELECT id, slug, file_type_slug, object_key FROM files
          WHERE version_id = ? AND object_key IS NOT NULL`)
        .bind(held.id)
    );

    for (const file of carried) {
      const moved = await movedObject(filesFor(environment), file.object_key,
        objectPathFor(owner.category, held.software_slug, slugFrom(form, "slug", ["version"]) ?? slugOf(wanted),
          file.slug, await typeNameFor(database, file.file_type_slug)));

      await database.prepare("UPDATE files SET object_key = ? WHERE id = ?").bind(moved, file.id).run();
    }
  }

  await database
    .prepare(`
      UPDATE versions SET version = ?, slug = ?, architecture_slug = ?,
        released_on = ?, notes = ?, minimum_cpu_slug = ?, minimum_cpu_speed = ?,
        minimum_cpu_speed_unit = ?, minimum_ram_size = ?, minimum_ram_unit = ?,
        minimum_disk_size = ?, minimum_disk_unit = ? WHERE id = ?`)
    .bind(wanted, slugFrom(form, "slug", ["version"]) ?? slugOf(wanted),
          textFrom(form, "architecture_slug"),
          dateFrom(form, "released_on"), textFrom(form, "notes"),
          textFrom(form, "minimum_cpu_slug"),
          measureFrom(form, "minimum_cpu_speed").size, measureFrom(form, "minimum_cpu_speed").unit,
          measureFrom(form, "minimum_ram").size, measureFrom(form, "minimum_ram").unit,
          measureFrom(form, "minimum_disk").size, measureFrom(form, "minimum_disk").unit,
          held.id)
    .run();

  await relink(database, "version_platforms", "version_id", held.id, "platform_slug", form.get("platforms"));
  await noteChange(database, manager, `path:${owner.category}/${held.software_slug}/${slugFrom(form, "slug", ["version"]) ?? slugOf(wanted)}`, "updated", null);

  return goTo(
    `${root}/browse/${owner.category}/${held.software_slug}/` +
    `${slugFrom(form, "slug", ["version"]) ?? slugOf(wanted)}?saved=Saved.`
  );
}

export async function versionCreate(environment, root, manager, form) {
  if (!can(manager, "versions.create")) {
    return refuse("create versions");
  }

  const database = environment.CATALOGUE;
  const slug = textFrom(form, "software_slug");
  const version = textFrom(form, "version");
  const owner = await database.prepare("SELECT category FROM software WHERE slug = ?").bind(slug).first();

  if (!slug || !version) {
    return goTo(`${root}/software`);
  }

  const versionSlug = slugFrom(form, "slug", ["version"]) ?? slugOf(version);

  await database
    .prepare(`
      INSERT INTO versions (software_slug, slug, version, architecture_slug,
                            released_on, notes, minimum_cpu_slug, minimum_cpu_speed,
                            minimum_cpu_speed_unit, minimum_ram_size, minimum_ram_unit,
                            minimum_disk_size, minimum_disk_unit, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9999)
      ON CONFLICT(software_slug, slug) DO NOTHING`)
    .bind(slug, versionSlug, version, textFrom(form, "architecture_slug"),
          dateFrom(form, "released_on"), textFrom(form, "notes"),
          textFrom(form, "minimum_cpu_slug"),
          measureFrom(form, "minimum_cpu_speed").size, measureFrom(form, "minimum_cpu_speed").unit,
          measureFrom(form, "minimum_ram").size, measureFrom(form, "minimum_ram").unit,
          measureFrom(form, "minimum_disk").size, measureFrom(form, "minimum_disk").unit)
    .run();

  await renumber(database, "versions", "WHERE software_slug = ?", [slug], { key: "id", order: "version" });

  const held = await database
    .prepare("SELECT id FROM versions WHERE software_slug = ? AND slug = ?")
    .bind(slug, versionSlug)
    .first();

  await relink(database, "version_platforms", "version_id", held.id, "platform_slug", form.get("platforms"));
  await noteChange(database, manager, `path:${owner?.category ?? ""}/${slug}/${versionSlug}`, "created", null);

  return goTo(
    `${root}/browse/${owner.category}/${slug}/${versionSlug}?saved=Version created.`
  );
}

export async function versionDelete(environment, root, manager, identifier) {
  if (!can(manager, "versions.delete")) {
    return refuse("delete versions");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM versions WHERE id = ?").bind(Number(identifier)).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const owner = await database
    .prepare("SELECT category FROM software WHERE slug = ?")
    .bind(held.software_slug)
    .first();

  const carried = await rowsOf(
    database
      .prepare("SELECT object_key FROM files WHERE version_id = ? AND object_key IS NOT NULL")
      .bind(held.id)
  );

  for (const file of carried) {
    await filesFor(environment).delete(file.object_key);
  }

  await database.prepare("DELETE FROM versions WHERE id = ?").bind(held.id).run();
  await dropLooseHotlinks(database, manager);
  await noteChange(database, manager, `version:${held.software_slug} ${held.version}`, "deleted", null);

  return goTo(`${root}/browse/${owner.category}/${held.software_slug}?saved=Version deleted.`);
}

export async function fileView(environment, root, manager, identifier, saved) {
  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT *, category_slug AS category FROM catalogue_files WHERE id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const languages = await rowsOf(
    database
      .prepare(`
        SELECT l.name FROM languages l JOIN file_languages fl ON fl.language_slug = l.slug
        WHERE fl.file_id = ? ORDER BY l.sort_order, l.name`)
      .bind(held.id)
  );

  const hotlinked = Boolean(held.hotlink_slug);
  const present = hotlinked ? null : await filesFor(environment).head(held.object_key);

  return htmlPage(database, "browse-file", {
    root,
    manager,
    saved,
    title: held.display_name,
    heading: held.display_name,
    subheading: `${held.software_name} ${held.version}`,
    atFiles: true,
    file: {
      ...held,
      size: describedSize(held.size_bytes),
      platform_names: held.platform_names ?? "",
      language_name: languages.map((one) => one.name).join(", "),
    },
    here: `${root}/browse/${held.category}/${held.software_slug}/${held.version_slug}/${held.slug}`,
    notesHtml: rendered(held.notes),
    isLive: held.published === 1,
    hotlinked,
    inBucket: Boolean(present),
    mayEdit: can(manager, "files.edit"),
  });
}

export async function fileEdit(environment, root, manager, identifier, message) {
  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT *, category_slug AS category FROM catalogue_files WHERE id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const versions = await rowsOf(
    database
      .prepare("SELECT id, slug, version FROM versions WHERE software_slug = ? ORDER BY sort_order")
      .bind(held.software_slug)
  );

  const languages = await rowsOf(
    database
      .prepare(`
        SELECT l.slug, l.name FROM languages l JOIN file_languages fl ON fl.language_slug = l.slug
        WHERE fl.file_id = ?`)
      .bind(held.id)
  );

  const platforms = await rowsOf(
    database
      .prepare(`
        SELECT p.slug, p.name FROM platforms p JOIN file_platforms fp ON fp.platform_slug = p.slug
        WHERE fp.file_id = ? ORDER BY p.sort_order, p.name`)
      .bind(held.id)
  );

  const linked = held.hotlink_slug
    ? await database.prepare("SELECT slug, name FROM hotlinks WHERE slug = ?").bind(held.hotlink_slug).first()
    : null;

  // the file's own architecture, not the one it inherits from its release
  const architecture = held.own_architecture_slug
    ? await database
        .prepare("SELECT slug, name FROM architectures WHERE slug = ?")
        .bind(held.own_architecture_slug)
        .first()
    : null;

  const labelled = (rows) => JSON.stringify(Object.fromEntries(rows.map((one) => [one.slug, one.name])));

  return htmlPage(database, "edit-file", {
    root,
    manager,
    message,
    title: `Edit ${held.display_name}`,
    heading: held.display_name,
    subheading: "editing",
    atCategories: true,
    file: held,
    here: `${root}/browse/${held.category}/${held.software_slug}/${held.version_slug}/${held.slug}`,
    architectureLabels: JSON.stringify(architecture ? { [architecture.slug]: architecture.name } : {}),
    filePick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: held.object_key ?? "",
      hotlinkValue: held.hotlink_slug ?? "",
      opener: "Choose a file",
      prefix: `${held.category}/${held.software_slug}/${held.version_slug}`,
      labels: JSON.stringify({
        ...(held.object_key ? { [held.object_key]: held.object_key } : {}),
        ...(linked ? { [linked.slug]: linked.name } : {}),
      }),
    },
    isLive: held.published === 1,
    isHotlinked: Boolean(held.hotlink_slug),
    platformValue: platforms.map((one) => one.slug).join(","),
    platformLabels: labelled(platforms),
    fileTypeLabels: JSON.stringify(
      held.file_type_slug && held.file_type ? { [held.file_type_slug]: held.file_type } : {}
    ),
    versionPath: `${held.software_slug}/${held.version_slug}`,
    versionLabels: JSON.stringify(Object.fromEntries(
      versions.map((one) => [`${held.software_slug}/${one.slug}`, `${held.software_name} ${one.version}`])
    )),
    languageValue: languages.map((one) => one.slug).join(","),
    languageLabels: labelled(languages),
    mayDelete: can(manager, "files.delete"),
  });
}

export async function fileSave(environment, root, manager, identifier, form) {
  if (!can(manager, "files.edit")) {
    return refuse("edit files");
  }

  const database = environment.CATALOGUE;

  const held = await database
    .prepare("SELECT f.*, v.software_slug FROM files f JOIN versions v ON v.id = f.version_id WHERE f.id = ?")
    .bind(Number(identifier))
    .first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  const wantedPath = textFrom(form, "version_path");
  const [wantedSoftware, wantedVersion] = (wantedPath ?? "").split("/");

  const landing = (wantedPath
    ? await database
        .prepare("SELECT id, version, software_slug FROM versions WHERE software_slug = ? AND slug = ?")
        .bind(wantedSoftware, wantedVersion)
        .first()
    : null) ?? await database
      .prepare("SELECT id, version, software_slug FROM versions WHERE id = ?")
      .bind(held.version_id)
      .first();

  const displayName = textFrom(form, "display_name") ?? held.display_name;
  const wantedSlug = slugFrom(form, "slug", ["display_name"]) ?? held.slug;
  const fileTypeSlug = textFrom(form, "file_type_slug");
  const fileType = await typeNameFor(database, fileTypeSlug);
  const hotlinkSlug = textFrom(form, "hotlink_slug");
  const objectKey = hotlinkSlug
    ? null
    : `${landing.software_slug}/${landing.version}/${wantedSlug}${fileType}`;

  let sizeBytes = held.size_bytes;
  let digest = held.checksum;
  let algorithm = held.checksum_algorithm;

  if (hotlinkSlug) {
    // the link carries the size; keeping a copy here only lets the two drift apart
    sizeBytes = null;
    digest = textFrom(form, "checksum");
    algorithm = algorithmFor(digest);
  } else {
    const offered = textFrom(form, "object_key");

    if (offered && offered !== held.object_key) {
      await movedObject(filesFor(environment), offered, objectKey);
    } else if (held.object_key && held.object_key !== objectKey) {
      await movedObject(filesFor(environment), held.object_key, objectKey);
    }

    const measured = await measuredObject(filesFor(environment), objectKey);

    sizeBytes = measured?.size ?? held.size_bytes;
    digest = measured?.checksum ?? held.checksum;
    algorithm = measured?.algorithm ?? held.checksum_algorithm;
  }

  await database
    .prepare(`
      UPDATE files SET version_id = ?, slug = ?, display_name = ?, file_type_slug = ?,
        architecture_slug = ?, object_key = ?, hotlink_slug = ?, size_bytes = ?,
        checksum = ?, checksum_algorithm = ?, notes = ?, published = ?
      WHERE id = ?`)
    .bind(landing.id, wantedSlug, displayName, fileTypeSlug ?? null,
          textFrom(form, "architecture_slug"), objectKey, hotlinkSlug ?? null,
          sizeBytes, digest, algorithm, textFrom(form, "notes"),
          textFrom(form, "published") === "0" ? 0 : 1, held.id)
    .run();

  await relink(database, "file_languages", "file_id", held.id, "language_slug", form.get("language"));
  await relink(database, "file_platforms", "file_id", held.id, "platform_slug", form.get("platform"));
  await noteChange(database, manager, `file:${wantedSlug}`, hotlinkSlug ? "hotlinked" : "updated", null);

  const landed = await database
    .prepare("SELECT category_slug, software_slug, version_slug, slug FROM catalogue_files WHERE id = ?")
    .bind(held.id)
    .first();

  return goTo(
    `${root}/browse/${landed.category_slug}/${landed.software_slug}/${landed.version_slug}/${landed.slug}` +
    "?saved=Saved."
  );
}

export async function fileCreate(environment, root, manager, form) {
  if (!can(manager, "files.create")) {
    return refuse("add files");
  }

  const database = environment.CATALOGUE;

  const wantedPath = textFrom(form, "version_path");
  const [wantedSoftware, wantedVersion] = (wantedPath ?? "").split("/");
  const finding = wantedPath
    ? { clause: "v.software_slug = ? AND v.slug = ?", bindings: [wantedSoftware, wantedVersion] }
    : { clause: "v.id = ?", bindings: [numberFrom(form, "version_id", 0)] };

  const belongsTo = await database
    .prepare(`
      SELECT v.id, v.slug, v.version, v.software_slug, s.category AS category_slug
      FROM versions v JOIN software s ON s.slug = v.software_slug WHERE ${finding.clause}`)
    .bind(...finding.bindings)
    .first();

  if (!belongsTo) {
    return goTo(`${root}/files`);
  }

  const objectKey = textFrom(form, "object_key");
  const hotlinkSlug = textFrom(form, "hotlink_slug");

  if (!objectKey && !hotlinkSlug) {
    return versionView(environment, root, manager, belongsTo.id,
      "Choose something from the bucket, add a hotlink, or upload a file.");
  }

  const displayName = textFrom(form, "display_name") ??
    (hotlinkSlug ? hotlinkSlug : String(objectKey).split("/").pop());
  const fileSlug = slugFrom(form, "slug", ["display_name"]) ?? slugOf(displayName);
  const fileTypeSlug = textFrom(form, "file_type_slug");
  const fileType = await typeNameFor(database, fileTypeSlug);

  let sizeBytes = 0;
  let digest = null;
  let restingKey = null;

  if (hotlinkSlug) {
    const linked = await database
      .prepare("SELECT slug FROM hotlinks WHERE slug = ?")
      .bind(hotlinkSlug)
      .first();

    if (!linked) {
      return versionView(environment, root, manager, belongsTo.id, "That hotlink no longer exists.");
    }

    sizeBytes = null;
    digest = textFrom(form, "checksum");
  } else {
    restingKey = objectPathFor(belongsTo.category_slug, belongsTo.software_slug, belongsTo.slug,
      fileSlug, fileType);

    if (objectKey !== restingKey) {
      restingKey = await movedObject(filesFor(environment), objectKey, restingKey);
    }

    const measured = await measuredObject(filesFor(environment), restingKey);

    if (!measured) {
      return versionView(environment, root, manager, belongsTo.id, `Nothing in the bucket at ${restingKey}.`);
    }

    sizeBytes = measured.size;
    digest = measured.checksum;
  }

  await database
    .prepare(`
      INSERT INTO files (version_id, slug, display_name, file_type_slug, architecture_slug,
                         object_key, hotlink_slug, size_bytes, checksum, checksum_algorithm, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(version_id, slug) DO UPDATE SET
        display_name = excluded.display_name, file_type_slug = excluded.file_type_slug,
        architecture_slug = excluded.architecture_slug,
        object_key = excluded.object_key, hotlink_slug = excluded.hotlink_slug,
        size_bytes = excluded.size_bytes, checksum = excluded.checksum,
        checksum_algorithm = excluded.checksum_algorithm`)
    .bind(belongsTo.id, fileSlug, displayName, fileTypeSlug ?? null,
          textFrom(form, "architecture_slug"), restingKey, hotlinkSlug ?? null,
          sizeBytes, digest, algorithmFor(digest), textFrom(form, "notes"))
    .run();

  const made = await database
    .prepare("SELECT id FROM files WHERE version_id = ? AND slug = ?")
    .bind(belongsTo.id, fileSlug)
    .first();

  if (made) {
    await relink(database, "file_languages", "file_id", made.id, "language_slug", form.get("language"));
    await relink(database, "file_platforms", "file_id", made.id, "platform_slug", form.get("platform"));
  }

  await noteChange(database, manager, `file:${fileSlug}`, hotlinkSlug ? "hotlinked" : "added", null);

  return goTo(
    `${root}/browse/${belongsTo.category_slug}/${belongsTo.software_slug}/${belongsTo.slug}/${fileSlug}` +
    "?saved=Added."
  );
}

export async function fileDelete(environment, root, manager, identifier, form) {
  if (!can(manager, "files.delete")) {
    return refuse("delete files");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM files WHERE id = ?").bind(Number(identifier)).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  if (held.object_key && String(form.get("keep_object") ?? "") !== "1") {
    await filesFor(environment).delete(held.object_key);
  }

  await database.prepare("DELETE FROM files WHERE id = ?").bind(held.id).run();
  await dropLooseHotlinks(database, manager);
  await noteChange(database, manager, `file:${held.slug}`, "deleted", null);

  const landed = await database
    .prepare(`
      SELECT v.slug AS version_slug, v.software_slug, s.category FROM versions v
      JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
    .bind(held.version_id)
    .first();

  return goTo(
    `${root}/browse/${landed.category}/${landed.software_slug}/${landed.version_slug}?saved=File deleted.`
  );
}

const VOCABULARIES = {
  platforms: { label: "platforms", flag: "atPlatforms" },
  languages: { label: "languages", flag: "atLanguages" },
  publishers: { label: "publishers", flag: "atPublishers" },
};

export async function reorderPage(environment, root, manager, what, owner) {
  const database = environment.CATALOGUE;

  if (VOCABULARIES[what]) {
    const shape = VOCABULARIES[what];

    const rows = await rowsOf(
      database.prepare(`SELECT slug AS handle, name FROM ${what} ORDER BY sort_order, name`)
    );

    return htmlPage(database, "reorder", {
      root, manager, title: `Reorder ${shape.label}`, heading: `Reorder ${shape.label}`,
      [shape.flag]: true, what, owner: "", rows,
      backHref: `${root}/${what}`, backLabel: shape.label,
    });
  }

  if (what === "categories") {
    const rows = await rowsOf(database.prepare("SELECT slug AS handle, name FROM categories ORDER BY sort_order, name"));

    return htmlPage(database, "reorder", {
      root, manager, title: "Reorder categories", heading: "Reorder categories",
      atCategories: true, what, owner: "", rows, backHref: `${root}/categories`, backLabel: "Categories",
    });
  }

  if (what === "software") {
    const rows = await rowsOf(
      database.prepare("SELECT slug AS handle, name FROM software WHERE category = ? ORDER BY sort_order, name").bind(owner)
    );

    return htmlPage(database, "reorder", {
      root, manager, title: "Reorder titles", heading: "Reorder titles",
      atCategories: true, what, owner, rows, backHref: `${root}/categories/${owner}`, backLabel: "Category",
    });
  }

  const rows = await rowsOf(
    database.prepare("SELECT id AS handle, version AS name FROM versions WHERE software_slug = ? ORDER BY sort_order, version").bind(owner)
  );

  return htmlPage(database, "reorder", {
    root, manager, title: "Reorder versions", heading: "Reorder versions",
    atCategories: true, what, owner, rows, backHref: `${root}/software/${owner}`, backLabel: "Title",
  });
}

export async function reorderSave(environment, root, manager, what, owner, form) {
  const database = environment.CATALOGUE;
  const table = VOCABULARIES[what]
    ? what
    : what === "software" ? "software" : what === "categories" ? "categories" : "versions";
  const column = table === "versions" ? "id" : "slug";
  const order = form.getAll("handle").map(String);

  let position = STEP;

  for (const handle of order) {
    await database
      .prepare(`UPDATE ${table} SET sort_order = ? WHERE ${column} = ?`)
      .bind(position, table === "versions" ? Number(handle) : handle)
      .run();

    position += STEP;
  }

  await noteChange(database, manager, table, "reordered", `${order.length} rows`);

  const back = VOCABULARIES[what]
    ? `${root}/${what}`
    : what === "categories"
      ? `${root}/categories`
      : what === "software"
        ? `${root}/categories/${owner}`
        : `${root}/software/${owner}`;

  return goTo(`${back}?saved=Order saved.`);
}
