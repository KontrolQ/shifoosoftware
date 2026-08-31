import { can, refuse } from "./permissions.js";
import { rendered } from "../markdown.js";
import { goTo, htmlPage, noteChange, rowsOf, textFrom } from "./shared.js";
import { applyMatch } from "../searching.js";

const STATES = [
  { key: "open", label: "Open" },
  { key: "accepted", label: "Accepted" },
  { key: "filled", label: "Filled" },
  { key: "declined", label: "Declined" },
];


export async function requestView(environment, root, manager, identifier, saved) {
  if (!can(manager, "requests.view")) {
    return refuse("see requests");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT * FROM requests WHERE id = ?").bind(Number(identifier) || 0).first();

  if (!held) {
    return goTo(`${root}/requests`);
  }

  return htmlPage(database, "browse-request", {
    root,
    manager,
    saved,
    title: held.title,
    heading: held.title,
    subheading: `asked ${(held.happened_at ?? "").slice(0, 10)}`,
    atRequests: true,
    request: held,
    notesHtml: rendered(held.notes),
    states: STATES.map((one) => ({ ...one, chosen: one.key === held.state })),
    mayEdit: can(manager, "requests.edit"),
    mayDelete: can(manager, "requests.delete"),
  });
}

export async function requestSave(environment, root, manager, identifier, form) {
  if (!can(manager, "requests.edit")) {
    return refuse("change requests");
  }

  const database = environment.CATALOGUE;
  const state = STATES.some((one) => one.key === textFrom(form, "state")) ? textFrom(form, "state") : "open";

  await database
    .prepare("UPDATE requests SET state = ?, notes = ? WHERE id = ?")
    .bind(state, textFrom(form, "notes"), Number(identifier))
    .run();

  await noteChange(database, manager, `request:${identifier}`, "marked", state);

  return goTo(`${root}/requests/${identifier}?saved=Request updated.`);
}

export async function requestDelete(environment, root, manager, identifier) {
  if (!can(manager, "requests.delete")) {
    return refuse("delete requests");
  }

  await environment.CATALOGUE.prepare("DELETE FROM requests WHERE id = ?").bind(Number(identifier)).run();
  await noteChange(environment.CATALOGUE, manager, `request:${identifier}`, "deleted", null);

  return goTo(`${root}/requests?saved=Request deleted.`);
}

export async function takeRequest(database, form) {
  const title = String(form.get("title") ?? "").trim();

  if (!title) {
    return false;
  }

  await database
    .prepare(`
      INSERT INTO requests (title, publisher, wanted_version, notes, link, asked_by, happened_at, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`)
    .bind(
      title.slice(0, 200),
      String(form.get("publisher") ?? "").trim().slice(0, 120) || null,
      String(form.get("wanted_version") ?? "").trim().slice(0, 60) || null,
      String(form.get("notes") ?? "").trim().slice(0, 2000) || null,
      String(form.get("link") ?? "").trim().slice(0, 500) || null,
      String(form.get("asked_by") ?? "").trim().slice(0, 120) || null,
      new Date().toISOString()
    )
    .run();

  return true;
}
