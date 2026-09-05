import { can, refuse } from "./permissions.js";
import { goTo, htmlPage, noteChange, textFrom } from "./shared.js";

const LABEL = "sfs";
const SECRET_BYTES = 24;
const OPENING_SHOWN = 12;

function hexOf(bytes) {
  return Array.from(bytes).map((one) => one.toString(16).padStart(2, "0")).join("");
}

function minted() {
  return `${LABEL}_${hexOf(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)))}`;
}

export async function hashOf(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));

  return hexOf(new Uint8Array(digest));
}

export async function keyView(environment, root, manager, identifier, message, saved) {
  if (!can(manager, "keys.view")) {
    return refuse("see keys");
  }

  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT k.*, m.email AS manager_email, r.name AS role_name
      FROM api_keys k
      JOIN managers m ON m.id = k.manager_id
      LEFT JOIN roles r ON r.id = m.role_id
      WHERE k.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/keys`);
  }

  const mayRead = held.manager_id === manager.id || can(manager, "*");

  // The page carries the whole key, so opening it is handing the credential over and
  // the log should say so.
  if (mayRead && held.secret) {
    await noteChange(database, manager, `key:${held.name}`, "read", null);
  }

  return htmlPage(database, "browse-key", {
    root,
    manager,
    message,
    saved,
    title: held.name,
    heading: held.name,
    subheading: held.revoked_at ? "revoked" : "in use",
    atKeys: true,
    key: held,
    live: !held.revoked_at,
    lastUsed: (held.last_used_at ?? "").replace("T", " ").slice(0, 16) || "never",
    made: (held.created_at ?? "").replace("T", " ").slice(0, 16),
    // A key acts as its owner, so reading it whole is the same as becoming them. Only
    // the person it acts as, or whoever holds the wildcard, gets to see it.
    secret: mayRead ? held.secret : null,
    hasSecret: Boolean(mayRead && held.secret),
    hiddenSecret: Boolean(held.secret) && !mayRead,
    mayRevoke: can(manager, "keys.delete") && !held.revoked_at,
  });
}

export async function keyCreate(environment, root, manager, form) {
  if (!can(manager, "keys.create")) {
    return refuse("create keys");
  }

  const database = environment.CATALOGUE;
  const name = textFrom(form, "name");

  if (!name) {
    return goTo(`${root}/keys/new`);
  }

  // A key acts as whoever minted it, so it can never reach further than they can.
  const secret = minted();

  await database
    .prepare(`
      INSERT INTO api_keys (manager_id, name, opening, token_hash, secret, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(manager.id, name, secret.slice(0, OPENING_SHOWN), await hashOf(secret), secret,
          new Date().toISOString())
    .run();

  const held = await database
    .prepare("SELECT id FROM api_keys WHERE token_hash = ?")
    .bind(await hashOf(secret))
    .first();

  await noteChange(database, manager, `key:${name}`, "created", null);

  return htmlPage(database, "made-key", {
    root,
    manager,
    title: "Key created",
    heading: "Key Created",
    subheading: name,
    atKeys: true,
    secret,
    keyHref: `${root}/keys/${held.id}`,
    actingAs: manager.email,
    roleName: manager.roleName,
  });
}

export async function keyRevoke(environment, root, manager, identifier) {
  if (!can(manager, "keys.delete")) {
    return refuse("revoke keys");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT id, name FROM api_keys WHERE id = ?").bind(Number(identifier) || 0).first();

  if (!held) {
    return goTo(`${root}/keys`);
  }

  await database
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), held.id)
    .run();

  await noteChange(database, manager, `key:${held.name}`, "revoked", null);

  return goTo(`${root}/keys/${held.id}?saved=Key revoked.`);
}

// A revoked key is kept so the audit trail still names it, but it opens nothing.
export async function managerForKey(request, database) {
  const offered = request.headers.get("authorization") ?? "";
  const [scheme, token] = offered.split(" ");

  if (!token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const held = await database
    .prepare(`
      SELECT k.id AS key_id, k.name AS key_name, m.id, m.email, m.display_name, m.role_id,
             r.name AS role_name, r.permissions
      FROM api_keys k
      JOIN managers m ON m.id = k.manager_id
      LEFT JOIN roles r ON r.id = m.role_id
      WHERE k.token_hash = ? AND k.revoked_at IS NULL`)
    .bind(await hashOf(token))
    .first();

  if (!held) {
    return null;
  }

  await database
    .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), held.key_id)
    .run();

  return {
    id: held.id,
    email: held.email,
    name: held.display_name || held.email,
    roleId: held.role_id,
    roleName: held.role_name ?? "No role",
    permissions: held.permissions ?? "",
    keyId: held.key_id,
    keyName: held.key_name,
  };
}
