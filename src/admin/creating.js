import { describedSize } from "../rendering.js";
import { KINDS } from "./taxonomy.js";
import { can, refuse } from "./permissions.js";
import {
  SIZE_UNITS,
  SPEED_UNITS,
  dateFieldFor,
  goTo,
  htmlPage,
  measureFieldFor,
  rowsOf,
} from "./shared.js";

function page(database, shape) {
  return htmlPage(database, "create", shape);
}

export async function newCategory(environment, root, manager) {
  if (!can(manager, "categories.create")) {
    return refuse("create categories");
  }

  return page(environment.CATALOGUE, {
    root,
    manager,
    title: "New category",
    heading: "New Category",
    atCategories: true,
    action: `${root}/categories`,
    backHref: `${root}/categories`,
    backLabel: "Categories",
    button: "Create Category",
    hidden: [],
    fields: [
      { name: "name", label: "Name", hint: "Web Browsers", required: true },
      { name: "slug", label: "Slug", hint: "worked out from the name if blank" },
      { name: "summary", label: "Summary", markdown: true },
    ],
  });
}

export async function newSoftware(environment, root, manager, categorySlug) {
  if (!can(manager, "software.create")) {
    return refuse("create software");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT slug, name FROM categories WHERE slug = ?").bind(categorySlug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  return page(database, {
    root,
    manager,
    title: "New title",
    heading: `New Title In ${held.name}`,
    atSoftware: true,
    action: `${root}/software`,
    backHref: `${root}/categories/${held.slug}`,
    backLabel: held.name,
    button: "Create Title",
    hidden: [],
    picks: [
      {
        label: "Icon",
        storage: {
          objectField: "icon_key",
          hotlinkField: "icon_hotlink_slug",
          objectValue: "",
          hotlinkValue: "",
          opener: "Choose an icon",
          prefix: `icons/${held.slug}`,
          labels: "{}",
          root,
        },
      },
      { kind: "category", name: "category", label: "Category", value: held.slug,
        labels: JSON.stringify({ [held.slug]: held.name }), opener: "Choose a category" },
      { kind: "publisher", name: "publishers", label: "Publishers", many: true, mayMake: true,
        opener: "Add a publisher" },
      { kind: "platform", name: "platforms", label: "Platforms", many: true, mayMake: true,
        opener: "Add a platform" },
      { kind: "interface", name: "interfaces", label: "User interface", many: true, mayMake: true,
        opener: "Add an interface" },
      { kind: "processor", name: "minimum_cpu_slug", label: "Minimum processor", mayMake: true,
        opener: "Choose a processor" },
    ],
    fields: [
      { name: "name", label: "Name", hint: "Internet Explorer", required: true },
      { name: "slug", label: "Slug", hint: "worked out from the name if blank" },
      { name: "homepage", label: "Homepage", hint: "https://example.com" },
      { name: "published", label: "Published", choices: true,
        options: [{ value: "0", label: "No, keep it hidden" }, { value: "1", label: "Yes, publish it" }] },
    ],
    prose: [{ name: "description", label: "Description" }],
    dates: [
      dateFieldFor("released_on", "First released", null),
      dateFieldFor("end_of_life", "End of life", null),
    ],
    measures: [
      measureFieldFor("minimum_cpu_speed", "Minimum clock speed", null, null, SPEED_UNITS),
      measureFieldFor("minimum_ram", "Minimum RAM", null, null, SIZE_UNITS),
      measureFieldFor("minimum_disk", "Free disk space", null, null, SIZE_UNITS),
    ],
  });
}

export async function newVersion(environment, root, manager, softwareSlug) {
  if (!can(manager, "versions.create")) {
    return refuse("create versions");
  }

  const database = environment.CATALOGUE;
  const held = await database.prepare("SELECT slug, name FROM software WHERE slug = ?").bind(softwareSlug).first();

  if (!held) {
    return goTo(`${root}/categories`);
  }

  return page(database, {
    root,
    manager,
    title: "New version",
    heading: `New Version Of ${held.name}`,
    atVersions: true,
    action: `${root}/versions`,
    backHref: `${root}/software/${held.slug}`,
    backLabel: held.name,
    button: "Create Version",
    hidden: [{ name: "software_slug", value: held.slug }],
    picks: [
      { kind: "platform", name: "platform_slug", label: "Platform", mayMake: true,
        opener: "Choose a platform" },
      { kind: "architecture", name: "architecture_slug", label: "Architecture", mayMake: true,
        opener: "Choose an architecture" },
    ],
    fields: [
      { name: "version", label: "Version", hint: "6.0 SP1", required: true },
      { name: "slug", label: "Slug", hint: "worked out from the version if blank" },
    ],
    dates: [dateFieldFor("released_on", "Released on", null)],
    prose: [{ name: "notes", label: "Notes" }],
  });
}

export async function newTaxonomy(environment, root, manager, kind) {
  if (!can(manager, `${kind}.create`)) {
    return refuse(`add ${kind}`);
  }

  const shape = KINDS[kind];

  if (!shape) {
    return goTo(`${root}/categories`);
  }

  return page(environment.CATALOGUE, {
    root,
    manager,
    title: `New ${shape.singular.toLowerCase()}`,
    heading: `New ${shape.singular.replace(/^An? /, "")}`,
    [shape.flag]: true,
    action: `${root}/${kind}`,
    backHref: `${root}/${kind}`,
    backLabel: shape.label,
    button: `Create ${shape.singular.replace(/^An? /, "")}`,
    hidden: [],
    fields: [
      { name: "name", label: "Name", hint: shape.nameHint, required: true },
      { name: "slug", label: "Slug", hint: "worked out from the name if blank" },
      ...(shape.extras ?? []),
    ],
  });
}

export async function newRole(environment, root, manager) {
  if (!can(manager, "roles.create")) {
    return refuse("create roles");
  }

  return page(environment.CATALOGUE, {
    root,
    manager,
    title: "New role",
    heading: "New Role",
    atRoles: true,
    action: `${root}/roles`,
    backHref: `${root}/roles`,
    backLabel: "Roles",
    button: "Create Role",
    hidden: [],
    fields: [{ name: "name", label: "Name", hint: "Curator", required: true }],
  });
}

export async function newFile(environment, root, manager, versionId) {
  if (!can(manager, "files.create")) {
    return refuse("add files");
  }

  const database = environment.CATALOGUE;

  const version = await database
    .prepare(`
      SELECT v.id, v.slug, v.version, v.software_slug, s.name AS software_name, s.category AS category_slug
      FROM versions v JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
    .bind(Number(versionId) || 0)
    .first();

  if (!version) {
    return goTo(`${root}/categories`);
  }

  const languages = await rowsOf(database.prepare("SELECT slug, name FROM languages ORDER BY sort_order, name"));

  return htmlPage(database, "create-file", {
    root,
    manager,
    title: "Add a file",
    heading: "Add A File",
    atFiles: true,
    version,
    filePick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: "",
      hotlinkValue: "",
      opener: "Choose a file",
      prefix: `${version.category_slug}/${version.software_slug}/${version.slug}`,
      labels: "{}",
    },
    languageLabels: JSON.stringify(Object.fromEntries(languages.map((one) => [one.slug, one.name]))),
  });
}
