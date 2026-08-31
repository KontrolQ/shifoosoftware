import { can, refuse } from "./permissions.js";
import { goTo, htmlPage, noteChange, rowsOf, slugFrom, slugOf, textFrom } from "./shared.js";
import { filesFor } from "../storage/bucket.js";

const STEP = 10;

async function versionAt(database, softwareSlug, versionSlug) {
  return database
    .prepare(`
      SELECT v.id, v.slug, v.version, v.software_slug, s.name AS software_name, s.category
      FROM versions v JOIN software s ON s.slug = v.software_slug
      WHERE v.software_slug = ? AND v.slug = ?`)
    .bind(softwareSlug, versionSlug)
    .first();
}

function pathsFor(root, version) {
  const here = `${root}/browse/${version.category}/${version.software_slug}/${version.slug}`;

  return { here, listPath: `${here}/screenshots` };
}

async function shotsOf(database, versionId) {
  return rowsOf(
    database
      .prepare(`
        SELECT vs.slug, vs.caption, vs.object_key, vs.hotlink_slug, vs.sort_order, h.name AS hotlink_name
        FROM version_screenshots vs
        LEFT JOIN hotlinks h ON h.slug = vs.hotlink_slug
        WHERE vs.version_id = ? ORDER BY vs.sort_order, vs.slug`)
      .bind(versionId)
  );
}

export async function screenshotList(environment, root, manager, softwareSlug, versionSlug, saved) {
  if (!can(manager, "versions.view")) {
    return refuse("see versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const { here, listPath } = pathsFor(root, version);
  const shots = await shotsOf(database, version.id);

  return htmlPage(database, "browse-screenshots", {
    root,
    manager,
    saved,
    title: `${version.software_name} ${version.version} screenshots`,
    heading: "Screenshots",
    subheading: `${version.software_name} ${version.version}`,
    atVersions: true,
    version,
    here,
    listPath,
    shots: shots.map((one) => ({
      ...one,
      href: `${listPath}/${one.slug}`,
      comesFrom: one.hotlink_slug ? `hotlink · ${one.hotlink_name}` : one.object_key,
      shown: one.caption || one.slug,
    })),
    hasShots: shots.length > 0,
    mayEdit: can(manager, "versions.edit"),
  });
}

export async function screenshotNew(environment, root, manager, softwareSlug, versionSlug, message) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const { here, listPath } = pathsFor(root, version);

  return htmlPage(database, "edit-screenshot", {
    root,
    manager,
    message,
    title: "Add a screenshot",
    heading: "Add A Screenshot",
    subheading: `${version.software_name} ${version.version}`,
    atVersions: true,
    version,
    here,
    listPath,
    action: listPath,
    button: "Add screenshot",
    shotPick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: "",
      hotlinkValue: "",
      opener: "Choose a picture",
      prefix: `shots/${version.category}/${version.software_slug}/${version.slug}`,
      labels: "{}",
      root,
    },
  });
}

export async function screenshotEdit(environment, root, manager, softwareSlug, versionSlug, slug, message) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const held = await database
    .prepare(`
      SELECT vs.*, h.name AS hotlink_name FROM version_screenshots vs
      LEFT JOIN hotlinks h ON h.slug = vs.hotlink_slug
      WHERE vs.version_id = ? AND vs.slug = ?`)
    .bind(version.id, slug)
    .first();

  const { here, listPath } = pathsFor(root, version);

  if (!held) {
    return goTo(listPath);
  }

  return htmlPage(database, "edit-screenshot", {
    root,
    manager,
    message,
    title: held.caption || held.slug,
    heading: "Edit Screenshot",
    subheading: `${version.software_name} ${version.version}`,
    atVersions: true,
    version,
    shot: held,
    here,
    listPath,
    action: `${listPath}/${held.slug}`,
    button: "Save",
    mayDelete: can(manager, "versions.edit"),
    shotPick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: held.object_key ?? "",
      hotlinkValue: held.hotlink_slug ?? "",
      opener: "Choose a picture",
      prefix: `shots/${version.category}/${version.software_slug}/${version.slug}`,
      labels: JSON.stringify({
        ...(held.object_key ? { [held.object_key]: held.object_key } : {}),
        ...(held.hotlink_slug ? { [held.hotlink_slug]: held.hotlink_name } : {}),
      }),
      root,
    },
  });
}

