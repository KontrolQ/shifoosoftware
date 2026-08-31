import { can } from "./permissions.js";
import { namedPath, noteChange, slugFrom } from "./shared.js";
import { tidyFileType } from "../rendering.js";

const MAKEABLE = {
  category: { table: "categories", permission: "categories.create" },
  publisher: { table: "publishers", permission: "software.edit" },
  platform: { table: "platforms", permission: "platforms.create" },
  language: { table: "languages", permission: "languages.create" },
  interface: { table: "interfaces", permission: "interfaces.create" },
  architecture: { table: "architectures", permission: "architectures.create" },
  filetype: { table: "file_types", permission: "filetypes.create" },
  processor: { table: "processors", permission: "processors.create" },
  hotlink: { table: "hotlinks", permission: "hotlinks.create", needsTarget: true },
};

function answer(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Different targets that happen to share a name each keep their own address.
async function freeSlug(database, stem) {
  const at = stem.lastIndexOf(".");
  const head = at > 0 ? stem.slice(0, at) : stem;
  const tail = at > 0 ? stem.slice(at) : "";
  let wanted = stem;
  let count = 2;

  for (;;) {
    const taken = await database
      .prepare("SELECT 1 AS held FROM hotlinks WHERE slug = ?")
      .bind(wanted)
      .first();

    if (!taken) {
      return wanted;
    }

    wanted = `${head}-${count}${tail}`;
    count += 1;
  }
}

export async function makeEntry(environment, manager, form) {
  const kind = String(form.get("kind") ?? "");
  const shape = MAKEABLE[kind];

  if (!shape) {
    return answer({ error: "Nothing of that kind can be created here." }, 400);
  }

  if (!can(manager, shape.permission)) {
    return answer({ error: "You do not have permission to create that." }, 403);
  }

  const name = String(form.get("name") ?? "").trim();

  if (!name) {
    return answer({ error: "A name is required." }, 400);
  }

  const made = new FormData();

  made.set("slug", name);

  const slug = slugFrom(made, "slug");

  if (!slug) {
    return answer({ error: "That name does not make a usable slug." }, 400);
  }

  const database = environment.CATALOGUE;

  const held = await database.prepare(`SELECT slug, name FROM ${shape.table} WHERE slug = ?`).bind(slug).first();

  if (held) {
    return answer(held);
  }

  if (shape.needsTarget) {
    const target = String(form.get("target") ?? "").trim();

    if (!/^https?:\/\//i.test(target)) {
      return answer({ error: "A full http or https address is required." }, 400);
    }

    // two links are the same thing only when they point at the same place
    const standing = await database
      .prepare("SELECT slug, name FROM hotlinks WHERE target_url = ?")
      .bind(target)
      .first();

    if (standing) {
      return answer(standing);
    }

    // a hotlink is addressed like the object it stands in for, under the same prefix
    const prefix = String(form.get("prefix") ?? "").replace(/^\/+|\/+$/g, "");
    const stem = prefix ? `${prefix}/${namedPath(name)}` : namedPath(name);
    const wanted = await freeSlug(database, stem);

    await database
      .prepare("INSERT INTO hotlinks (slug, name, target_url, added_at, sort_order) VALUES (?, ?, ?, ?, 9999)")
      .bind(wanted, name, target, new Date().toISOString())
      .run();

    await noteChange(database, manager, `hotlink:${wanted}`, "created", target);

    return answer({ slug: wanted, name });
  }

  if (shape.table === "file_types") {
    // "ISO" names the type, ".iso" ends the file
    await database
      .prepare("INSERT INTO file_types (slug, name, extension, sort_order) VALUES (?, ?, ?, 9999)")
      .bind(slug, name, tidyFileType(name))
      .run();

    await noteChange(database, manager, `filetype:${slug}`, "created", name);

    return answer({ slug, name });
  }

  const columns = shape.table === "categories" ? "(slug, name, summary, sort_order)" : "(slug, name, sort_order)";
  const values = shape.table === "categories" ? "(?, ?, NULL, 9999)" : "(?, ?, 9999)";

  await database.prepare(`INSERT INTO ${shape.table} ${columns} VALUES ${values}`).bind(slug, name).run();
  await noteChange(database, manager, `${kind}:${slug}`, "created", name);

  return answer({ slug, name });
}
