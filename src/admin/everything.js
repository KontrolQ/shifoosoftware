import { can } from "./permissions.js";
import { AUDIT_PLACES } from "./audit-places.js";

// One search over every collection at once. Each branch yields the same shape,
// so the whole listing machinery — facets, sorting, saved views, paging — applies.
const OBJECT_PATH = "'bucket?q=' || substr(c.subject, 8)";

function subjectCase(places) {
  const arms = Object.entries(places).map(([prefix, place]) =>
    `WHEN c.subject LIKE '${prefix}:%' THEN '${place}/' || substr(c.subject, ${prefix.length + 2})`);

  return `CASE WHEN c.subject LIKE 'object:%' THEN ${OBJECT_PATH} ${arms.join(" ")} END`;
}

const HISTORY_PATH = `COALESCE(
  (SELECT 'browse/' || f.category_slug || '/' || f.software_slug || '/' ||
          f.version_slug || '/' || f.slug
     FROM catalogue_files f WHERE c.subject = 'file:' || f.slug),
  (SELECT 'browse/' || v.category_slug || '/' || v.software_slug || '/' || v.slug
     FROM catalogue_versions v
    WHERE c.subject = 'version:' || v.software_slug || ' ' || v.version),
  (SELECT 'browse/' || v.category_slug || '/' || v.software_slug || '/' || v.slug
     FROM version_screenshots x JOIN catalogue_versions v ON v.id = x.version_id
    WHERE c.subject = 'screenshot:' || x.slug),
  (SELECT 'roles/' || r.id FROM roles r WHERE c.subject = 'role:' || r.name),
  ${subjectCase(AUDIT_PLACES)}, '')`;

function vocabularyBranch(label, kind, table, rank, used, column) {
  return [`${kind}.view`, `SELECT '${label}' AS kind, '${kind}' AS kind_slug, ${rank} AS rank,
      t.name AS name, '' AS belongs, t.slug AS detail,
      '${kind}/' || t.slug AS path, NULL AS at, '' AS state, NULL AS size,
      (SELECT COUNT(*) FROM ${used} u WHERE u.${column} = t.slug) AS tally,
      '' AS category_slug, '' AS publisher_names, '' AS platform_names,
      '' AS language_names, '' AS file_type, '' AS interface_names, '' AS architecture,
      '' AS processor, NULL AS ram, NULL AS disk, NULL AS clock, NULL AS released,
      NULL AS eol
    FROM ${table} t`];
}

