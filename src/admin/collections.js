import { describedDate, describedMeasure, describedSize } from "../rendering.js";
import { plain } from "../markdown.js";
import { AUDIT_PLACES } from "./audit-places.js";
import { everythingFor } from "./everything.js";

// Every column is addressable: it can be shown, hidden, sorted on and filtered,
// so each carries the expression it stands for and what kind of value that is.
const COLUMN_WIDTHS = { text: "14rem", number: "5.5rem", date: "8.5rem", flag: "6rem" };

function col(key, label, field, type, options = {}) {
  const draw = options.cell
    ?? (options.link
      ? (held) => ({ link: options.link(held) })
      : (held) => ({ text: held[field] == null ? "" : String(held[field]), muted: true }));

  return {
    key,
    label,
    field,
    type,
    on: options.on === true,
    fixed: options.fixed === true,
    right: type === "number",
    // the column that names the row is the one that leads to it
    leads: Boolean(options.link),
    // Prose and one-off identifiers are asked about by operator rather than by
    // picking from a list of their values. A column that draws itself is prose:
    // the plain ones are the categorical values worth listing.
    own: options.own === true || Boolean(options.cell),
    // what a number counts, so a range can be asked for in the units people use
    unit: options.unit ?? null,
    // a column of counts or dates asks for no more room than its content
    tight: type !== "text",
    width: options.width ?? COLUMN_WIDTHS[type] ?? null,
    href: options.href ?? null,
    cell: draw,
  };
}

// A facet offers what the data actually holds, so an option that would return
// nothing is never shown. `from` yields rows of value, label and held.
function countedBy(key, label, source) {
  return { name: key, label, sql: source, kind: "choice" };
}

