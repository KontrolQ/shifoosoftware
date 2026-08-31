import {
  categoryCreate,
  categoryDelete,
  categoryEdit,
  categorySave,
  categoryView,
  fileCreate,
  fileDelete,
  fileEdit,
  fileSave,
  fileView,
  reorderPage,
  reorderSave,
  softwareCreate,
  softwareDelete,
  softwareEdit,
  softwareSave,
  softwareView,
  versionCreate,
  versionDelete,
  versionEdit,
  versionSave,
  versionView,
  versionEditBySlug,
  versionViewBySlug,
} from "./browse.js";
import { beginSignIn, doorway, finishSignIn, managerFor, signOut } from "./openid.js";
import { browse, dropObject, fetchObject, putObject } from "./bucket.js";
import { can, refuse } from "./permissions.js";
import { newCategory, newFile, newKey, newRole, newSoftware, newTaxonomy, newVersion } from "./creating.js";
import { keyCreate, keyRevoke, keyView } from "./keys.js";
import { COLLECTIONS, dropView, listing, saveView } from "./listing.js";
import { makeEntry } from "./making.js";
import { askForUploadUrl } from "./presign.js";
import { confirmRemoval, isRemovable } from "./removing.js";
import { walk, walkPost } from "./walking.js";
import {
  isKind,
  taxonomyCreate,
  taxonomyDelete,
  taxonomySave,
  taxonomyView,
} from "./taxonomy.js";
import { personSave, personView, roleCreate, roleDelete, roleSave, roleView } from "./roles.js";
import { requestDelete, requestSave, requestView } from "./requests.js";
import {
  hotlinkCreate,
  hotlinkDelete,
  hotlinkNew,
  hotlinkSave,
  hotlinkView,
} from "./hotlinks.js";
import { storage, sweepOrphans } from "./storage.js";

