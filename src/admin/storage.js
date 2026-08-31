import { describedSize } from "../rendering.js";
import { goTo, htmlPage, rowsOf, titleList } from "./shared.js";
import { filesFor } from "../storage/bucket.js";

const ALLOWANCE = 10 * 1024 * 1024 * 1024;

async function everyObject(bucket) {
  const held = [];
  let cursor;

  do {
    const page = await bucket.list({ cursor, limit: 1000 });

    held.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return held;
}

export async function storage(environment, root, message, saved, manager) {
  const database = environment.CATALOGUE;

  const recorded = await rowsOf(
    database.prepare(`
      SELECT f.object_key, f.display_name AS file_name, f.size_bytes,
             v.software_slug, v.slug AS version_slug, v.version, s.category AS category_slug, f.slug
      FROM files f JOIN versions v ON v.id = f.version_id JOIN software s ON s.slug = v.software_slug
      WHERE f.hotlink_slug IS NULL AND f.object_key IS NOT NULL AND f.object_key <> ''`)
  );

  const icons = await rowsOf(
    database.prepare("SELECT icon_key FROM software WHERE icon_key IS NOT NULL")
  );

  const shots = await rowsOf(
    database.prepare("SELECT object_key FROM version_screenshots WHERE object_key IS NOT NULL")
  );

  const claimed = new Set([
    ...recorded.map((row) => row.object_key),
    ...icons.map((row) => row.icon_key),
    ...shots.map((row) => row.object_key),
  ]);
  const objects = await everyObject(filesFor(environment));
  const present = new Map(objects.map((object) => [object.key, object.size]));

  const orphans = objects
    .filter((object) => !claimed.has(object.key))
    .map((object) => ({ key: object.key, size: describedSize(object.size) }));

  const missing = recorded
    .filter((row) => !present.has(row.object_key))
    .map((row) => ({
      ...row,
      where: `${row.software_slug} ${row.version}`,
      path: `${row.category_slug}/${row.software_slug}/${row.version_slug}/${row.slug}`,
    }));

  const wrongSize = recorded
    .filter((row) => present.has(row.object_key) && present.get(row.object_key) !== row.size_bytes)
    .map((row) => ({
      ...row,
      recorded: describedSize(row.size_bytes),
      actual: describedSize(present.get(row.object_key)),
    }));

  const titles = await titleList(database, null);

  return htmlPage(database, "admin-storage", {
    root,
    message,
    saved: saved === "swept" ? "Orphaned objects deleted." : null,
    title: "Storage",
    heading: "Storage",
    manager,
    atStorage: true,
    subheading: `${objects.length} objects in the bucket`,
    titles,
    titleCount: titles.length,
    objectCount: objects.length,
    totalHeld: describedSize(objects.reduce((running, object) => running + object.size, 0)),
    allowance: describedSize(ALLOWANCE),
    left: describedSize(Math.max(0, ALLOWANCE - objects.reduce((running, object) => running + object.size, 0))),
    usedShare: Math.min(100, Math.round(
      (objects.reduce((running, object) => running + object.size, 0) / ALLOWANCE) * 100)),
    claimedCount: claimed.size,
    orphans,
    hasOrphans: orphans.length > 0,
    orphanCount: orphans.length,
    missing,
    hasMissing: missing.length > 0,
    missingCount: missing.length,
    wrongSize,
    hasWrongSize: wrongSize.length > 0,
  });
}

export async function sweepOrphans(environment, root, manager) {
  const database = environment.CATALOGUE;

  const recorded = await rowsOf(database.prepare("SELECT object_key FROM files"));
  const icons = await rowsOf(
    database.prepare("SELECT icon_key FROM software WHERE icon_key IS NOT NULL")
  );

  const shots = await rowsOf(
    database.prepare("SELECT object_key FROM version_screenshots WHERE object_key IS NOT NULL")
  );

  const claimed = new Set([
    ...recorded.map((row) => row.object_key),
    ...icons.map((row) => row.icon_key),
    ...shots.map((row) => row.object_key),
  ]);

  for (const object of await everyObject(filesFor(environment))) {
    if (!claimed.has(object.key)) {
      await filesFor(environment).delete(object.key);
    }
  }

  return goTo(`${root}/storage?saved=swept`);
}
