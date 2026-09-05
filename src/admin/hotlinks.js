import { describedSize } from "../rendering.js";
import { plain } from "../markdown.js";
import { applyMatch } from "../searching.js";
import { can, refuse } from "./permissions.js";
import {
  byteFieldFor,
  bytesFrom,
  goTo,
  htmlPage,
  namedPath,
  noteChange,
  rowsOf,
  textFrom,
} from "./shared.js";

const CHECK_TIMEOUT = 8000;
const PER_PAGE = 60;

const VIEWS = [
  { key: "all", label: "All", where: "" },
  { key: "used", label: "In use", where: "(file_count + icon_count + screenshot_count) > 0" },
  { key: "loose", label: "Unused", where: "(file_count + icon_count + screenshot_count) = 0" },
  { key: "unsized", label: "No size", where: "(size_bytes IS NULL OR size_bytes = 0)" },
];

const SORTS = [
  { key: "name", label: "Name", clause: "name" },
  { key: "added", label: "Newest", clause: "added_at DESC" },
  { key: "size", label: "Largest", clause: "size_bytes DESC" },
  { key: "used", label: "Most used", clause: "(file_count + icon_count + screenshot_count) DESC, name" },
];

function hostOf(target) {
  try {
    return new URL(target).host;
  } catch (problem) {
    return "malformed";
  }
}

async function reached(url) {
  const stop = AbortSignal.timeout(CHECK_TIMEOUT);

  try {
    const answer = await fetch(url, { method: "HEAD", redirect: "follow", signal: stop });

    if (answer.ok) {
      return { ok: true, said: String(answer.status) };
    }

    // plenty of hosts refuse HEAD but serve the file perfectly well
    const second = await fetch(url, { method: "GET", redirect: "follow", signal: stop });

    return { ok: second.ok, said: String(second.status) };
  } catch (problem) {
    return { ok: false, said: problem.name === "TimeoutError" ? "timed out" : "unreachable" };
  }
}


export async function hotlinkView(environment, root, manager, slug, message, saved) {
  if (!can(manager, "hotlinks.view")) {
    return refuse("see hotlinks");
  }

  const database = environment.CATALOGUE;

  const held = await database
    .prepare("SELECT * FROM catalogue_hotlinks WHERE slug = ?")
    .bind(slug)
    .first();

  if (!held) {
    return goTo(`${root}/hotlinks`);
  }

  const files = await rowsOf(
    database
      .prepare(`
        SELECT display_name, slug, category_slug, software_slug, software_name, version_slug, version
        FROM catalogue_files WHERE hotlink_slug = ? ORDER BY software_name, version`)
      .bind(slug)
  );

  const icons = await rowsOf(
    database
      .prepare("SELECT slug, name, category AS category_slug FROM software WHERE icon_hotlink_slug = ?")
      .bind(slug)
  );

  const shots = await rowsOf(
    database
      .prepare(`
        SELECT vs.slug, vs.caption, v.slug AS version_slug, v.software_slug,
               s.category AS category_slug, s.name AS software_name, v.version
        FROM version_screenshots vs
        JOIN versions v ON v.id = vs.version_id
        JOIN software s ON s.slug = v.software_slug
        WHERE vs.hotlink_slug = ?`)
      .bind(slug)
  );

  const usedBy = [
    ...files.map((row) => ({
      what: "Download",
      label: `${row.software_name} ${row.version} — ${row.display_name}`,
      href: `${root}/browse/${row.category_slug}/${row.software_slug}/${row.version_slug}/${row.slug}`,
    })),
    ...icons.map((row) => ({
      what: "Icon",
      label: row.name,
      href: `${root}/browse/${row.category_slug}/${row.slug}`,
    })),
    ...shots.map((row) => ({
      what: "Screenshot",
      label: `${row.software_name} ${row.version} — ${row.caption ?? row.slug}`,
      href: `${root}/browse/${row.category_slug}/${row.software_slug}/${row.version_slug}`,
    })),
  ];

  return htmlPage(database, "edit-hotlink", {
    root,
    manager,
    message,
    saved,
    title: held.name,
    heading: held.name,
    subheading: hostOf(held.target_url),
    atHotlinks: true,
    hotlink: held,
    address: `/hotlink/${held.slug}`,
    host: hostOf(held.target_url),
    size: held.size_bytes ? describedSize(held.size_bytes) : "",
    sizeField: byteFieldFor("size", "Size", held.size_bytes),
    usedBy,
    isUsed: usedBy.length > 0,
    mayEdit: can(manager, "hotlinks.edit"),
    mayDelete: can(manager, "hotlinks.delete") && usedBy.length === 0,
    lockedByUse: usedBy.length > 0,
  });
}

export async function hotlinkNew(environment, root, manager, message) {
  if (!can(manager, "hotlinks.create")) {
    return refuse("add hotlinks");
  }

  return htmlPage(environment.CATALOGUE, "create-hotlink", {
    root,
    manager,
    message,
    title: "Add a hotlink",
    heading: "Add a Hotlink",
    subheading: "a file that lives somewhere else",
    atHotlinks: true,
    sizeField: byteFieldFor("size", "Size", null),
  });
}