export async function screenshotRemove(environment, root, manager, softwareSlug, versionSlug, slug) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const held = await database
    .prepare("SELECT * FROM version_screenshots WHERE version_id = ? AND slug = ?")
    .bind(version.id, slug)
    .first();

  const { listPath } = pathsFor(root, version);

  if (!held) {
    return goTo(listPath);
  }

  return htmlPage(database, "confirm-removal", {
    root,
    manager,
    title: "Remove screenshot",
    heading: "Remove Screenshot",
    subheading: held.caption || held.slug,
    atVersions: true,
    what: "screenshot",
    name: held.caption || held.slug,
    action: `${listPath}/${held.slug}/delete`,
    backHref: listPath,
    lines: [{ label: held.caption || held.slug, note: held.object_key ?? held.hotlink_slug, indent: "" }],
    hasLines: true,
  });
}

async function freeSlug(database, versionId, wanted, exclude) {
  const taken = await rowsOf(
    database.prepare("SELECT slug FROM version_screenshots WHERE version_id = ?").bind(versionId)
  );

  const used = new Set(taken.map((one) => one.slug).filter((one) => one !== exclude));
  let held = wanted;
  let count = 2;

  while (used.has(held)) {
    held = `${wanted}-${count}`;
    count += 1;
  }

  return held;
}

export async function screenshotCreate(environment, root, manager, softwareSlug, versionSlug, form) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const objectKey = textFrom(form, "object_key");
  const hotlinkSlug = textFrom(form, "hotlink_slug");

  if (!objectKey && !hotlinkSlug) {
    return screenshotNew(environment, root, manager, softwareSlug, versionSlug, "Choose a picture first.");
  }

  const caption = textFrom(form, "caption");
  const stem = slugFrom(form, "slug", ["caption"]) ??
    slugOf(String(objectKey ?? hotlinkSlug).split("/").pop()) ?? "shot";

  const slug = await freeSlug(database, version.id, stem || "shot", null);

  await database
    .prepare(`
      INSERT INTO version_screenshots (version_id, slug, caption, object_key, hotlink_slug, sort_order)
      VALUES (?, ?, ?, ?, ?, 9999)`)
    .bind(version.id, slug, caption, hotlinkSlug ? null : objectKey, hotlinkSlug ?? null)
    .run();

  await reorder(database, version.id);
  await noteChange(database, manager, `screenshot:${slug}`, "added", null);

  return goTo(`${pathsFor(root, version).listPath}?saved=Added.`);
}

export async function screenshotSave(environment, root, manager, softwareSlug, versionSlug, slug, form) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const objectKey = textFrom(form, "object_key");
  const hotlinkSlug = textFrom(form, "hotlink_slug");
  const caption = textFrom(form, "caption");
  const wanted = await freeSlug(database, version.id,
    slugFrom(form, "slug", ["caption"]) ?? slug, slug);

  await database
    .prepare(`
      UPDATE version_screenshots SET slug = ?, caption = ?, object_key = ?, hotlink_slug = ?
      WHERE version_id = ? AND slug = ?`)
    .bind(wanted, caption, hotlinkSlug ? null : objectKey, hotlinkSlug ?? null, version.id, slug)
    .run();

  await noteChange(database, manager, `screenshot:${wanted}`, "updated", null);

  return goTo(`${pathsFor(root, version).listPath}?saved=Saved.`);
}

export async function screenshotDelete(environment, root, manager, softwareSlug, versionSlug, slug) {
  if (!can(manager, "versions.edit")) {
    return refuse("edit versions");
  }

  const database = environment.CATALOGUE;
  const version = await versionAt(database, softwareSlug, versionSlug);

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const held = await database
    .prepare("SELECT object_key FROM version_screenshots WHERE version_id = ? AND slug = ?")
    .bind(version.id, slug)
    .first();

  if (held?.object_key) {
    await filesFor(environment).delete(held.object_key);
  }

  await database
    .prepare("DELETE FROM version_screenshots WHERE version_id = ? AND slug = ?")
    .bind(version.id, slug)
    .run();

  await noteChange(database, manager, `screenshot:${slug}`, "deleted", null);

  return goTo(`${pathsFor(root, version).listPath}?saved=Removed.`);
}

async function reorder(database, versionId) {
  const rows = await rowsOf(
    database
      .prepare("SELECT slug FROM version_screenshots WHERE version_id = ? ORDER BY sort_order, slug")
      .bind(versionId)
  );

  let position = STEP;

  for (const row of rows) {
    await database
      .prepare("UPDATE version_screenshots SET sort_order = ? WHERE version_id = ? AND slug = ?")
      .bind(position, versionId, row.slug)
      .run();

    position += STEP;
  }
}
