import Mustache from "mustache";

import head from "../templates/partials/head.html";
import foot from "../templates/partials/foot.html";
import adminshell from "../templates/partials/adminshell.html";
import adminfoot from "../templates/partials/adminfoot.html";
import storagepick from "../templates/partials/storagepick.html";
import datefield from "../templates/partials/datefield.html";
import measurefield from "../templates/partials/measurefield.html";
import home from "../templates/home.html";
import category from "../templates/category.html";
import software from "../templates/software.html";
import version from "../templates/version.html";
import search from "../templates/search.html";
import advanced from "../templates/advanced.html";
import checksums from "../templates/checksums.html";
import recent from "../templates/recent.html";
import adminHotlinks from "../templates/admin-hotlinks.html";
import browseScreenshots from "../templates/browse-screenshots.html";
import editScreenshot from "../templates/edit-screenshot.html";
import editHotlink from "../templates/edit-hotlink.html";
import createHotlink from "../templates/create-hotlink.html";
import missing from "../templates/missing.html";
import requests from "../templates/requests.html";
import api from "../templates/api.html";
import adminStorage from "../templates/admin-storage.html";
import browseCategories from "../templates/browse-categories.html";
import browseCategory from "../templates/browse-category.html";
import browseSoftware from "../templates/browse-software.html";
import browseVersion from "../templates/browse-version.html";
import browseFile from "../templates/browse-file.html";
import browseTaxonomy from "../templates/browse-taxonomy.html";
import browseRequests from "../templates/browse-requests.html";
import browseRequest from "../templates/browse-request.html";
import browseRoles from "../templates/browse-roles.html";
import browsePeople from "../templates/browse-people.html";
import editCategory from "../templates/edit-category.html";
import editSoftware from "../templates/edit-software.html";
import editVersion from "../templates/edit-version.html";
import editFile from "../templates/edit-file.html";
import editTaxonomy from "../templates/edit-taxonomy.html";
import editRole from "../templates/edit-role.html";
import reorder from "../templates/reorder.html";
import create from "../templates/create.html";
import createFile from "../templates/create-file.html";
import adminDoorway from "../templates/admin-doorway.html";
import adminBucket from "../templates/admin-bucket.html";
import browseAudit from "../templates/browse-audit.html";
import browseList from "../templates/browse-list.html";
import confirmRemoval from "../templates/confirm-removal.html";
import editPerson from "../templates/edit-person.html";
import pick from "../templates/partials/pick.html";

const PARTIALS = { head, foot, adminshell, adminfoot, pick, storagepick, datefield, measurefield };

const TEMPLATES = {
  home, category, software, version, search, advanced, recent, missing, checksums, requests, api,
  "admin-hotlinks": adminHotlinks,
  "browse-screenshots": browseScreenshots,
  "edit-screenshot": editScreenshot,
  "edit-hotlink": editHotlink,
  "create-hotlink": createHotlink,
  "admin-doorway": adminDoorway,
  "admin-bucket": adminBucket,
  "browse-audit": browseAudit,
  "browse-list": browseList,
  "confirm-removal": confirmRemoval,
  "edit-person": editPerson,
  "admin-storage": adminStorage,
  "browse-categories": browseCategories,
  "browse-category": browseCategory,
  "browse-software": browseSoftware,
  "browse-version": browseVersion,
  "browse-file": browseFile,
  "browse-taxonomy": browseTaxonomy,
  "browse-requests": browseRequests,
  "browse-request": browseRequest,
  "browse-roles": browseRoles,
  "browse-people": browsePeople,
  "edit-category": editCategory,
  "edit-software": editSoftware,
  "edit-version": editVersion,
  "edit-file": editFile,
  "edit-taxonomy": editTaxonomy,
  "edit-role": editRole,
  reorder,
  create,
  "create-file": createFile,
};


const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function describedSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === "") {
    return "";
  }

  let held = Number(bytes);
  let position = 0;

  while (held >= 1024 && position < UNITS.length - 1) {
    held /= 1024;
    position += 1;
  }

  return `${held < 10 && position > 0 ? held.toFixed(1) : Math.round(held)} ${UNITS[position]}`;
}

export function extensionOf(fileName) {
  const at = String(fileName ?? "").lastIndexOf(".");

  return at > 0 ? String(fileName).slice(at).toLowerCase() : "";
}

export function tidyFileType(offered) {
  const held = String(offered ?? "").trim().toLowerCase().replace(/^\.+/, "");

  return held === "" ? "" : `.${held.replace(/[^a-z0-9._-]/g, "")}`;
}

// A download saves under its slug and type, so the name on disk matches the
// address it came from and survives a rename of the display name.
export function downloadName(slug, extension) {
  const type = tidyFileType(extension);

  return `${slug}${type && !slug.endsWith(type) ? type : ""}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// A date may be known to the year, the month or the day, and reads accordingly.
export function describedDate(held) {
  // a stored value may be a partial date or a full timestamp
  const [year, month, day] = String(held ?? "").split(/[T ]/)[0].split("-");

  if (!year) {
    return "";
  }

  const named = month ? MONTH_NAMES[Number(month) - 1] : null;

  if (!named) {
    return year;
  }

  return day ? `${Number(day)} ${named} ${year}` : `${named} ${year}`;
}

export function describedMeasure(size, unit) {
  return size ? `${size} ${unit ?? ""}`.trim() : "";
}

export function render(name, data) {
  return Mustache.render(TEMPLATES[name], data, PARTIALS);
}

export function htmlResponse(name, data, status = 200) {
  return new Response(render(name, data), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
