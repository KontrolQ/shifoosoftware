import { describedSize } from "../rendering.js";
import { goTo, htmlPage, noteChange, rowsOf } from "./shared.js";
import { filesFor } from "../storage/bucket.js";

const PER_PAGE = 100;

export async function browse(environment, root, manager, url, message, saved) {
  const database = environment.CATALOGUE;
  const prefix = (url?.searchParams.get("prefix") ?? "").trim();
  const cursor = url?.searchParams.get("cursor") ?? undefined;

  const query = (url?.searchParams.get("q") ?? "").trim().toLowerCase();

  const page = await filesFor(environment).list({
    prefix: prefix || undefined,
    cursor,
    delimiter: "/",
    limit: PER_PAGE,
  });

  const recorded = await rowsOf(database.prepare("SELECT object_key FROM files"));
  const icons = await rowsOf(
    database.prepare("SELECT icon_key FROM software WHERE icon_key IS NOT NULL")
  );
  const claimed = new Set([...recorded.map((row) => row.object_key), ...icons.map((row) => row.icon_key)]);

  const folders = (page.delimitedPrefixes ?? []).map((one) => ({
    path: one,
    name: one.replace(/\/$/, "").split("/").pop(),
  }));

  const trail = [];
  let walked = "";

  for (const step of prefix.split("/").filter(Boolean)) {
    walked += `${step}/`;
    trail.push({ name: step, path: walked });
  }

  const titles = await rowsOf(database.prepare("SELECT slug, name FROM software ORDER BY name"));

  return htmlPage(database, "admin-bucket", {
    root,
    manager,
    message,
    saved: saved === "put" ? "File uploaded." : saved === "gone" ? "Object deleted." : null,
    title: "Bucket",
    heading: "Bucket",
    atBucket: true,
    subheading: prefix ? `under ${prefix}` : "everything stored",
    titles,
    titleCount: titles.length,
    prefix,
    query,
    trail,
    folders,
    hasFolders: folders.length > 0,
    objects: page.objects
      .filter((object) => !query || object.key.toLowerCase().includes(query))
      .map((object) => ({
        key: object.key,
        leaf: object.key.split("/").pop(),
        size: describedSize(object.size),
        changed: object.uploaded.toISOString().slice(0, 10),
        claimed: claimed.has(object.key),
        href: `${root}/bucket/fetch?key=${encodeURIComponent(object.key)}`,
      })),
    hasObjects: page.objects.length > 0,
    shown: page.objects.length,
    nextCursor: page.truncated ? page.cursor : null,
    hasMore: page.truncated,
  });
}

export async function fetchObject(environment, url) {
  const key = url.searchParams.get("key");

  if (!key) {
    return new Response("No key given.", { status: 400 });
  }

  const held = await filesFor(environment).get(key);

  if (!held) {
    return new Response("Nothing at that key.", { status: 404 });
  }

  return new Response(held.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${key.split("/").pop()}"`,
    },
  });
}

export async function putObject(environment, root, manager, form) {
  const payload = form.get("payload");
  const folder = String(form.get("prefix") ?? "").trim().replace(/^\/+|\/+$/g, "");
  const named = String(form.get("key") ?? "").trim();

  if (!payload || typeof payload === "string" || payload.size === 0) {
    return browse(environment, root, manager, null, "Choose a file to upload.", null);
  }

  const key = named || (folder ? `${folder}/${payload.name}` : payload.name);

  await filesFor(environment).put(key, await payload.arrayBuffer());
  await noteChange(environment.CATALOGUE, manager, `object:${key}`, "uploaded", describedSize(payload.size));

  return goTo(`${root}/bucket?saved=put${folder ? `&prefix=${encodeURIComponent(folder)}` : ""}`);
}

export async function dropObject(environment, root, manager, form) {
  const key = String(form.get("key") ?? "").trim();

  if (!key) {
    return goTo(`${root}/bucket`);
  }

  const claimed = await environment.CATALOGUE
    .prepare("SELECT 1 AS held FROM files WHERE object_key = ? UNION SELECT 1 FROM software WHERE icon_key = ?")
    .bind(key, key)
    .first();

  if (claimed) {
    return browse(environment, root, manager, null,
      `${key} is still referenced by the catalogue and was not deleted.`, null);
  }

  await filesFor(environment).delete(key);
  await noteChange(environment.CATALOGUE, manager, `object:${key}`, "deleted", null);

  return goTo(`${root}/bucket?saved=gone`);
}
