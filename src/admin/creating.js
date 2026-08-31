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
  const held = categorySlug
    ? await database.prepare("SELECT slug, name FROM categories WHERE slug = ?").bind(categorySlug).first()
    : null;

  if (categorySlug && !held) {
    return goTo(`${root}/categories`);
  }

  return page(database, {
    root,
    manager,
    title: "New title",
    heading: held ? `New Title In ${held.name}` : "New Title",
    atSoftware: true,
    action: `${root}/software`,
    backHref: held ? `${root}/categories/${held.slug}` : `${root}/software`,
    backLabel: held ? held.name : "Software",
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
          prefix: held ? `icons/${held.slug}` : "icons",
          labels: "{}",
          root,
        },
      },
      { kind: "category", name: "category", label: "Category", value: held?.slug ?? "",
        labels: JSON.stringify(held ? { [held.slug]: held.name } : {}), opener: "Choose a category" },
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
  const held = softwareSlug
    ? await database.prepare("SELECT slug, name FROM software WHERE slug = ?").bind(softwareSlug).first()
    : null;

  if (softwareSlug && !held) {
    return goTo(`${root}/categories`);
  }

  return page(database, {
    root,
    manager,
    title: "New version",
    heading: held ? `New Version Of ${held.name}` : "New Version",
    atVersions: true,
    action: `${root}/versions`,
    backHref: held ? `${root}/software/${held.slug}` : `${root}/versions`,
    backLabel: held ? held.name : "Versions",
    button: "Create Version",
    hidden: [],
    picks: [
      { kind: "software", name: "software_slug", label: "Title", value: held?.slug ?? "",
        labels: JSON.stringify(held ? { [held.slug]: held.name } : {}), opener: "Choose a title" },
      { kind: "platform", name: "platform_slug", label: "Platform", mayMake: true,
        opener: "Choose a platform" },
      { kind: "architecture", name: "architecture_slug", label: "Architecture", mayMake: true,
        opener: "Choose an architecture" },
      { kind: "processor", name: "minimum_cpu_slug", label: "Minimum processor", mayMake: true,
        opener: "Choose a processor" },
    ],
    fields: [
      { name: "version", label: "Version", hint: "6.0 SP1", required: true },
      { name: "slug", label: "Slug", hint: "worked out from the version if blank" },
    ],
    dates: [dateFieldFor("released_on", "Released on", null)],
    measures: [
      measureFieldFor("minimum_cpu_speed", "Minimum clock speed", null, null, SPEED_UNITS),
      measureFieldFor("minimum_ram", "Minimum RAM", null, null, SIZE_UNITS),
      measureFieldFor("minimum_disk", "Free disk space", null, null, SIZE_UNITS),
    ],
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

export async function newKey(environment, root, manager) {
  if (!can(manager, "keys.create")) {
    return refuse("create keys");
  }

  return page(environment.CATALOGUE, {
    root,
    manager,
    title: "New key",
    heading: "New Key",
    atKeys: true,
    action: `${root}/keys`,
    backHref: `${root}/keys`,
    backLabel: "Keys",
    button: "Create Key",
    hidden: [],
    fields: [
      { name: "name", label: "Name", hint: "winworld-mirrorer", required: true },
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

  const version = versionId
    ? await database
        .prepare(`
          SELECT v.id, v.slug, v.version, v.software_slug, s.name AS software_name, s.category AS category_slug
          FROM versions v JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
        .bind(Number(versionId) || 0)
        .first()
    : null;

  if (versionId && !version) {
    return goTo(`${root}/categories`);
  }

  const languages = await rowsOf(database.prepare("SELECT slug, name FROM languages ORDER BY sort_order, name"));
  const versionPath = version ? `${version.software_slug}/${version.slug}` : "";

  return htmlPage(database, "create-file", {
    root,
    manager,
    title: "Add a file",
    heading: "Add A File",
    atFiles: true,
    version,
    versionPath,
    versionLabels: JSON.stringify(
      version ? { [versionPath]: `${version.software_name} ${version.version}` } : {}
    ),
    backHref: version
      ? `${root}/browse/${version.category_slug}/${version.software_slug}/${version.slug}`
      : `${root}/files`,
    backLabel: version ? `${version.software_name} ${version.version}` : "Files",
    filePick: {
      objectField: "object_key",
      hotlinkField: "hotlink_slug",
      objectValue: "",
      hotlinkValue: "",
      opener: "Choose a file",
      prefix: version ? `${version.category_slug}/${version.software_slug}/${version.slug}` : "loose",
      labels: "{}",
    },
    languageLabels: JSON.stringify(Object.fromEntries(languages.map((one) => [one.slug, one.name]))),
  });
}