async function readOnly(environment, root, manager, parts, url, saved) {
  if (parts[0] === "browse") {
    return walk(environment, root, manager, parts, saved);
  }

  if (parts[0] === "find") {
    return listing(environment, root, manager, "find", url, saved);
  }

  if (parts.length === 0 || (parts[0] === "categories" && !parts[1])) {
    return listing(environment, root, manager, "categories", url, saved);
  }

  if (parts[0] === "categories" && parts[1] === "new") {
    return newCategory(environment, root, manager);
  }

  if (parts[0] === "categories" && parts[2] === "new") {
    return newSoftware(environment, root, manager, parts[1]);
  }

  if (parts[0] === "software" && parts[2] === "new") {
    return newVersion(environment, root, manager, parts[1]);
  }

  if (parts[0] === "versions" && parts[2] === "new") {
    return newFile(environment, root, manager, parts[1]);
  }

  // The same pages answer without a parent, which is how a list reaches them.
  if (parts[0] === "software" && parts[1] === "new") {
    return newSoftware(environment, root, manager, null);
  }

  if (parts[0] === "versions" && parts[1] === "new") {
    return newVersion(environment, root, manager, null);
  }

  if (parts[0] === "files" && parts[1] === "new") {
    return newFile(environment, root, manager, null);
  }

  if (isKind(parts[0]) && parts[1] === "new") {
    return newTaxonomy(environment, root, manager, parts[0]);
  }

  if (parts[0] === "roles" && parts[1] === "new") {
    return newRole(environment, root, manager);
  }

  if (parts[0] === "keys" && parts[1] === "new") {
    return newKey(environment, root, manager);
  }

  if (parts[0] === "categories" && parts[2] === "edit") {
    return categoryEdit(environment, root, manager, parts[1], null);
  }

  if (parts[0] === "categories") {
    return categoryView(environment, root, manager, parts[1], saved);
  }

  if (parts[0] === "software" && !parts[1]) {
    return listing(environment, root, manager, "software", url, saved);
  }

  if (parts[0] === "versions" && !parts[1]) {
    return listing(environment, root, manager, "versions", url, saved);
  }

  if (parts[0] === "files" && !parts[1]) {
    return listing(environment, root, manager, "files", url, saved);
  }

  if (parts[0] === "software" && parts[2] === "edit") {
    return softwareEdit(environment, root, manager, parts[1], null);
  }

  if (parts[0] === "software" && parts[1]) {
    return softwareView(environment, root, manager, parts[1], saved);
  }

  if (parts[0] === "software" && parts[1] && parts[2] && parts[3] === "edit") {
    return versionEditBySlug(environment, root, manager, parts[1], parts[2]);
  }

  if (parts[0] === "software" && parts[1] && parts[2] && !["edit", "new"].includes(parts[2])) {
    return versionViewBySlug(environment, root, manager, parts[1], parts[2], saved);
  }

  if (parts[0] === "versions" && parts[2] === "edit") {
    return versionEdit(environment, root, manager, parts[1], null);
  }

  if (parts[0] === "versions" && parts[1]) {
    return versionView(environment, root, manager, parts[1], saved);
  }

  if (parts[0] === "files" && parts[2] === "edit") {
    return fileEdit(environment, root, manager, parts[1], null);
  }

  if (parts[0] === "files" && parts[1]) {
    return fileView(environment, root, manager, parts[1], saved);
  }

  if (parts[0] === "reorder" && parts[1]) {
    return reorderPage(environment, root, manager, parts[1], parts[2] ?? "");
  }

  if (isRemovable(parts[0]) && parts[1] && parts[2] === "remove") {
    return confirmRemoval(environment, root, manager, parts[0], parts[1]);
  }

  if (COLLECTIONS[parts[0]] && !parts[1]) {
    return listing(environment, root, manager, parts[0], url, saved);
  }

  if (isKind(parts[0])) {
    return taxonomyView(environment, root, manager, parts[0], parts[1], null, saved);
  }

  if (parts[0] === "bucket" && parts[1] === "fetch") {
    return fetchObject(environment, manager, url);
  }

  if (parts[0] === "bucket") {
    return can(manager, "bucket.view")
      ? browse(environment, root, manager, url, null, saved)
      : refuse("browse the bucket");
  }

  if (parts[0] === "hotlinks" && parts[1] === "new") {
    return hotlinkNew(environment, root, manager, null);
  }

  if (parts[0] === "hotlinks" && parts[1]) {
    return hotlinkView(environment, root, manager, parts.slice(1).join("/"), null, saved);
  }

  if (parts[0] === "storage") {
    return can(manager, "bucket.view")
      ? storage(environment, root, null, saved, manager)
      : refuse("audit storage");
  }

  if (parts[0] === "requests" && parts[1]) {
    return requestView(environment, root, manager, parts[1], saved);
  }

  if (parts[0] === "roles" && parts[1]) {
    return roleView(environment, root, manager, parts[1], null, saved);
  }

  if (parts[0] === "people" && parts[1]) {
    return personView(environment, root, manager, parts[1], null, saved);
  }

  if (parts[0] === "keys" && parts[1]) {
    return keyView(environment, root, manager, parts[1], null, saved);
  }

  return null;
}

