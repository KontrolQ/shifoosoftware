import { applyMatch } from "./searching.js";

export const SORTS = [
  { value: "name", name: "Name", clause: "s.name ASC" },
  { value: "added", name: "Recently Added", clause: "s.created_at DESC" },
  { value: "versions", name: "Most Versions", clause: "versions DESC, s.name ASC" },
  { value: "publisher", name: "Publisher", clause: "s.publisher_names ASC, s.name ASC" },
];

export const SIZE_UNITS = { KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
export const SPEED_UNITS = { MHz: 1000000, GHz: 1000000000 };

const RESULT_LIMIT = 200;

// Each of these picks many values at once; anything chosen inside one widens the
// search, while each facet used narrows it.
export const CHOICE_FACETS = [
  { key: "category", label: "Category", of: "software" },
  { key: "publisher", label: "Publisher", of: "software" },
  { key: "platform", label: "Platform", of: "software" },
  { key: "interface", label: "User interface", of: "software" },
  { key: "processor", label: "Minimum processor", of: "software" },
  { key: "language", label: "Language", of: "file" },
  { key: "filetype", label: "File type", of: "file" },
];

export const RANGE_FACETS = [
  { key: "released", label: "Released", kind: "date" },
  { key: "eol", label: "End of life", kind: "date" },
  { key: "ram", label: "Minimum RAM", kind: "size" },
  { key: "disk", label: "Free disk space", kind: "size" },
  { key: "cpu", label: "Clock speed", kind: "speed" },
  { key: "filesize", label: "File size", kind: "size" },
];

function manyFrom(parameters, name) {
  return parameters
    .getAll(name)
    .flatMap((held) => String(held).split(","))
    .map((held) => held.trim())
    .filter((held) => held !== "");
}

function oneFrom(parameters, name) {
  const held = parameters.get(name);

  return held && held.trim() !== "" ? held.trim() : null;
}

// A date is chosen a part at a time, and any part may be left alone.
function dateFrom(parameters, name) {
  const year = oneFrom(parameters, `${name}_year`) ?? oneFrom(parameters, name);
  const month = oneFrom(parameters, `${name}_month`);
  const day = oneFrom(parameters, `${name}_day`);

  if (!year) {
    return null;
  }

  if (!month) {
    return year;
  }

  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function measureFrom(parameters, name, units) {
  const size = oneFrom(parameters, name);
  const unit = oneFrom(parameters, `${name}_unit`);

  if (!size || Number.isNaN(Number(size))) {
    return null;
  }

  return Number(size) * (units[unit] ?? 1);
}

export function filtersFrom(parameters) {
  const chosen = {};

  for (const facet of CHOICE_FACETS) {
    chosen[facet.key] = manyFrom(parameters, facet.key);
  }

  return {
    query: oneFrom(parameters, "q"),
    chosen,
    from: dateFrom(parameters, "from"),
    to: dateFrom(parameters, "to"),
    eolFrom: dateFrom(parameters, "eol_from"),
    eolTo: dateFrom(parameters, "eol_to"),
    ramFrom: measureFrom(parameters, "ram_from", SIZE_UNITS),
    ramTo: measureFrom(parameters, "ram_to", SIZE_UNITS),
    ramFromRaw: oneFrom(parameters, "ram_from"),
    ramToRaw: oneFrom(parameters, "ram_to"),
    ramFromUnit: oneFrom(parameters, "ram_from_unit"),
    ramToUnit: oneFrom(parameters, "ram_to_unit"),
    diskFrom: measureFrom(parameters, "disk_from", SIZE_UNITS),
    diskTo: measureFrom(parameters, "disk_to", SIZE_UNITS),
    diskFromRaw: oneFrom(parameters, "disk_from"),
    diskToRaw: oneFrom(parameters, "disk_to"),
    diskFromUnit: oneFrom(parameters, "disk_from_unit"),
    diskToUnit: oneFrom(parameters, "disk_to_unit"),
    cpuFrom: measureFrom(parameters, "cpu_from", SPEED_UNITS),
    cpuTo: measureFrom(parameters, "cpu_to", SPEED_UNITS),
    cpuFromRaw: oneFrom(parameters, "cpu_from"),
    cpuToRaw: oneFrom(parameters, "cpu_to"),
    cpuFromUnit: oneFrom(parameters, "cpu_from_unit"),
    cpuToUnit: oneFrom(parameters, "cpu_to_unit"),
    minimumSize: measureFrom(parameters, "filesize_from", SIZE_UNITS),
    maximumSize: measureFrom(parameters, "filesize_to", SIZE_UNITS),
    sizeFromRaw: oneFrom(parameters, "filesize_from"),
    sizeToRaw: oneFrom(parameters, "filesize_to"),
    sizeFromUnit: oneFrom(parameters, "filesize_from_unit"),
    sizeToUnit: oneFrom(parameters, "filesize_to_unit"),
    show: oneFrom(parameters, "show") ?? "both",
    sort: oneFrom(parameters, "sort") ?? "name",
  };
}

export function anyFilterSet(filters) {
  const picked = Object.values(filters.chosen).some((held) => held.length > 0);

  return Boolean(
    filters.query ||
      picked ||
      filters.from ||
      filters.to ||
      filters.eolFrom ||
      filters.eolTo ||
      filters.ramFrom ||
      filters.ramTo ||
      filters.diskFrom ||
      filters.diskTo ||
      filters.cpuFrom ||
      filters.cpuTo ||
      filters.minimumSize ||
      filters.maximumSize
  );
}

function anyOf(column, values, conditions, bindings) {
  if (values.length === 0) {
    return;
  }

  conditions.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  bindings.push(...values);
}

function existsAnyOf(clause, values, conditions, bindings) {
  if (values.length === 0) {
    return;
  }

  conditions.push(clause.replace("?list", values.map(() => "?").join(", ")));
  bindings.push(...values);
}

function between(column, low, high, conditions, bindings) {
  if (low !== null && low !== undefined) {
    conditions.push(`${column} >= ?`);
    bindings.push(low);
  }

  if (high !== null && high !== undefined) {
    conditions.push(`${column} <= ?`);
    bindings.push(high);
  }
}

// A partial date sorts correctly as text, so "1999" and "1999-06-10" compare cleanly.
function betweenDates(column, from, to, conditions, bindings) {
  if (from) {
    conditions.push(`${column} >= ?`);
    bindings.push(from);
  }

  if (to) {
    conditions.push(`${column} <= ?`);
    bindings.push(`${to}￿`);
  }
}

function softwareConditions(filters, conditions, bindings) {
  anyOf("s.category_slug", filters.chosen.category, conditions, bindings);

  existsAnyOf(
    "EXISTS (SELECT 1 FROM software_publishers sp WHERE sp.software_slug = s.slug AND sp.publisher_slug IN (?list))",
    filters.chosen.publisher, conditions, bindings
  );
  existsAnyOf(
    "EXISTS (SELECT 1 FROM software_platforms sp WHERE sp.software_slug = s.slug AND sp.platform_slug IN (?list))",
    filters.chosen.platform, conditions, bindings
  );
  existsAnyOf(
    "EXISTS (SELECT 1 FROM software_interfaces si WHERE si.software_slug = s.slug AND si.interface_slug IN (?list))",
    filters.chosen.interface, conditions, bindings
  );

  anyOf("s.minimum_cpu_slug", filters.chosen.processor, conditions, bindings);

  betweenDates("s.released_on", filters.from, filters.to, conditions, bindings);
  betweenDates("s.end_of_life", filters.eolFrom, filters.eolTo, conditions, bindings);
  between("s.minimum_ram_bytes", filters.ramFrom, filters.ramTo, conditions, bindings);
  between("s.minimum_disk_bytes", filters.diskFrom, filters.diskTo, conditions, bindings);
  between("s.minimum_cpu_hertz", filters.cpuFrom, filters.cpuTo, conditions, bindings);
}

function fileReach(filters, conditions, bindings) {
  const inner = [];
  const held = [];

  existsAnyOf(
    "EXISTS (SELECT 1 FROM file_languages fl WHERE fl.file_id = f.id AND fl.language_slug IN (?list))",
    filters.chosen.language, inner, held
  );
  anyOf("f.file_type_slug", filters.chosen.filetype, inner, held);
  between("f.size_bytes", filters.minimumSize, filters.maximumSize, inner, held);

  if (inner.length === 0) {
    return;
  }

  conditions.push(`EXISTS (
    SELECT 1 FROM catalogue_files f
    WHERE f.software_slug = s.slug AND f.published = 1 AND ${inner.join(" AND ")})`);
  bindings.push(...held);
}

function sortClause(sort) {
  const held = SORTS.find((candidate) => candidate.value === sort);

  return (held ?? SORTS[0]).clause;
}

export async function searchSoftware(database, filters) {
  const conditions = ["s.published = 1"];
  const bindings = [];

  applyMatch(
    filters.query,
    ["s.name", "s.slug", "s.publisher_names", "s.description", "s.category_name",
     "s.platform_names", "s.interface_names", "s.minimum_cpu_name"],
    `EXISTS (SELECT 1 FROM versions v WHERE v.software_slug = s.slug
             AND (v.version LIKE ?t ESCAPE '~' OR v.slug LIKE ?t ESCAPE '~'
                  OR v.notes LIKE ?t ESCAPE '~' OR v.architecture_slug LIKE ?t ESCAPE '~'))
     OR EXISTS (SELECT 1 FROM files f JOIN versions v ON v.id = f.version_id
                WHERE v.software_slug = s.slug AND f.published = 1
                AND (f.display_name LIKE ?t ESCAPE '~' OR f.slug LIKE ?t ESCAPE '~'
                     OR f.notes LIKE ?t ESCAPE '~' OR f.file_type_slug LIKE ?t ESCAPE '~'))`,
    conditions,
    bindings
  );

  softwareConditions(filters, conditions, bindings);
  fileReach(filters, conditions, bindings);

  const held = await database
    .prepare(`
      SELECT s.slug, s.name, s.category_slug AS category, s.publisher_names AS publisher, s.description,
             s.created_at, s.icon_key, s.icon_hotlink_slug,
             (SELECT COUNT(*) FROM versions v WHERE v.software_slug = s.slug) AS versions,
             (SELECT v.version FROM versions v WHERE v.software_slug = s.slug
              ORDER BY v.sort_order DESC, v.version DESC LIMIT 1) AS latest
      FROM catalogue_software s
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${sortClause(filters.sort)}
      LIMIT ${RESULT_LIMIT}`)
    .bind(...bindings)
    .all();

  return held.results ?? [];
}

export async function searchFiles(database, filters) {
  const conditions = ["s.published = 1"];
  const bindings = [];

  applyMatch(
    filters.query,
    ["f.display_name", "f.slug", "f.notes", "f.software_name", "f.version", "f.architecture",
     "f.platform_names", "f.language_names", "f.file_type", "f.hotlink_name"],
    `EXISTS (SELECT 1 FROM catalogue_software cs WHERE cs.slug = f.software_slug
             AND (cs.publisher_names LIKE ?t ESCAPE '~' OR cs.description LIKE ?t ESCAPE '~'
                  OR cs.category_name LIKE ?t ESCAPE '~'))`,
    conditions,
    bindings
  );

  // a file belongs to a title, so a title-level filter narrows the files too;
  // without this, asking for "16 MB of RAM" would still list every download
  softwareConditions(filters, conditions, bindings);

  anyOf("f.file_type_slug", filters.chosen.filetype, conditions, bindings);
  existsAnyOf(
    "EXISTS (SELECT 1 FROM file_languages fl WHERE fl.file_id = f.id AND fl.language_slug IN (?list))",
    filters.chosen.language, conditions, bindings
  );
  between("f.size_bytes", filters.minimumSize, filters.maximumSize, conditions, bindings);

  const held = await database
    .prepare(`
      SELECT f.id, f.slug, f.display_name, f.file_type, f.extension, f.size_bytes, f.object_key,
             f.is_external, f.version_slug, f.version, f.software_slug, f.software_name,
             f.category_slug AS category, f.platform_names AS platform
      FROM catalogue_files f
      JOIN catalogue_software s ON s.slug = f.software_slug
      WHERE f.published = 1 AND ${conditions.join(" AND ")}
      ORDER BY s.name, f.version DESC, f.display_name
      LIMIT ${RESULT_LIMIT}`)
    .bind(...bindings)
    .all();

  return held.results ?? [];
}

export function tidiedQuery(parameters) {
  const kept = new URLSearchParams();

  for (const [name, value] of parameters) {
    if (value !== null && value.trim() !== "") {
      kept.append(name, value.trim());
    }
  }

  return kept;
}

export function needsTidying(parameters) {
  return tidiedQuery(parameters).toString() !== parameters.toString();
}