const EVERYTHING = [
  ["categories.view", `SELECT 'Categories' AS kind, 'categories' AS kind_slug, 1 AS rank,
      c.name AS name, '' AS belongs, COALESCE(c.summary, '') AS detail,
      'browse/' || c.slug AS path, NULL AS at, '' AS state, NULL AS size,
      (SELECT COUNT(*) FROM software s WHERE s.category = c.slug) AS tally,
      c.slug AS category_slug, '' AS publisher_names, '' AS platform_names,
      '' AS language_names, '' AS file_type, '' AS interface_names, '' AS architecture,
      '' AS processor, NULL AS ram, NULL AS disk, NULL AS clock, NULL AS released,
      NULL AS eol
    FROM categories c`],
  ["software.view", `SELECT 'Software', 'software', 2,
      s.name, COALESCE(s.category_name, ''), COALESCE(s.publisher_names, ''),
      'browse/' || s.category_slug || '/' || s.slug, s.created_at,
      CASE WHEN s.published THEN 'Live' ELSE 'Hidden' END, s.bytes_held, s.version_count,
      s.category_slug, COALESCE(s.publisher_names, ''), COALESCE(s.platform_names, ''), '', '',
      COALESCE(s.interface_names, ''), '', COALESCE(s.minimum_cpu_name, ''),
      s.minimum_ram_bytes, s.minimum_disk_bytes, s.minimum_cpu_hertz, s.released_on,
      s.end_of_life
    FROM catalogue_software s`],
  ["versions.view", `SELECT 'Versions', 'versions', 3,
      v.version, COALESCE(v.software_name, ''), COALESCE(v.notes, ''),
      'browse/' || v.category_slug || '/' || v.software_slug || '/' || v.slug, v.released_on,
      CASE WHEN v.software_published THEN 'Live' ELSE 'Hidden' END, v.bytes_held, v.file_count,
      v.category_slug, '', COALESCE(v.platform_names, ''), '', '', '',
      COALESCE(v.architecture, ''), '', NULL, NULL, NULL, v.released_on, NULL
    FROM catalogue_versions v`],
  ["files.view", `SELECT 'Files', 'files', 4,
      f.display_name, f.software_name || ' ' || f.version, COALESCE(f.file_type, ''),
      'browse/' || f.category_slug || '/' || f.software_slug || '/' ||
        f.version_slug || '/' || f.slug, NULL,
      CASE WHEN f.published THEN 'Live' ELSE 'Hidden' END, f.size_bytes, f.downloads,
      f.category_slug, '', COALESCE(f.platform_names, ''), COALESCE(f.language_names, ''),
      COALESCE(f.file_type, ''), '', COALESCE(f.architecture, ''), '',
      NULL, NULL, NULL, NULL, NULL
    FROM catalogue_files f`],
  vocabularyBranch("Platforms", "platforms", "platforms", 5, "software_platforms", "platform_slug"),
  vocabularyBranch("Languages", "languages", "languages", 6, "file_languages", "language_slug"),
  vocabularyBranch("Interfaces", "interfaces", "interfaces", 7, "software_interfaces", "interface_slug"),
  vocabularyBranch("Architectures", "architectures", "architectures", 8, "versions", "architecture_slug"),
  vocabularyBranch("File Types", "filetypes", "file_types", 9, "files", "file_type_slug"),
  vocabularyBranch("Processors", "processors", "processors", 10, "software", "minimum_cpu_slug"),
  vocabularyBranch("Publishers", "publishers", "publishers", 11, "software_publishers", "publisher_slug"),
  ["hotlinks.view", `SELECT 'Hotlinks', 'hotlinks', 12,
      h.name, '', h.target_url, 'hotlinks/' || h.slug, h.added_at,
      '', h.size_bytes, NULL, '', '', '', '', '', '', '', '', NULL, NULL, NULL, NULL, NULL
    FROM hotlinks h`],
  ["requests.view", `SELECT 'Requests', 'requests', 13,
      r.title, COALESCE(r.publisher, ''), COALESCE(r.notes, ''), 'requests/' || r.id,
      r.happened_at, r.state, NULL, NULL, '', COALESCE(r.publisher, ''), '', '', '', '', '', '',
      NULL, NULL, NULL, NULL, NULL
    FROM requests r`],
  ["people.view", `SELECT 'People', 'people', 14,
      m.email, COALESCE(m.display_name, ''), '', 'people/' || m.id, m.created_at,
      '', NULL, NULL, '', '', '', '', '', '', '', '', NULL, NULL, NULL, NULL, NULL
    FROM managers m`],
  ["roles.view", `SELECT 'Roles', 'roles', 15,
      r.name, '', r.permissions, 'roles/' || r.id, NULL,
      '', NULL, (SELECT COUNT(*) FROM managers m WHERE m.role_id = r.id), '', '', '', '', '',
      '', '', '', NULL, NULL, NULL, NULL, NULL
    FROM roles r`],
  ["history.view", `SELECT 'History', 'history', 16,
      c.subject, COALESCE(m.email, ''),
      TRIM(COALESCE(c.deed, '') || ' ' || COALESCE(c.detail, '')),
      ${HISTORY_PATH}, c.happened_at, '', NULL, NULL, '', '', '', '', '',
      '', '', '', NULL, NULL, NULL, NULL, NULL
    FROM changes c LEFT JOIN managers m ON m.id = c.manager_id`],
];

const NOTHING = `SELECT '' AS kind, '' AS kind_slug, 0 AS rank, '' AS name, '' AS belongs,
  '' AS detail, '' AS path, NULL AS at, '' AS state, NULL AS size, NULL AS tally,
  '' AS category_slug, '' AS publisher_names, '' AS platform_names, '' AS language_names,
  '' AS file_type, '' AS interface_names, '' AS architecture, '' AS processor,
  NULL AS ram, NULL AS disk, NULL AS clock, NULL AS released, NULL AS eol WHERE 0`;

// D1 allows five terms in one compound SELECT, so the branches are nested
// into groups rather than laid out flat.
const MOST_TERMS = 4;

function nested(parts) {
  if (parts.length <= MOST_TERMS) {
    return parts.join(" UNION ALL ");
  }

  const groups = [];

  for (let at = 0; at < parts.length; at += MOST_TERMS) {
    groups.push(`SELECT * FROM (${parts.slice(at, at + MOST_TERMS).join(" UNION ALL ")})`);
  }

  return nested(groups);
}

function everythingFor(manager) {
  const allowed = EVERYTHING.filter(([permission]) => can(manager, permission)).map(([, sql]) => sql);

  return allowed.length > 0 ? nested(allowed) : NOTHING;
}

export { everythingFor };