async function acting(environment, root, manager, parts, form) {
  if (parts[1] === "views" && COLLECTIONS[collectionAt(parts[0])]) {
    return parts[2] === "drop"
      ? dropView(environment, root, manager, collectionAt(parts[0]), form)
      : saveView(environment, root, manager, collectionAt(parts[0]), form);
  }

  if (parts[0] === "browse") {
    return walkPost(environment, root, manager, parts, form);
  }

  if (parts[0] === "categories" && parts[2] === "delete") {
    return categoryDelete(environment, root, manager, parts[1]);
  }

  if (parts[0] === "categories" && parts[1]) {
    return categorySave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "categories") {
    return categoryCreate(environment, root, manager, form);
  }

  if (parts[0] === "software" && parts[2] === "delete") {
    return softwareDelete(environment, root, manager, parts[1]);
  }

  if (parts[0] === "software" && parts[1]) {
    return softwareSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "software") {
    return softwareCreate(environment, root, manager, form);
  }

  if (parts[0] === "versions" && parts[2] === "delete") {
    return versionDelete(environment, root, manager, parts[1]);
  }

  if (parts[0] === "versions" && parts[1]) {
    return versionSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "versions") {
    return versionCreate(environment, root, manager, form);
  }

  if (parts[0] === "files" && parts[2] === "delete") {
    return fileDelete(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "files" && parts[1]) {
    return fileSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "files") {
    return fileCreate(environment, root, manager, form);
  }

  if (parts[0] === "reorder" && parts[1]) {
    return reorderSave(environment, root, manager, parts[1], parts[2] ?? "", form);
  }

  if (parts[0] === "make") {
    return makeEntry(environment, manager, form);
  }

  if (parts[0] === "upload-url") {
    return askForUploadUrl(environment, manager, form);
  }

  if (parts[0] === "hotlinks" && parts[parts.length - 1] === "delete") {
    return hotlinkDelete(environment, root, manager, parts.slice(1, -1).join("/"));
  }

  if (parts[0] === "hotlinks" && parts[1]) {
    return hotlinkSave(environment, root, manager, parts.slice(1).join("/"), form);
  }

  if (parts[0] === "hotlinks") {
    return hotlinkCreate(environment, root, manager, form);
  }

  if (isKind(parts[0]) && parts[2] === "delete") {
    return taxonomyDelete(environment, root, manager, parts[0], parts[1]);
  }

  if (isKind(parts[0]) && parts[1]) {
    return taxonomySave(environment, root, manager, parts[0], parts[1], form);
  }

  if (isKind(parts[0])) {
    return taxonomyCreate(environment, root, manager, parts[0], form);
  }

  if (parts[0] === "bucket" && parts[1] === "put") {
    return can(manager, "bucket.create") ? putObject(environment, root, manager, form) : refuse("upload");
  }

  if (parts[0] === "bucket" && parts[1] === "drop") {
    return can(manager, "bucket.delete") ? dropObject(environment, root, manager, form) : refuse("delete objects");
  }

  if (parts[0] === "sweep") {
    return can(manager, "bucket.delete") ? sweepOrphans(environment, root, manager) : refuse("sweep the bucket");
  }

  if (parts[0] === "requests" && parts[2] === "delete") {
    return requestDelete(environment, root, manager, parts[1]);
  }

  if (parts[0] === "requests" && parts[1]) {
    return requestSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "roles" && parts[2] === "delete") {
    return roleDelete(environment, root, manager, parts[1]);
  }

  if (parts[0] === "roles" && parts[1]) {
    return roleSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "roles") {
    return roleCreate(environment, root, manager, form);
  }

  if (parts[0] === "people" && parts[1]) {
    return personSave(environment, root, manager, parts[1], form);
  }

  if (parts[0] === "keys" && parts[2] === "revoke") {
    return keyRevoke(environment, root, manager, parts[1]);
  }

  if (parts[0] === "keys") {
    return keyCreate(environment, root, manager, form);
  }

  return null;
}

// a list's path names its collection
function collectionAt(path) {
  return Object.keys(COLLECTIONS).find((one) => COLLECTIONS[one].path === path);
}

export async function adminRoute(request, environment, root, parts, url) {
  const saved = url.searchParams.get("saved");
  const manager = await managerFor(request, environment.CATALOGUE);

  // Signing in is answered whether or not somebody is already signed in, or
  // coming back from the identity provider with a session in hand lands nowhere.
  if (parts[0] === "callback") {
    return finishSignIn(request, environment, root, url);
  }

  if (parts[0] === "signin") {
    return beginSignIn(environment, root, url);
  }

  if (!manager) {
    return doorway(root, null, url.pathname);
  }

  if (request.method === "GET") {
    return readOnly(environment, root, manager, parts, url, saved);
  }

  if (request.method !== "POST") {
    return null;
  }

  if (parts[0] === "signout") {
    return signOut(environment, root, manager);
  }

  return acting(environment, root, manager, parts, await request.formData());
}