function capitalised(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function hostOf(target) {
  try {
    return new URL(target).host;
  } catch (problem) {
    return "elsewhere";
  }
}

function yesNo(key, label, when) {
  return { name: key, label, kind: "flag", when };
}

export const COLLECTIONS = {
  categories: {
    label: "Categories",
    path: "categories",
    permission: "categories",
    makes: true,
    flag: "atCategories",
    from: `SELECT c.slug, c.name, c.summary, c.sort_order,
                  (SELECT COUNT(*) FROM software s WHERE s.category = c.slug) AS titles,
                  (SELECT COUNT(*) FROM catalogue_files f WHERE f.category_slug = c.slug) AS files
           FROM categories c`,
    search: ["name", "slug", "summary"],
    order: "sort_order, name",
    sorts: [
      { key: "order", label: "Running order", clause: "sort_order, name" },
      { key: "name", label: "Name", clause: "name" },
      { key: "titles", label: "Most titles", clause: "titles DESC, name" },
    ],
    facets: [
      yesNo("stocked", "Holds titles", "titles > 0"),
      yesNo("described", "Has a summary", "(summary IS NOT NULL AND trim(summary) <> '')"),
    ],
    columns: [
      col("name", "Name", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
      col("slug", "Slug", "slug", "text", { own: true, width: "12rem" }),
      col("summary", "Summary", "summary", "text",
        { on: true, cell: (held) => ({ text: plain(held.summary, Infinity), muted: true }) }),
      col("titles", "Titles", "titles", "number", { on: true,
        href: (root, held) => `${root}/software?category=${held.slug}` }),
      col("files", "Files", "files", "number", { on: true,
        href: null }),
      col("order", "Order", "sort_order", "number", {}),
    ],
    href: (root, held) => `${root}/browse/${held.slug}`,
  },

  software: {
    label: "Software",
    path: "software",
    permission: "software",
    makes: true,
    flag: "atSoftware",
    from: `SELECT s.*,
             (SELECT GROUP_CONCAT(DISTINCT l.name) FROM catalogue_files f
                JOIN file_languages j ON j.file_id = f.id
                JOIN languages l ON l.slug = j.language_slug
               WHERE f.software_slug = s.slug) AS language_names,
             (SELECT GROUP_CONCAT(DISTINCT t.name) FROM catalogue_files f
                JOIN file_types t ON t.slug = f.file_type_slug
               WHERE f.software_slug = s.slug) AS file_type_names,
             (SELECT GROUP_CONCAT(DISTINCT a.name) FROM catalogue_versions v
                JOIN version_architectures va ON va.version_id = v.id
                JOIN architectures a ON a.slug = va.architecture_slug
               WHERE v.software_slug = s.slug) AS architecture_names
           FROM catalogue_software s`,
    search: ["name", "slug", "publisher_names", "description", "category_name",
             "platform_names", "interface_names", "minimum_cpu_name"],
    reach: `EXISTS (SELECT 1 FROM catalogue_versions v WHERE v.software_slug = held.slug
              AND (v.version LIKE ?t ESCAPE '~' OR v.slug LIKE ?t ESCAPE '~' OR v.notes LIKE ?t ESCAPE '~'))
            OR EXISTS (SELECT 1 FROM catalogue_files f WHERE f.software_slug = held.slug
              AND (f.display_name LIKE ?t ESCAPE '~' OR f.slug LIKE ?t ESCAPE '~'
                   OR f.notes LIKE ?t ESCAPE '~'))`,
    order: "name",
    sorts: [
      { key: "name", label: "Name", clause: "name" },
      { key: "added", label: "Newest", clause: "created_at DESC" },
      { key: "versions", label: "Most versions", clause: "version_count DESC, name" },
      { key: "files", label: "Most files", clause: "file_count DESC, name" },
      { key: "size", label: "Largest", clause: "bytes_held DESC, name" },
    ],
    facets: [
      countedBy("category", "Category", `
        SELECT category_slug AS value, category_name AS label, COUNT(*) AS held
        FROM catalogue_software GROUP BY category_slug ORDER BY held DESC, category_name`),
      countedBy("publisher", "Publisher", `
        SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
        FROM software_publishers j JOIN publishers p ON p.slug = j.publisher_slug
        GROUP BY p.slug ORDER BY held DESC, p.name`),
      countedBy("platform", "Platform", `
        SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
        FROM software_platforms j JOIN platforms p ON p.slug = j.platform_slug
        GROUP BY p.slug ORDER BY held DESC, p.name`),
      countedBy("interface", "Interface", `
        SELECT i.slug AS value, i.name AS label, COUNT(*) AS held
        FROM software_interfaces j JOIN interfaces i ON i.slug = j.interface_slug
        GROUP BY i.slug ORDER BY held DESC, i.name`),
      countedBy("language", "Language", `
        SELECT l.slug AS value, l.name AS label, COUNT(DISTINCT f.software_slug) AS held
        FROM catalogue_files f JOIN file_languages j ON j.file_id = f.id
        JOIN languages l ON l.slug = j.language_slug
        GROUP BY l.slug ORDER BY held DESC, l.name`),
      countedBy("filetype", "File type", `
        SELECT t.slug AS value, t.name AS label, COUNT(DISTINCT f.software_slug) AS held
        FROM catalogue_files f JOIN file_types t ON t.slug = f.file_type_slug
        GROUP BY t.slug ORDER BY held DESC, t.name`),
      countedBy("architecture", "Architecture", `
        SELECT a.slug AS value, a.name AS label, COUNT(DISTINCT v.software_slug) AS held
        FROM catalogue_versions v JOIN version_architectures va ON va.version_id = v.id
        JOIN architectures a ON a.slug = va.architecture_slug
        GROUP BY a.slug ORDER BY held DESC, a.name`),
      yesNo("live", "Published", "published = 1"),
      yesNo("hasfiles", "Holds files", "file_count > 0"),
      yesNo("hasicon", "Has an icon", "(icon_key IS NOT NULL OR icon_hotlink_slug IS NOT NULL)"),
      yesNo("described", "Has a description", "(description IS NOT NULL AND trim(description) <> '')"),
    ],
    where: {
      category: "category_slug = ?",
      language: "EXISTS (SELECT 1 FROM catalogue_files f JOIN file_languages j ON j.file_id = f.id " +
        "WHERE f.software_slug = held.slug AND j.language_slug = ?)",
      filetype: "EXISTS (SELECT 1 FROM catalogue_files f " +
        "WHERE f.software_slug = held.slug AND f.file_type_slug = ?)",
      architecture: "EXISTS (SELECT 1 FROM catalogue_versions v " +
        "WHERE v.software_slug = held.slug AND EXISTS (SELECT 1 FROM version_architectures va " +
        "WHERE va.version_id = v.id AND va.architecture_slug = ?))",
      publisher: "EXISTS (SELECT 1 FROM software_publishers j " +
        "WHERE j.software_slug = held.slug AND j.publisher_slug = ?)",
      platform: "EXISTS (SELECT 1 FROM software_platforms j " +
        "WHERE j.software_slug = held.slug AND j.platform_slug = ?)",
      interface: "EXISTS (SELECT 1 FROM software_interfaces j " +
        "WHERE j.software_slug = held.slug AND j.interface_slug = ?)",
    },
    columns: [
      col("name", "Name", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
      col("slug", "Slug", "slug", "text", { own: true, width: "12rem" }),
      col("category", "Category", "category_name", "text", { on: true, width: "11rem",
        href: (root, held) => `${root}/browse/${held.category_slug}` }),
      col("publisher", "Publisher", "publisher_names", "text", { on: true, width: "12rem" }),
      col("platform", "Platforms", "platform_names", "text", { width: "11rem" }),
      col("interface", "Interfaces", "interface_names", "text", { width: "9rem" }),
      col("processor", "Processor", "minimum_cpu_name", "text", { width: "8rem" }),
      col("ram", "Minimum RAM", "minimum_ram_bytes", "number", { unit: "size", width: "7rem",
        cell: (held) => ({ text: describedMeasure(held.minimum_ram_size, held.minimum_ram_unit) }) }),
      col("disk", "Free disk", "minimum_disk_bytes", "number", { unit: "size", width: "7rem",
        cell: (held) => ({ text: describedMeasure(held.minimum_disk_size, held.minimum_disk_unit) }) }),
      col("clock", "Clock speed", "minimum_cpu_hertz", "number", { unit: "hertz", width: "7rem",
        cell: (held) => ({ text: describedMeasure(held.minimum_cpu_speed, held.minimum_cpu_speed_unit) }) }),
      col("language", "Languages", "language_names", "text", { own: true, width: "9rem",
        cell: (held) => ({ text: held.language_names ?? "", muted: true }) }),
      col("filetype", "File types", "file_type_names", "text", { own: true, width: "9rem",
        cell: (held) => ({ text: held.file_type_names ?? "", muted: true }) }),
      col("architecture", "Architectures", "architecture_names", "text", { own: true, width: "9rem",
        cell: (held) => ({ text: held.architecture_names ?? "", muted: true }) }),
      col("released", "Released", "released_on", "date",
        { cell: (held) => ({ text: describedDate(held.released_on), muted: true }) }),
      col("eol", "End of life", "end_of_life", "date",
        { cell: (held) => ({ text: describedDate(held.end_of_life), muted: true }) }),
      col("versions", "Versions", "version_count", "number", { on: true,
        href: (root, held) => `${root}/versions?software=${held.slug}` }),
      col("files", "Files", "file_count", "number", { on: true,
        href: (root, held) => `${root}/files?software=${held.slug}` }),
      col("size", "Size", "bytes_held", "number",
        { width: "6.5rem", cell: (held) => ({ text: describedSize(held.bytes_held) }) }),
      col("downloads", "Downloads", "downloads", "number", { width: "7rem" }),
      col("live", "State", "published", "flag", { on: true, width: "6rem",
        href: (root, held) => `${root}/software?live=${held.published ? "yes" : "no"}`,
        cell: (held) => ({ text: held.published ? "Live" : "Hidden", warn: !held.published }) }),
      col("added", "Added", "created_at", "date",
        { cell: (held) => ({ text: describedDate(held.created_at), muted: true, stamp: held.created_at }) }),
    ],
    href: (root, held) => `${root}/browse/${held.category_slug}/${held.slug}`,
  },

  versions: {
    label: "Versions",
    path: "versions",
    permission: "versions",
    makes: true,
    flag: "atVersions",
    from: "SELECT * FROM catalogue_versions",
    search: ["version", "slug", "software_name", "software_slug", "notes", "released_on"],
    reach: `EXISTS (SELECT 1 FROM catalogue_files f WHERE f.version_id = held.id
              AND (f.display_name LIKE ?t ESCAPE '~' OR f.slug LIKE ?t ESCAPE '~'))`,
    order: "software_name, sort_order",
    sorts: [
      { key: "name", label: "Title", clause: "software_name, sort_order" },
      { key: "released", label: "Newest release", clause: "released_on DESC" },
      { key: "files", label: "Most files", clause: "file_count DESC, software_name" },
    ],
    facets: [
      countedBy("software", "Title", `
        SELECT software_slug AS value, software_name AS label, COUNT(*) AS held
        FROM catalogue_versions GROUP BY software_slug ORDER BY held DESC, software_name`),
      countedBy("platform", "Platform", `
        SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
        FROM version_platforms vp JOIN platforms p ON p.slug = vp.platform_slug
        GROUP BY p.slug ORDER BY held DESC, p.name`),
      countedBy("architecture", "Architecture", `
        SELECT a.slug AS value, a.name AS label, COUNT(*) AS held
        FROM versions v JOIN version_architectures va ON va.version_id = v.id
        JOIN architectures a ON a.slug = va.architecture_slug
        GROUP BY a.slug ORDER BY held DESC, a.name`),
      countedBy("category", "Category", `
        SELECT c.slug AS value, c.name AS label, COUNT(v.id) AS held
        FROM categories c JOIN catalogue_versions v ON v.category_slug = c.slug
        GROUP BY c.slug ORDER BY held DESC, c.name`),
      countedBy("publisher", "Publisher", `
        SELECT p.slug AS value, p.name AS label, COUNT(v.id) AS held
        FROM software_publishers j JOIN publishers p ON p.slug = j.publisher_slug
        JOIN catalogue_versions v ON v.software_slug = j.software_slug
        GROUP BY p.slug ORDER BY held DESC, p.name`),
      yesNo("hasfiles", "Holds files", "file_count > 0"),
      yesNo("dated", "Has a date", "(released_on IS NOT NULL AND released_on <> '')"),
      yesNo("shots", "Has screenshots", "screenshot_count > 0"),
    ],
    where: {
      software: "software_slug = ?",
      platform: "EXISTS (SELECT 1 FROM version_platforms j " +
        "WHERE j.version_id = held.id AND j.platform_slug = ?)",
      architecture: "EXISTS (SELECT 1 FROM version_architectures j " +
        "WHERE j.version_id = held.id AND j.architecture_slug = ?)",
      category: "category_slug = ?",
      publisher: "EXISTS (SELECT 1 FROM software_publishers j " +
        "WHERE j.software_slug = held.software_slug AND j.publisher_slug = ?)",
    },
    columns: [
      col("version", "Version", "version", "text", { on: true, fixed: true, link: (held) => held.version }),
      col("slug", "Slug", "slug", "text", { own: true, width: "12rem" }),
      col("software", "Title", "software_name", "text", { on: true, width: "16rem",
        href: (root, held) => `${root}/browse/${held.category_slug}/${held.software_slug}` }),
      col("released", "Released", "released_on", "date", { on: true,
        cell: (held) => ({ text: describedDate(held.released_on), muted: true }) }),
      col("architecture", "Architecture", "architecture", "text", { on: true, width: "9rem" }),
      col("platform", "Platforms", "platform_names", "text", { width: "11rem" }),
      col("notes", "Notes", "notes", "text",
        { cell: (held) => ({ text: plain(held.notes, Infinity), muted: true }) }),
      col("files", "Files", "file_count", "number", { on: true,
        href: (root, held) => `${root}/files?software=${held.software_slug}` }),
      col("shots", "Shots", "screenshot_count", "number", {}),
      col("size", "Size", "bytes_held", "number",
        { width: "6.5rem", cell: (held) => ({ text: describedSize(held.bytes_held) }) }),
    ],
    href: (root, held) =>
      `${root}/browse/${held.category_slug}/${held.software_slug}/${held.slug}`,
  },

  files: {
    label: "Files",
    path: "files",
    permission: "files",
    makes: true,
    flag: "atFiles",
    from: "SELECT * FROM catalogue_files",
    search: ["display_name", "slug", "software_name", "version", "notes",
             "platform_names", "language_names", "external_url", "hotlink_name", "object_key"],
    order: "software_name, version, display_name",
    sorts: [
      { key: "name", label: "Title", clause: "software_name, version, display_name" },
      { key: "size", label: "Largest", clause: "size_bytes DESC" },
      { key: "downloads", label: "Most downloaded", clause: "downloads DESC" },
    ],
    facets: [
      countedBy("software", "Title", `
        SELECT software_slug AS value, software_name AS label, COUNT(*) AS held
        FROM catalogue_files GROUP BY software_slug ORDER BY held DESC, software_name`),
      countedBy("filetype", "File type", `
        SELECT t.slug AS value, t.name AS label, COUNT(*) AS held
        FROM files f JOIN file_types t ON t.slug = f.file_type_slug
        GROUP BY t.slug ORDER BY held DESC, t.name`),
      countedBy("language", "Language", `
        SELECT l.slug AS value, l.name AS label, COUNT(*) AS held
        FROM file_languages j JOIN languages l ON l.slug = j.language_slug
        GROUP BY l.slug ORDER BY held DESC, l.name`),
      countedBy("category", "Category", `
        SELECT c.slug AS value, c.name AS label, COUNT(f.id) AS held
        FROM categories c JOIN catalogue_files f ON f.category_slug = c.slug
        GROUP BY c.slug ORDER BY held DESC, c.name`),
      countedBy("publisher", "Publisher", `
        SELECT p.slug AS value, p.name AS label, COUNT(f.id) AS held
        FROM software_publishers j JOIN publishers p ON p.slug = j.publisher_slug
        JOIN catalogue_files f ON f.software_slug = j.software_slug
        GROUP BY p.slug ORDER BY held DESC, p.name`),
      countedBy("architecture", "Architecture", `
        SELECT a.slug AS value, a.name AS label, COUNT(f.id) AS held
        FROM architectures a JOIN file_architectures fa ON fa.architecture_slug = a.slug
        JOIN catalogue_files f ON f.id = fa.file_id
        GROUP BY a.slug ORDER BY held DESC, a.name`),
      yesNo("live", "Published", "published = 1"),
      yesNo("hotlinked", "Hotlinked", "is_external = 1"),
      yesNo("summed", "Has a checksum", "(checksum IS NOT NULL AND checksum <> '')"),
    ],
    where: {
      software: "software_slug = ?",
      filetype: "file_type_slug = ?",
      language: "EXISTS (SELECT 1 FROM file_languages j WHERE j.file_id = held.id " +
        "AND j.language_slug = ?)",
      category: "category_slug = ?",
      architecture: "EXISTS (SELECT 1 FROM file_architectures j " +
        "WHERE j.file_id = held.id AND j.architecture_slug = ?)",
      publisher: "EXISTS (SELECT 1 FROM software_publishers j " +
        "WHERE j.software_slug = held.software_slug AND j.publisher_slug = ?)",
    },
    columns: [
      col("name", "File", "display_name", "text",
        { on: true, fixed: true, link: (held) => held.display_name }),
      col("slug", "Slug", "slug", "text", { own: true, width: "12rem" }),
      col("software", "Belongs to", "software_name", "text", { on: true, width: "15rem",
        href: (root, held) =>
          `${root}/browse/${held.category_slug}/${held.software_slug}/${held.version_slug}`,
        cell: (held) => ({ text: `${held.software_name} ${held.version}`, muted: true }) }),
      col("filetype", "Type", "file_type", "text", { on: true, width: "7rem",
        href: (root, held) => `${root}/filetypes/${held.file_type_slug}` }),
      col("extension", "Extension", "extension", "text", { own: true, width: "6rem" }),
      col("size", "Size", "size_bytes", "number", { unit: "size", on: true, width: "6.5rem",
        cell: (held) => ({ text: describedSize(held.size_bytes) }) }),
      col("held", "Held", "is_external", "flag", { on: true, width: "6rem",
        href: (root, held) => `${root}/files?hotlinked=${held.is_external ? "yes" : "no"}`,
        cell: (held) => ({ text: held.is_external ? "Linked" : "Bucket", muted: true }) }),
      col("checksum", "Checksum", "checksum", "text", { own: true, width: "9rem",
        cell: (held) => ({ text: held.checksum ?? "", muted: true }) }),
      col("algorithm", "Checksum kind", "checksum_algorithm", "text", { own: true, width: "7rem",
        cell: (held) => ({ text: held.checksum_algorithm ?? "", muted: true }) }),
      col("language", "Languages", "language_names", "text", { width: "9rem" }),
      col("downloads", "Downloads", "downloads", "number", { width: "7rem" }),
      col("notes", "Notes", "notes", "text",
        { cell: (held) => ({ text: plain(held.notes, Infinity), muted: true }) }),
      col("live", "State", "published", "flag", { on: true, width: "6rem",
        href: (root, held) => `${root}/files?live=${held.published ? "yes" : "no"}`,
        cell: (held) => ({ text: held.published ? "Live" : "Hidden", warn: !held.published }) }),
    ],
    href: (root, held) =>
      `${root}/browse/${held.category_slug}/${held.software_slug}/` +
      `${held.version_slug}/${held.slug}`,
  },
};


// The vocabularies differ only by which table they live in and what uses them,
// so they are described once and stamped out.
const VOCABULARIES = [
  ["platforms", "Platforms", "platforms", "software_platforms", "platform_slug", "titles"],
  ["devices", "Hardware", "devices", "file_devices", "device_slug", "files"],
  ["languages", "Languages", "languages", "file_languages", "language_slug", "files"],
  ["interfaces", "Interfaces", "interfaces", "software_interfaces", "interface_slug", "titles"],
  ["architectures", "Architectures", "architectures", "version_architectures", "architecture_slug", "versions"],
  ["filetypes", "File Types", "file_types", "files", "file_type_slug", "files"],
  ["processors", "Processors", "processors", "software", "minimum_cpu_slug", "titles"],
  ["publishers", "Publishers", "publishers", "software_publishers", "publisher_slug", "titles"],
];

for (const [kind, label, table, used, column, noun] of VOCABULARIES) {
  COLLECTIONS[kind] = {
    label,
    path: kind,
    permission: kind,
    makes: true,
    flag: `at${label.replace(/ /g, "")}`,
    from: `SELECT t.slug, t.name, t.sort_order,
                  (SELECT COUNT(*) FROM ${used} u WHERE u.${column} = t.slug) AS used
           FROM ${table} t`,
    search: ["name", "slug"],
    order: "sort_order, name",
    sorts: [
      { key: "order", label: "Running order", clause: "sort_order, name" },
      { key: "name", label: "Name", clause: "name" },
      { key: "used", label: "Most used", clause: "used DESC, name" },
    ],
    facets: [yesNo("inuse", "In use", "used > 0")],
    columns: [
      col("name", "Name", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
      col("slug", "Slug", "slug", "text", { own: true, on: true, width: "16rem" }),
      col("used", capitalised(noun), "used", "number", { on: true }),
      col("order", "Order", "sort_order", "number", {}),
    ],
    href: (root, held) => `${root}/${kind}/${held.slug}`,
  };
}

// Hardware carries more than a name, and the listing is where you check it.
COLLECTIONS.devices.from = `SELECT t.slug, t.name, t.sort_order, t.released_on,
              (SELECT p.name FROM publishers p WHERE p.slug = t.vendor_slug) AS vendor,
              (SELECT k.name FROM device_kinds k WHERE k.slug = t.kind_slug) AS kind,
              (SELECT COUNT(*) FROM file_devices u WHERE u.device_slug = t.slug) AS used
       FROM devices t`;
COLLECTIONS.devices.search = ["name", "slug"];
COLLECTIONS.devices.sorts.push({ key: "released", label: "Oldest first", clause: "released_on, name" });
COLLECTIONS.devices.columns.splice(2, 0,
  col("vendor", "Vendor", "vendor", "text", { on: true, width: "12rem" }),
  col("kind", "Kind", "kind", "text", { on: true, width: "10rem" }),
  col("released", "Released", "released_on", "date", { on: true, width: "9rem",
    cell: (held) => ({ text: describedDate(held.released_on), muted: true }) }));

COLLECTIONS.hotlinks = {
  label: "Hotlinks",
  path: "hotlinks",
  permission: "hotlinks",
  makes: true,
  flag: "atHotlinks",
  from: "SELECT * FROM catalogue_hotlinks",
  search: ["name", "slug", "target_url", "notes"],
  order: "name",
  sorts: [
    { key: "name", label: "Name", clause: "name" },
    { key: "added", label: "Newest", clause: "added_at DESC" },
    { key: "size", label: "Largest", clause: "size_bytes DESC" },
    { key: "used", label: "Most used", clause: "(file_count + icon_count + screenshot_count) DESC, name" },
  ],
  facets: [
    yesNo("inuse", "In use", "(file_count + icon_count + screenshot_count) > 0"),
    yesNo("sized", "Size recorded", "(size_bytes IS NOT NULL AND size_bytes > 0)"),
  ],
  columns: [
    col("name", "Name", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
    col("slug", "Slug", "slug", "text", { own: true, width: "14rem" }),
    col("host", "Points at", "target_url", "text",
      { on: true, width: "14rem", cell: (held) => ({ text: hostOf(held.target_url), muted: true }) }),
    col("target", "Full link", "target_url", "text", { own: true,}),
    col("size", "Size", "size_bytes", "number", { unit: "size", on: true, width: "6.5rem",
      cell: (held) => ({ text: held.size_bytes ? describedSize(held.size_bytes) : "" }) }),
    col("used", "Used", "(file_count + icon_count + screenshot_count)", "number", { on: true,
      cell: (held) => ({ text: String(held.file_count + held.icon_count + held.screenshot_count) }) }),
    col("notes", "Notes", "notes", "text",
      { cell: (held) => ({ text: plain(held.notes, Infinity), muted: true }) }),
    col("added", "Added", "added_at", "date",
      { cell: (held) => ({ text: describedDate(held.added_at), muted: true, stamp: held.added_at }) }),
  ],
  href: (root, held) => `${root}/hotlinks/${held.slug}`,
};

COLLECTIONS.requests = {
  label: "Requests",
  path: "requests",
  permission: "requests",
  flag: "atRequests",
  from: "SELECT * FROM requests",
  search: ["title", "publisher", "wanted_version", "notes", "asked_by"],
  order: "happened_at DESC",
  sorts: [
    { key: "newest", label: "Newest", clause: "happened_at DESC" },
    { key: "title", label: "Title", clause: "title" },
  ],
  facets: [
    countedBy("state", "State", `
      SELECT state AS value, state AS label, COUNT(*) AS held
      FROM requests GROUP BY state ORDER BY held DESC, state`),
  ],
  where: { state: "state = ?" },
  columns: [
    col("title", "Wanted", "title", "text", { on: true, fixed: true, link: (held) => held.title }),
    col("publisher", "Publisher", "publisher", "text", { on: true, width: "12rem" }),
    col("version", "Version", "wanted_version", "text", { on: true, width: "8rem" }),
    col("asked", "Asked", "happened_at", "date", { on: true,
      cell: (held) => ({ text: describedDate(held.happened_at), muted: true, stamp: held.happened_at }) }),
    col("by", "Asked by", "asked_by", "text", { width: "12rem" }),
    col("link", "Link", "link", "text", { own: true,}),
    col("notes", "Notes", "notes", "text",
      { cell: (held) => ({ text: plain(held.notes, Infinity), muted: true }) }),
    col("state", "State", "state", "text", { on: true, width: "7rem" }),
  ],
  href: (root, held) => `${root}/requests/${held.id}`,
};

COLLECTIONS.people = {
  label: "People",
  path: "people",
  permission: "people",
  flag: "atPeople",
  from: `SELECT m.id, m.email, m.display_name, m.last_seen_at, m.created_at, m.role_id,
                r.name AS role_name
         FROM managers m LEFT JOIN roles r ON r.id = m.role_id`,
  search: ["email", "display_name", "role_name"],
  order: "email",
  sorts: [
    { key: "email", label: "Email", clause: "email" },
    { key: "seen", label: "Last seen", clause: "last_seen_at DESC" },
    { key: "joined", label: "Newest", clause: "created_at DESC" },
  ],
  facets: [
    countedBy("role", "Role", `
      SELECT r.id AS value, r.name AS label, COUNT(m.id) AS held
      FROM roles r LEFT JOIN managers m ON m.role_id = r.id
      GROUP BY r.id ORDER BY held DESC, r.name`),
    yesNo("seen", "Has signed in", "(last_seen_at IS NOT NULL AND last_seen_at <> '')"),
  ],
  where: { role: "role_id = ?" },
  columns: [
    col("email", "Email", "email", "text", { on: true, fixed: true, link: (held) => held.email }),
    col("name", "Name", "display_name", "text", { on: true, width: "14rem" }),
    col("role", "Role", "role_name", "text", { on: true, width: "10rem",
      href: (root, held) => (held.role_id ? `${root}/roles/${held.role_id}` : null),
      cell: (held) => ({ text: held.role_name ?? "no role", warn: !held.role_name }) }),
    col("seen", "Last seen", "last_seen_at", "date", { on: true,
      cell: (held) => ({ text: describedDate(held.last_seen_at), muted: true }) }),
    col("joined", "Joined", "created_at", "date",
      { cell: (held) => ({ text: describedDate(held.created_at), muted: true, stamp: held.created_at }) }),
  ],
  href: (root, held) => `${root}/people/${held.id}`,
};

COLLECTIONS.roles = {
  label: "Roles",
  path: "roles",
  permission: "roles",
  makes: true,
  flag: "atRoles",
  from: `SELECT r.id, r.name, r.permissions, r.sort_order,
                (SELECT COUNT(*) FROM managers m WHERE m.role_id = r.id) AS people
         FROM roles r`,
  search: ["name", "permissions"],
  order: "sort_order, name",
  sorts: [
    { key: "order", label: "Running order", clause: "sort_order, name" },
    { key: "name", label: "Name", clause: "name" },
    { key: "people", label: "Most people", clause: "people DESC, name" },
  ],
  facets: [
    yesNo("everything", "May do everything", "permissions = '*'"),
    yesNo("held", "Given to someone", "people > 0"),
  ],
  columns: [
    col("name", "Role", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
    col("permissions", "May do", "permissions", "text", { own: true, on: true, width: "12rem",
      cell: (held) => ({
        text: held.permissions === "*"
          ? "everything"
          : `${held.permissions.split(",").filter(Boolean).length} permissions`,
        muted: true,
      }) }),
    col("grants", "Permissions", "permissions", "text", { own: true,}),
    col("people", "People", "people", "number", { on: true,
      href: (root, held) => `${root}/people?role=${held.id}` }),
    col("order", "Order", "sort_order", "number", {}),
  ],
  href: (root, held) => `${root}/roles/${held.id}`,
};

COLLECTIONS.keys = {
  label: "Keys",
  path: "keys",
  permission: "keys",
  makes: true,
  flag: "atKeys",
  from: `SELECT k.id, k.name, k.opening, k.created_at, k.last_used_at, k.revoked_at,
                m.email AS manager_email, r.name AS role_name,
                CASE WHEN k.revoked_at IS NULL THEN 1 ELSE 0 END AS live
         FROM api_keys k
         JOIN managers m ON m.id = k.manager_id
         LEFT JOIN roles r ON r.id = m.role_id`,
  search: ["name", "opening", "manager_email"],
  order: "created_at DESC",
  sorts: [
    { key: "newest", label: "Newest", clause: "created_at DESC" },
    { key: "name", label: "Name", clause: "name" },
    { key: "used", label: "Last used", clause: "last_used_at DESC" },
  ],
  facets: [
    yesNo("live", "Still open", "revoked_at IS NULL"),
    yesNo("everused", "Has been used", "last_used_at IS NOT NULL"),
  ],
  columns: [
    col("name", "Key", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
    col("opening", "Begins", "opening", "text", { on: true, width: "10rem",
      cell: (held) => ({ text: `${held.opening}…`, muted: true }) }),
    col("who", "Acts as", "manager_email", "text", { on: true, width: "14rem",
      href: (root, held) => `${root}/people?q=${held.manager_email}` }),
    col("role", "Role", "role_name", "text", { on: true, width: "9rem" }),
    col("live", "State", "live", "flag", { on: true, width: "7rem",
      cell: (held) => ({ text: held.live ? "Open" : "Revoked", muted: true }) }),
    col("used", "Last used", "last_used_at", "date", { on: true,
      cell: (held) => ({ text: (held.last_used_at ?? "").slice(0, 10) || "never", muted: true,
        stamp: held.last_used_at }) }),
    col("made", "Created", "created_at", "date", { own: true,
      cell: (held) => ({ text: (held.created_at ?? "").slice(0, 10), muted: true,
        stamp: held.created_at }) }),
  ],
  href: (root, held) => `${root}/keys/${held.id}`,
};

// The subject records what was touched, so it is decoded back into wherever
// that thing lives now. Three of them need the catalogue to say where that is.

function auditHref(root, held) {
  const at = String(held.subject ?? "").indexOf(":");

  if (at < 0) {
    return null;
  }

  const prefix = held.subject.slice(0, at);
  const rest = held.subject.slice(at + 1);

  if (prefix === "file") {
    return held.file_path ? `${root}/browse/${held.file_path}` : null;
  }

  if (prefix === "version" || prefix === "screenshot") {
    return held.item_path ? `${root}/browse/${held.item_path}` : null;
  }

  if (prefix === "role") {
    return held.role_id ? `${root}/roles/${held.role_id}` : null;
  }

  if (prefix === "object") {
    const folder = rest.slice(0, rest.lastIndexOf("/") + 1);

    return `${root}/bucket?prefix=${encodeURIComponent(folder)}` +
      `&q=${encodeURIComponent(rest.slice(folder.length))}`;
  }

  return AUDIT_PLACES[prefix] ? `${root}/${AUDIT_PLACES[prefix]}/${rest}` : null;
}

COLLECTIONS.audit = {
  label: "Audit Log",
  path: "audit",
  permission: "history",
  flag: "atAudit",
  from: `SELECT c.id, c.happened_at, c.subject, c.deed, c.detail, m.email,
                (SELECT f.category_slug || '/' || f.software_slug || '/' ||
                        f.version_slug || '/' || f.slug
                   FROM catalogue_files f WHERE c.subject = 'file:' || f.slug) AS file_path,
                COALESCE(
                  (SELECT v.category_slug || '/' || v.software_slug || '/' || v.slug
                     FROM catalogue_versions v
                    WHERE c.subject = 'version:' || v.software_slug || ' ' || v.version),
                  (SELECT v.category_slug || '/' || v.software_slug || '/' || v.slug
                     FROM version_screenshots x
                     JOIN catalogue_versions v ON v.id = x.version_id
                    WHERE c.subject = 'screenshot:' || x.slug)) AS item_path,
                (SELECT r.id FROM roles r WHERE c.subject = 'role:' || r.name) AS role_id
         FROM changes c LEFT JOIN managers m ON m.id = c.manager_id`,
  search: ["subject", "deed", "detail", "email"],
  order: "happened_at DESC",
  sorts: [
    { key: "newest", label: "Newest", clause: "happened_at DESC" },
    { key: "oldest", label: "Oldest", clause: "happened_at" },
    { key: "subject", label: "Subject", clause: "subject" },
  ],
  facets: [
    { ...countedBy("deed", "What happened", `
      SELECT deed AS value, deed AS label, COUNT(*) AS held
      FROM changes GROUP BY deed ORDER BY held DESC, deed`), raw: true },
    countedBy("who", "Who", `
      SELECT m.email AS value, m.email AS label, COUNT(*) AS held
      FROM changes c JOIN managers m ON m.id = c.manager_id
      GROUP BY m.email ORDER BY held DESC, m.email`),
  ],
  where: { deed: "deed = ?", who: "email = ?" },
  columns: [
    col("when", "When", "happened_at", "date", { on: true, width: "9.5rem",
      cell: (held) => ({ text: (held.happened_at ?? "").replace("T", " ").slice(0, 16), muted: true }) }),
    col("who", "Who", "email", "text", { on: true, width: "13rem" }),
    col("deed", "Did", "deed", "text", { on: true, width: "8rem" }),
    col("subject", "To", "subject", "text", { on: true, link: (held) => held.subject }),
    col("detail", "Detail", "detail", "text", { own: true, on: true,
      cell: (held) => ({ text: plain(held.detail, Infinity), muted: true }) }),
  ],
  href: (root, held) => auditHref(root, held),
};

// Where a kind of thing is listed, for rows that have no page of their own.
const FIND_HOMES = {
  categories: "categories", software: "software", versions: "versions", files: "files",
  platforms: "platforms", languages: "languages", interfaces: "interfaces",
  architectures: "architectures", filetypes: "filetypes", processors: "processors",
  publishers: "publishers", hotlinks: "hotlinks", requests: "requests",
  people: "people", roles: "roles", history: "audit",
};

COLLECTIONS.find = {
  label: "Search",
  path: "find",
  open: true,
  flag: "atFind",
  from: everythingFor,
  search: ["name", "belongs", "detail", "path"],
  order: "rank, name",
  sorts: [
    { key: "kind", label: "Kind", clause: "rank, name" },
    { key: "name", label: "Name", clause: "name" },
    { key: "newest", label: "Newest", clause: "at DESC, rank, name" },
  ],
  facets: [
    {
      name: "kind",
      label: "Kind",
      kind: "choice",
      sql: (manager) => `SELECT kind_slug AS value, kind AS label, COUNT(*) AS held
        FROM (${everythingFor(manager)}) GROUP BY kind_slug ORDER BY MIN(rank)`,
    },
    countedBy("category", "Category", `
      SELECT slug AS value, name AS label,
             (SELECT COUNT(*) FROM software s WHERE s.category = categories.slug) AS held
      FROM categories ORDER BY name`),
    countedBy("publisher", "Publisher", `
      SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
      FROM software_publishers j JOIN publishers p ON p.slug = j.publisher_slug
      GROUP BY p.slug ORDER BY held DESC, p.name`),
    countedBy("platform", "Platform", `
      SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
      FROM software_platforms j JOIN platforms p ON p.slug = j.platform_slug
      GROUP BY p.slug ORDER BY held DESC, p.name`),
    countedBy("language", "Language", `
      SELECT l.slug AS value, l.name AS label, COUNT(*) AS held
      FROM file_languages j JOIN languages l ON l.slug = j.language_slug
      GROUP BY l.slug ORDER BY held DESC, l.name`),
    countedBy("filetype", "File type", `
      SELECT t.slug AS value, t.name AS label, COUNT(*) AS held
      FROM files f JOIN file_types t ON t.slug = f.file_type_slug
      GROUP BY t.slug ORDER BY held DESC, t.name`),
    countedBy("interface", "Interface", `
      SELECT i.slug AS value, i.name AS label, COUNT(*) AS held
      FROM software_interfaces j JOIN interfaces i ON i.slug = j.interface_slug
      GROUP BY i.slug ORDER BY held DESC, i.name`),
    countedBy("architecture", "Architecture", `
      SELECT a.slug AS value, a.name AS label, COUNT(*) AS held
      FROM versions v JOIN version_architectures va ON va.version_id = v.id
      JOIN architectures a ON a.slug = va.architecture_slug
      GROUP BY a.slug ORDER BY held DESC, a.name`),
    countedBy("processor", "Processor", `
      SELECT p.slug AS value, p.name AS label, COUNT(*) AS held
      FROM software s JOIN processors p ON p.slug = s.minimum_cpu_slug
      GROUP BY p.slug ORDER BY held DESC, p.name`),
    {
      name: "state",
      label: "State",
      kind: "choice",
      sql: (manager) => `SELECT state AS value, state AS label, COUNT(*) AS held
        FROM (${everythingFor(manager)}) WHERE state <> '' GROUP BY state ORDER BY held DESC, state`,
    },
    yesNo("linked", "Has a page", "(path IS NOT NULL AND path <> '')"),
    yesNo("sized", "Has a size", "(size IS NOT NULL AND size > 0)"),
    yesNo("counted", "Holds something", "(tally IS NOT NULL AND tally > 0)"),
    yesNo("dated", "Has a date", "(at IS NOT NULL AND at <> '')"),
  ],
  where: {
    kind: "kind_slug = ?",
    category: "category_slug = ?",
    publisher: "publisher_names LIKE '%' || (SELECT name FROM publishers WHERE slug = ?) || '%'",
    platform: "platform_names LIKE '%' || (SELECT name FROM platforms WHERE slug = ?) || '%'",
    language: "language_names LIKE '%' || (SELECT name FROM languages WHERE slug = ?) || '%'",
    filetype: "file_type = (SELECT name FROM file_types WHERE slug = ?)",
    interface: "interface_names LIKE '%' || (SELECT name FROM interfaces WHERE slug = ?) || '%'",
    architecture: "architecture = (SELECT name FROM architectures WHERE slug = ?)",
    processor: "processor = (SELECT name FROM processors WHERE slug = ?)",
    state: "state = ?",
  },
  columns: [
    col("kind", "Kind", "kind", "text", { on: true, width: "8rem",
      href: (root, held) => `${root}/find?kind=${held.kind_slug}`,
      cell: (held) => ({ text: held.kind, muted: true }) }),
    col("name", "Name", "name", "text", { on: true, fixed: true, link: (held) => held.name }),
    col("belongs", "Belongs to", "belongs", "text", { own: true, on: true, width: "16rem" }),
    col("detail", "Detail", "detail", "text", { own: true, on: true,
      cell: (held) => ({ text: plain(held.detail, Infinity), muted: true }) }),
    col("path", "Where", "path", "text", { own: true,}),
    col("at", "When", "at", "date",
      { cell: (held) => ({ text: describedDate(held.at), muted: true }) }),
    col("state", "State", "state", "text", { width: "8rem" }),
    col("size", "Size", "size", "number", { unit: "size", width: "6.5rem",
      cell: (held) => ({ text: held.size ? describedSize(held.size) : "" }) }),
    col("tally", "Count", "tally", "number", {}),
    col("category", "Category", "category_slug", "text", { width: "11rem",
      href: (root, held) => (held.category_slug ? `${root}/browse/${held.category_slug}` : null) }),
    col("publisher", "Publisher", "publisher_names", "text", { width: "12rem", }),
    col("platform", "Platforms", "platform_names", "text", { width: "11rem", }),
    col("language", "Languages", "language_names", "text", { width: "10rem", }),
    col("filetype", "File type", "file_type", "text", { width: "8rem", }),
    col("interface", "Interfaces", "interface_names", "text", { width: "9rem", }),
    col("architecture", "Architecture", "architecture", "text", { width: "9rem", }),
    col("processor", "Processor", "processor", "text", { width: "8rem", }),
    col("ram", "Minimum RAM", "ram", "number", { unit: "size", width: "7rem" }),
    col("disk", "Free disk", "disk", "number", { unit: "size", width: "7rem" }),
    col("clock", "Clock speed", "clock", "number", { unit: "hertz", width: "7rem" }),
    col("released", "Released", "released", "date",
      { cell: (held) => ({ text: describedDate(held.released), muted: true }) }),
    col("eol", "End of life", "eol", "date",
      { cell: (held) => ({ text: describedDate(held.eol), muted: true }) }),
  ],
  href: (root, held) => (held.path
    ? `${root}/${held.path}`
    : `${root}/${FIND_HOMES[held.kind_slug] ?? "find"}?q=${encodeURIComponent(held.name ?? "")}`),
};
