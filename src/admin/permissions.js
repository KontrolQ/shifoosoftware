export const SUBJECTS = [
  { key: "categories", label: "Categories" },
  { key: "platforms", label: "Platforms" },
  { key: "languages", label: "Languages" },
  { key: "interfaces", label: "Interfaces" },
  { key: "architectures", label: "Architectures" },
  { key: "filetypes", label: "File types" },
  { key: "processors", label: "Processors" },
  { key: "publishers", label: "Publishers" },
  { key: "software", label: "Software" },
  { key: "versions", label: "Versions" },
  { key: "files", label: "Files" },
  { key: "bucket", label: "Bucket" },
  { key: "hotlinks", label: "Hotlinks" },
  { key: "requests", label: "Requests" },
  { key: "history", label: "History" },
  { key: "people", label: "People" },
  { key: "roles", label: "Roles" },
];

export const ACTIONS = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
];

export function grantsOf(manager) {
  if (!manager) {
    return new Set();
  }

  return new Set(String(manager.permissions ?? "").split(",").map((one) => one.trim()).filter(Boolean));
}

export function can(manager, permission) {
  const held = grantsOf(manager);

  if (held.has("*")) {
    return true;
  }

  const [subject] = permission.split(".");

  return held.has(permission) || held.has(`${subject}.*`);
}

export function allowances(manager) {
  const held = {};

  for (const subject of SUBJECTS) {
    for (const action of ACTIONS) {
      held[`${subject.key}_${action.key}`] = can(manager, `${subject.key}.${action.key}`);
    }
  }

  return held;
}

export function refuse(what) {
  return new Response(`You do not have permission to ${what}.`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function gridFor(permissions) {
  const held = new Set(String(permissions ?? "").split(",").map((one) => one.trim()).filter(Boolean));
  const everything = held.has("*");

  return SUBJECTS.map((subject) => ({
    ...subject,
    actions: ACTIONS.map((action) => ({
      ...action,
      key: `${subject.key}.${action.key}`,
      given: everything || held.has(`${subject.key}.${action.key}`) || held.has(`${subject.key}.*`),
    })),
  }));
}
