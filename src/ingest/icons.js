import { iconPathFor } from "../admin/browse.js";
import { filesFor } from "../storage/bucket.js";
import { noteChange } from "../admin/shared.js";

const TYPES = {
  "image/png": ".png",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/svg+xml": ".svg",
};

function bytesOf(encoded) {
  const binary = atob(String(encoded).replace(/^data:[^,]*,/, ""));
  const held = new Uint8Array(binary.length);

  for (let at = 0; at < binary.length; at += 1) {
    held[at] = binary.charCodeAt(at);
  }

  return held;
}

// Every title carries its own icon object even where two titles would hold the same
// picture. A shared key would mean one title's change silently redrawing another's.
export async function storeIcon(environment, database, manager, slug, offered, report) {
  if (!offered || typeof offered !== "object" || !offered.data) {
    return;
  }

  // The category is read back rather than worked out again, so the key always matches
  // the one the title was actually filed under.
  const held = await database.prepare("SELECT category FROM software WHERE slug = ?").bind(slug).first();
  const category = held?.category;

  if (!category) {
    return;
  }

  const contentType = String(offered.contentType ?? "image/png").toLowerCase();
  const extension = TYPES[contentType];

  if (!extension) {
    throw new Error(`${slug} offers an icon of an unknown kind: ${contentType}.`);
  }

  const key = iconPathFor(category, slug, extension);

  await filesFor(environment).put(key, bytesOf(offered.data), { contentType });
  await database
    .prepare("UPDATE software SET icon_key = ?, icon_hotlink_slug = NULL WHERE slug = ?")
    .bind(key, slug)
    .run();
  await noteChange(database, manager, `software:${slug}`, "icon set", key);
  report.made.push(`icon:${key}`);
}
