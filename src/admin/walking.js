import {
  categoryDelete,
  categoryEdit,
  categorySave,
  categoryView,
  fileDelete,
  fileEdit,
  fileSave,
  fileView,
  softwareDelete,
  softwareEdit,
  softwareSave,
  softwareView,
  versionDelete,
  versionEdit,
  versionSave,
  versionView,
} from "./browse.js";
import { newFile, newSoftware, newVersion } from "./creating.js";
import {
  screenshotCreate,
  screenshotDelete,
  screenshotEdit,
  screenshotList,
  screenshotNew,
  screenshotRemove,
  screenshotSave,
} from "./screenshots.js";
import { confirmRemoval } from "./removing.js";
import { goTo } from "./shared.js";

async function versionIdFor(database, softwareSlug, versionSlug) {
  const held = await database
    .prepare("SELECT id FROM versions WHERE software_slug = ? AND slug = ?")
    .bind(softwareSlug, versionSlug)
    .first();

  return held?.id ?? 0;
}

async function fileIdFor(database, softwareSlug, versionSlug, fileSlug) {
  const held = await database
    .prepare(`
      SELECT f.id FROM files f JOIN versions v ON v.id = f.version_id
      WHERE v.software_slug = ? AND v.slug = ? AND f.slug = ?`)
    .bind(softwareSlug, versionSlug, fileSlug)
    .first();

  return held?.id ?? 0;
}

const LEAVES = new Set(["edit", "new", "remove", "delete"]);

export async function walk(environment, root, manager, parts, saved) {
  const database = environment.CATALOGUE;
  const steps = parts.slice(1);

  if (steps[3] === "screenshots") {
    const [, softwareSlug, versionSlug] = steps;
    const shotSlug = steps[4];

    if (!shotSlug) {
      return screenshotList(environment, root, manager, softwareSlug, versionSlug, saved);
    }

    if (shotSlug === "new") {
      return screenshotNew(environment, root, manager, softwareSlug, versionSlug, null);
    }

    if (steps[5] === "remove") {
      return screenshotRemove(environment, root, manager, softwareSlug, versionSlug, shotSlug);
    }

    return screenshotEdit(environment, root, manager, softwareSlug, versionSlug, shotSlug, null);
  }

  const tail = steps.length > 0 && LEAVES.has(steps[steps.length - 1]) ? steps.pop() : null;
  const [categorySlug, softwareSlug, versionSlug, fileSlug] = steps;

  if (!categorySlug) {
    return goTo(`${root}/categories`);
  }

  if (!softwareSlug) {
    if (tail === "edit") {
      return categoryEdit(environment, root, manager, categorySlug, null);
    }

    if (tail === "new") {
      return newSoftware(environment, root, manager, categorySlug);
    }

    if (tail === "remove") {
      return confirmRemoval(environment, root, manager, "categories", categorySlug);
    }

    return categoryView(environment, root, manager, categorySlug, saved);
  }

  if (!versionSlug) {
    if (tail === "edit") {
      return softwareEdit(environment, root, manager, softwareSlug, null);
    }

    if (tail === "new") {
      return newVersion(environment, root, manager, softwareSlug);
    }

    if (tail === "remove") {
      return confirmRemoval(environment, root, manager, "software", softwareSlug);
    }

    return softwareView(environment, root, manager, softwareSlug, saved);
  }

  if (!fileSlug) {
    const identifier = await versionIdFor(database, softwareSlug, versionSlug);

    if (!identifier) {
      return goTo(`${root}/browse/${categorySlug}/${softwareSlug}`);
    }

    if (tail === "edit") {
      return versionEdit(environment, root, manager, identifier, null);
    }

    if (tail === "new") {
      return newFile(environment, root, manager, identifier);
    }

    if (tail === "remove") {
      return confirmRemoval(environment, root, manager, "versions", String(identifier));
    }

    return versionView(environment, root, manager, identifier, saved);
  }

  const identifier = await fileIdFor(database, softwareSlug, versionSlug, fileSlug);

  if (!identifier) {
    return goTo(`${root}/browse/${categorySlug}/${softwareSlug}/${versionSlug}`);
  }

  if (tail === "edit") {
    return fileEdit(environment, root, manager, identifier, null);
  }

  if (tail === "remove") {
    return confirmRemoval(environment, root, manager, "files", String(identifier));
  }

  return fileView(environment, root, manager, identifier, saved);
}

export async function walkPost(environment, root, manager, parts, form) {
  const database = environment.CATALOGUE;
  const steps = parts.slice(1);

  if (steps[3] === "screenshots") {
    const [, softwareSlug, versionSlug] = steps;
    const shotSlug = steps[4];

    if (!shotSlug) {
      return screenshotCreate(environment, root, manager, softwareSlug, versionSlug, form);
    }

    return steps[5] === "delete"
      ? screenshotDelete(environment, root, manager, softwareSlug, versionSlug, shotSlug)
      : screenshotSave(environment, root, manager, softwareSlug, versionSlug, shotSlug, form);
  }

  const tail = steps.length > 0 && LEAVES.has(steps[steps.length - 1]) ? steps.pop() : null;
  const [categorySlug, softwareSlug, versionSlug, fileSlug] = steps;

  if (!categorySlug) {
    return goTo(`${root}/categories`);
  }

  if (!softwareSlug) {
    return tail === "delete"
      ? categoryDelete(environment, root, manager, categorySlug)
      : categorySave(environment, root, manager, categorySlug, form);
  }

  if (!versionSlug) {
    return tail === "delete"
      ? softwareDelete(environment, root, manager, softwareSlug)
      : softwareSave(environment, root, manager, softwareSlug, form);
  }

  if (!fileSlug) {
    const identifier = await versionIdFor(database, softwareSlug, versionSlug);

    return tail === "delete"
      ? versionDelete(environment, root, manager, identifier)
      : versionSave(environment, root, manager, identifier, form);
  }

  const identifier = await fileIdFor(database, softwareSlug, versionSlug, fileSlug);

  return tail === "delete"
    ? fileDelete(environment, root, manager, identifier, form)
    : fileSave(environment, root, manager, identifier, form);
}
