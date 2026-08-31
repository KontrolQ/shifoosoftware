import { describedSize } from "../rendering.js";
import { can, refuse } from "./permissions.js";
import { goTo, htmlPage, rowsOf } from "./shared.js";

async function categoryTree(database, slug) {
  const held = await database.prepare("SELECT slug, name FROM categories WHERE slug = ?").bind(slug).first();

  if (!held) {
    return null;
  }

  const software = await rowsOf(
    database.prepare("SELECT slug, name FROM software WHERE category = ? ORDER BY name").bind(slug)
  );

  return {
    what: "category",
    name: held.name,
    handle: held.slug,
    blocked: software.length > 0,
    blockedWhy: software.length > 0
      ? `${software.length} ${software.length === 1 ? "title" : "titles"} still sit here. Move or delete them first.`
      : null,
    branches: software.map((one) => ({ label: one.name, note: "title", depth: 1 })),
  };
}

async function softwareTree(database, slug) {
  const held = await database.prepare("SELECT slug, name FROM software WHERE slug = ?").bind(slug).first();

  if (!held) {
    return null;
  }

  const versions = await rowsOf(
    database.prepare("SELECT id, version FROM versions WHERE software_slug = ? ORDER BY sort_order").bind(slug)
  );

  const branches = [];
  let bytes = 0;

  for (const version of versions) {
    branches.push({ label: version.version, note: "version", depth: 1 });

    const files = await rowsOf(
      database
        .prepare("SELECT display_name, slug, size_bytes FROM files WHERE version_id = ? ORDER BY display_name")
        .bind(version.id)
    );

    for (const file of files) {
      bytes += file.size_bytes ?? 0;
      branches.push({
        label: file.display_name,
        note: `file, ${describedSize(file.size_bytes)}, removed from the bucket`,
        depth: 2,
      });
    }
  }

  return {
    what: "software",
    name: held.name,
    handle: held.slug,
    branches,
    footnote: bytes > 0 ? `${describedSize(bytes)} will be freed from the bucket.` : null,
  };
}

async function versionTree(database, identifier) {
  const held = await database
    .prepare(`
      SELECT v.id, v.version, s.name AS software_name FROM versions v
      JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return null;
  }

  const files = await rowsOf(
    database
      .prepare("SELECT display_name, slug, size_bytes FROM files WHERE version_id = ? ORDER BY display_name")
      .bind(held.id)
  );

  const bytes = files.reduce((running, one) => running + (one.size_bytes ?? 0), 0);

  return {
    what: "version",
    name: `${held.software_name} ${held.version}`,
    handle: String(held.id),
    branches: files.map((one) => ({
      label: one.display_name,
      note: `file, ${describedSize(one.size_bytes)}, removed from the bucket`,
      depth: 1,
    })),
    footnote: bytes > 0 ? `${describedSize(bytes)} will be freed from the bucket.` : null,
  };
}

async function fileTree(database, identifier) {
  const held = await database
    .prepare(`
      SELECT f.id, f.display_name, f.slug, f.size_bytes, f.object_key, v.version, s.name AS software_name
      FROM files f JOIN versions v ON v.id = f.version_id JOIN software s ON s.slug = v.software_slug
      WHERE f.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return null;
  }

  return {
    what: "file",
    name: held.display_name,
    handle: String(held.id),
    branches: [
      { label: held.object_key, note: `object in the bucket, ${describedSize(held.size_bytes)}`, depth: 1 },
    ],
    footnote: `Belongs to ${held.software_name} ${held.version}.`,
    keepable: true,
  };
}

const TREES = {
  categories: { build: categoryTree, permission: "categories.delete", back: (root, handle) => `${root}/categories/${handle}` },
  software: { build: softwareTree, permission: "software.delete", back: (root, handle) => `${root}/software/${handle}` },
  versions: { build: versionTree, permission: "versions.delete", back: (root, handle) => `${root}/versions/${handle}` },
  files: { build: fileTree, permission: "files.delete", back: (root, handle) => `${root}/files/${handle}` },
};

export function isRemovable(what) {
  return Object.hasOwn(TREES, what);
}

export async function confirmRemoval(environment, root, manager, what, handle) {
  const shape = TREES[what];

  if (!can(manager, shape.permission)) {
    return refuse(`delete ${what}`);
  }

  const database = environment.CATALOGUE;
  const tree = await shape.build(database, handle);

  if (!tree) {
    return goTo(`${root}/categories`);
  }

  return htmlPage(database, "confirm-removal", {
    root,
    manager,
    title: `Delete ${tree.name}`,
    heading: `Delete ${tree.name}`,
    subheading: tree.what,
    what,
    handle,
    tree,
    hasBranches: tree.branches.length > 0,
    branches: tree.branches.map((one) => ({ ...one, indent: `depth${one.depth}` })),
    action: `${root}/${what}/${handle}/delete`,
    backHref: shape.back(root, handle),
  });
}
