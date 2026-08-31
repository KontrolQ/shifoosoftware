import { ACTIONS, SUBJECTS, can, gridFor, refuse } from "./permissions.js";
import { goTo, htmlPage, noteChange, rowsOf, textFrom } from "./shared.js";
import { applyMatch } from "../searching.js";


export async function roleView(environment, root, manager, identifier, message, saved) {
  if (!can(manager, "roles.view")) {
    return refuse("see roles");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM roles WHERE id = ?").bind(Number(identifier) || 0).first();

  if (!held) {
    return goTo(`${root}/roles`);
  }

  const people = await rowsOf(
    database.prepare("SELECT id, email, display_name FROM managers WHERE role_id = ? ORDER BY email").bind(held.id)
  );

  return htmlPage(database, "edit-role", {
    root,
    manager,
    message,
    saved,
    title: held.name,
    heading: held.name,
    subheading: held.permissions === "*" ? "every permission" : `${held.permissions.split(",").filter(Boolean).length} permissions`,
    atRoles: true,
    role: held,
    everything: held.permissions === "*",
    grid: gridFor(held.permissions),
    people,
    hasPeople: people.length > 0,
    mayEdit: can(manager, "roles.edit"),
    mayDelete: can(manager, "roles.delete") && held.permissions !== "*",
  });
}

export async function roleSave(environment, root, manager, identifier, form) {
  if (!can(manager, "roles.edit")) {
    return refuse("change roles");
  }

  const database = environment.CATALOGUE;
  const name = textFrom(form, "name");

  if (!name) {
    return roleView(environment, root, manager, identifier, "A name is required.", null);
  }

  const held = await database.prepare("SELECT permissions FROM roles WHERE id = ?").bind(Number(identifier)).first();
  const everything = String(form.get("everything") ?? "") === "1";
  const chosen = form.getAll("permission").map(String).filter(Boolean);
  const permissions = everything ? "*" : chosen.join(",");

  if (permissions === "*" && held?.permissions !== "*" && !holdsEverything(manager)) {
    return roleView(environment, root, manager, identifier,
      "Only someone who already has every permission can give a role every permission.", null);
  }

  if (held?.permissions === "*" && permissions !== "*") {
    const others = await database
      .prepare("SELECT COUNT(*) AS held FROM roles WHERE permissions = '*' AND id <> ?")
      .bind(Number(identifier))
      .first();

    if ((others?.held ?? 0) === 0) {
      return roleView(environment, root, manager, identifier,
        "This is the only role with every permission. Give another role everything first.", null);
    }
  }

  await database
    .prepare("UPDATE roles SET name = ?, permissions = ? WHERE id = ?")
    .bind(name, permissions, Number(identifier))
    .run();

  await noteChange(database, manager, `role:${name}`, "updated", everything ? "everything" : `${chosen.length} permissions`);

  return goTo(`${root}/roles/${identifier}?saved=Role saved.`);
}

export async function roleCreate(environment, root, manager, form) {
  if (!can(manager, "roles.create")) {
    return refuse("create roles");
  }

  const database = environment.CATALOGUE;
  const name = textFrom(form, "name");

  if (!name) {
    return goTo(`${root}/roles`);
  }

  await database
    .prepare("INSERT INTO roles (name, permissions, sort_order) VALUES (?, '', 100) ON CONFLICT(name) DO NOTHING")
    .bind(name)
    .run();

  const held = await database.prepare("SELECT id FROM roles WHERE name = ?").bind(name).first();

  await noteChange(database, manager, `role:${name}`, "created", null);

  return goTo(`${root}/roles/${held.id}?saved=Role created. Give it some permissions.`);
}

export async function roleDelete(environment, root, manager, identifier) {
  if (!can(manager, "roles.delete")) {
    return refuse("delete roles");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM roles WHERE id = ?").bind(Number(identifier)).first();

  if (!held || held.permissions === "*") {
    return roleView(environment, root, manager, identifier, "A role with every permission cannot be deleted.", null);
  }

  await database.prepare("DELETE FROM roles WHERE id = ?").bind(held.id).run();
  await noteChange(database, manager, `role:${held.name}`, "deleted", null);

  return goTo(`${root}/roles?saved=Role deleted.`);
}


export async function personView(environment, root, manager, identifier, message, saved) {
  if (!can(manager, "people.view")) {
    return refuse("see people");
  }

  const database = environment.CATALOGUE;

  const held = await database
    .prepare(`
      SELECT m.*, r.name AS role_name, r.id AS role_handle
      FROM managers m LEFT JOIN roles r ON r.id = m.role_id WHERE m.id = ?`)
    .bind(Number(identifier) || 0)
    .first();

  if (!held) {
    return goTo(`${root}/people`);
  }

  const sessions = await database
    .prepare("SELECT COUNT(*) AS held FROM sessions WHERE manager_id = ? AND expires_at > ?")
    .bind(held.id, new Date().toISOString())
    .first();

  const changes = await rowsOf(
    database
      .prepare("SELECT happened_at, subject, deed FROM changes WHERE manager_id = ? ORDER BY happened_at DESC LIMIT 10")
      .bind(held.id)
  );

  return htmlPage(database, "edit-person", {
    root,
    manager,
    message,
    saved,
    title: held.email,
    heading: held.email,
    subheading: held.role_name ?? "no role",
    atPeople: true,
    person: held,
    roleHref: held.role_handle ? `${root}/roles/${held.role_handle}` : null,
    joined: (held.created_at ?? "").slice(0, 10),
    seen: (held.last_seen_at ?? "").slice(0, 10) || "never",
    sessions: sessions?.held ?? 0,
    isSelf: held.id === manager.id,
    mayEdit: can(manager, "people.edit"),
    kind: "role",
    name: "role_id",
    value: held.role_handle ?? "",
    label: held.role_name ?? "",
    changes: changes.map((row) => ({ ...row, when: row.happened_at.replace("T", " ").slice(0, 16) })),
    hasChanges: changes.length > 0,
  });
}

export async function personSave(environment, root, manager, identifier, form) {
  if (!can(manager, "people.edit")) {
    return refuse("change people");
  }

  const database = environment.CATALOGUE;
  const roleId = Number(textFrom(form, "role_id")) || null;
  const person = Number(identifier) || 0;

  if (person === manager.id) {
    return personView(environment, root, manager, identifier,
      "You cannot change your own role. Ask another owner to do it.", null);
  }

  const holders = await database
    .prepare(`
      SELECT COUNT(*) AS held FROM managers m JOIN roles r ON r.id = m.role_id
      WHERE r.permissions = '*' AND m.id <> ?`)
    .bind(person)
    .first();

  const losing = await database
    .prepare(`
      SELECT 1 AS held FROM managers m JOIN roles r ON r.id = m.role_id
      WHERE m.id = ? AND r.permissions = '*'`)
    .bind(person)
    .first();

  const gaining = roleId
    ? await database.prepare("SELECT 1 AS held FROM roles WHERE id = ? AND permissions = '*'").bind(roleId).first()
    : null;

  if (losing && !gaining && (holders?.held ?? 0) === 0) {
    return personView(environment, root, manager, identifier,
      "That is the last account with every permission. Give someone else that role first.", null);
  }

  if (gaining && !holdsEverything(manager)) {
    return personView(environment, root, manager, identifier,
      "Only someone who already has every permission can give it to someone else.", null);
  }

  await database.prepare("UPDATE managers SET role_id = ? WHERE id = ?").bind(roleId, person).run();
  await noteChange(database, manager, `person:${person}`, "given a role", String(roleId ?? "none"));

  return goTo(`${root}/people/${person}?saved=Role assigned.`);
}