// A slug typed by hand may already be a path; one grown from a name is not.
function pathFrom(form, name) {
  const typed = textFrom(form, "slug");

  if (typed) {
    return typed
      .split("/")
      .map((one) => namedPath(one))
      .filter(Boolean)
      .join("/");
  }

  return namedPath(name);
}

async function freeSlug(database, wanted, exclude) {
  let held = wanted;
  let count = 2;

  for (;;) {
    const clash = await database
      .prepare("SELECT 1 AS held FROM hotlinks WHERE slug = ? AND slug <> ?")
      .bind(held, exclude ?? "")
      .first();

    if (!clash) {
      return held;
    }

    held = `${wanted}-${count}`;
    count += 1;
  }
}

export async function hotlinkCreate(environment, root, manager, form) {
  if (!can(manager, "hotlinks.create")) {
    return refuse("add hotlinks");
  }

  const database = environment.CATALOGUE;
  const target = textFrom(form, "target_url");
  const name = textFrom(form, "name");

  if (!target || !/^https?:\/\//i.test(target)) {
    return hotlinkNew(environment, root, manager, "Give a full http or https address.");
  }

  if (!name) {
    return hotlinkNew(environment, root, manager, "Give it a name.");
  }

  const slug = await freeSlug(database, pathFrom(form, name), null);

  await database
    .prepare(`
      INSERT INTO hotlinks (slug, name, target_url, size_bytes, notes, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(slug, name, target, bytesFrom(form, "size"),
          textFrom(form, "notes"), new Date().toISOString())
    .run();

  await noteChange(database, manager, `hotlink:${slug}`, "added", target);

  return goTo(`${root}/hotlinks/${slug}?saved=Added.`);
}

export async function hotlinkSave(environment, root, manager, slug, form) {
  if (!can(manager, "hotlinks.edit")) {
    return refuse("edit hotlinks");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM hotlinks WHERE slug = ?").bind(slug).first();

  if (!held) {
    return goTo(`${root}/hotlinks`);
  }

  const target = textFrom(form, "target_url") ?? held.target_url;

  if (!/^https?:\/\//i.test(target)) {
    return hotlinkView(environment, root, manager, slug, "Give a full http or https address.", null);
  }

  const name = textFrom(form, "name") ?? held.name;
  const wanted = await freeSlug(database, pathFrom(form, name) ?? slug, slug);

  await database
    .prepare(`
      UPDATE hotlinks SET slug = ?, name = ?, target_url = ?, size_bytes = ?, notes = ?
      WHERE slug = ?`)
    .bind(wanted, name, target, bytesFrom(form, "size"),
          textFrom(form, "notes"), slug)
    .run();

  if (wanted !== slug) {
    for (const [table, column] of [["files", "hotlink_slug"], ["software", "icon_hotlink_slug"],
                                   ["version_screenshots", "hotlink_slug"]]) {
      await database
        .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
        .bind(wanted, slug)
        .run();
    }
  }

  await noteChange(database, manager, `hotlink:${wanted}`, "updated", target);

  return goTo(`${root}/hotlinks/${wanted}?saved=Saved.`);
}

export async function hotlinkDelete(environment, root, manager, slug) {
  if (!can(manager, "hotlinks.delete")) {
    return refuse("delete hotlinks");
  }

  const database = environment.CATALOGUE;

  const held = await database
    .prepare("SELECT * FROM catalogue_hotlinks WHERE slug = ?")
    .bind(slug)
    .first();

  if (!held) {
    return goTo(`${root}/hotlinks`);
  }

  if (held.file_count + held.icon_count + held.screenshot_count > 0) {
    return hotlinkView(environment, root, manager, slug, "Still in use — unlink it first.", null);
  }

  await database.prepare("DELETE FROM hotlinks WHERE slug = ?").bind(slug).run();
  await noteChange(database, manager, `hotlink:${slug}`, "deleted", null);

  return goTo(`${root}/hotlinks?saved=Deleted.`);
}

// Nothing cascades from a deleted file or version to the link it stood behind, so a
// deletion elsewhere would otherwise leave the link sitting in the list forever.
export async function dropLooseHotlinks(database, manager) {
  const loose = await rowsOf(
    database.prepare(`
      SELECT h.slug FROM hotlinks h
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.hotlink_slug = h.slug)
        AND NOT EXISTS (SELECT 1 FROM version_screenshots s WHERE s.hotlink_slug = h.slug)
        AND NOT EXISTS (SELECT 1 FROM software w WHERE w.icon_hotlink_slug = h.slug)`)
  );

  for (const one of loose) {
    await database.prepare("DELETE FROM hotlinks WHERE slug = ?").bind(one.slug).run();
    await noteChange(database, manager, `hotlink:${one.slug}`, "deleted", "left with nothing to stand for");
  }

  return loose.length;
}

export async function sweepHotlinks(environment, root, manager) {
  const gone = await dropLooseHotlinks(environment.CATALOGUE, manager);

  return goTo(`${root}/hotlinks?view=loose&saved=${gone} swept.`);
}
