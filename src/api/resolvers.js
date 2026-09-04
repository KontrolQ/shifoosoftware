import { rendered } from "../markdown.js";
import { can } from "../admin/permissions.js";
import { applyMatch } from "../searching.js";
import { filesFor } from "../storage/bucket.js";

async function rowsOf(statement) {
  const held = await statement.all();

  return held.results ?? [];
}

function onlyVisible(manager, subject) {
  return can(manager, `${subject}.view`) ? "" : " AND published = 1";
}

// One shape for every list, so limit and offset behave the same wherever they appear.
const FACET_SOURCES = {
        category: `SELECT c.slug AS value, c.name AS label,
                     (SELECT COUNT(*) FROM catalogue_software s
                      WHERE s.category_slug = c.slug AND s.published = 1) AS held
                   FROM categories c`,
        publisher: `SELECT p.slug AS value, p.name AS label,
                     (SELECT COUNT(*) FROM software_publishers j WHERE j.publisher_slug = p.slug) AS held
                   FROM publishers p`,
        platform: `SELECT p.slug AS value, p.name AS label,
                     (SELECT COUNT(*) FROM software_platforms j WHERE j.platform_slug = p.slug) AS held
                   FROM platforms p`,
        interface: `SELECT i.slug AS value, i.name AS label,
                     (SELECT COUNT(*) FROM software_interfaces j WHERE j.interface_slug = i.slug) AS held
                   FROM interfaces i`,
        processor: `SELECT p.slug AS value, p.name AS label,
                     (SELECT COUNT(*) FROM software s WHERE s.minimum_cpu_slug = p.slug) AS held
                   FROM processors p`,
        language: `SELECT l.slug AS value, l.name AS label,
                     (SELECT COUNT(*) FROM file_languages j WHERE j.language_slug = l.slug) AS held
                   FROM languages l`,
        device: `SELECT d.slug AS value, d.name AS label,
                     (SELECT COUNT(*) FROM file_devices j WHERE j.device_slug = d.slug) AS held
                   FROM devices d`,
        filetype: `SELECT t.slug AS value, t.name AS label,
                     (SELECT COUNT(*) FROM files f WHERE f.file_type_slug = t.slug) AS held
                   FROM file_types t`,
};

const VOCABULARY_SOURCES = {
        architecture: { table: "architectures", used: "version_architectures", column: "architecture_slug" },
        filetype: { table: "file_types", used: "files", column: "file_type_slug" },
        processor: { table: "processors", used: "software", column: "minimum_cpu_slug" },
        device: { table: "devices", used: "file_devices", column: "device_slug" },
};

function paged(limit, offset) {
  return { limit: Math.min(Math.max(limit ?? 40, 1), 200), offset: Math.max(offset ?? 0, 0) };
}

// A date is handed over whole and in parts. Anything after the day is trimmed,
// so a timestamp and a year-only date read the same way.
function datePartsOf(held) {
  const text = String(held ?? "");

  if (text === "") {
    return null;
  }

  const [, year, month, day] = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/) ?? [];

  return {
    text,
    year: year ? Number(year) : null,
    month: month ? Number(month) : null,
    day: day ? Number(day) : null,
  };
}

function sees(manager, subject) {
  return Boolean(manager) && can(manager, `${subject}.view`);
}

function refuse(what) {
  throw new Error(`Not allowed: ${what}`);
}

export function resolversFor(environment, manager) {
  const database = environment.CATALOGUE;

  // the plain vocabularies differ only by table, so they share one reader
  // One page of one list, shaped the way AniList shapes it: the page carries the
  // window, each list fills it, and pageInfo reports on whichever list was asked for.
  const openPage = (page, perPage) => {
    const size = Math.min(Math.max(perPage ?? 20, 1), 200);
    const at = Math.max(page ?? 1, 1);
    let settle;
    const counted = new Promise((keep) => {
      settle = keep;
    });

    // nothing else selected means nothing to count
    setTimeout(() => settle(0), 0);

    return { page: at, perPage: size, limit: size, offset: (at - 1) * size, counted, settle };
  };

  const pageOf = async (held, countSql, rowsSql, bindings) => {
    const total = await database.prepare(countSql).bind(...bindings).first();

    held.settle(total?.held ?? 0);

    return rowsOf(
      database.prepare(rowsSql).bind(...bindings, held.limit, held.offset)
    );
  };

  const pagedVocabulary = (held, table, query) => {
    const conditions = [];
    const bindings = [];

    applyMatch(query, ["name", "slug"], null, conditions, bindings);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return pageOf(
      held,
      `SELECT COUNT(*) AS held FROM ${table} ${where}`,
      `SELECT * FROM ${table} ${where} ORDER BY sort_order, name LIMIT ? OFFSET ?`,
      bindings
    );
  };

  const pagedTable = (held, table, fields, query, order) => {
    const conditions = [];
    const bindings = [];

    applyMatch(query, fields, null, conditions, bindings);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return pageOf(
      held,
      `SELECT COUNT(*) AS held FROM ${table} ${where}`,
      `SELECT * FROM ${table} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      bindings
    );
  };

  const facetRows = (held, facet, query) => {
    const shape = FACET_SOURCES[facet];

    if (!shape) {
      throw new Error(`No facet called ${facet}`);
    }

    const conditions = [];
    const bindings = [];

    applyMatch(query, ["label", "value"], null, conditions, bindings);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return pageOf(
      held,
      `SELECT COUNT(*) AS held FROM (${shape}) ${where}`,
      `SELECT * FROM (${shape}) ${where} ORDER BY held DESC, label LIMIT ? OFFSET ?`,
      bindings
    );
  };

  const vocabularyRows = (table, query, limit, offset) => {
    const conditions = [];
    const bindings = [];

    applyMatch(query, ["name", "slug"], null, conditions, bindings);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const held = paged(limit, offset);

    return rowsOf(
      database
        .prepare(`SELECT * FROM ${table} ${where} ORDER BY sort_order, name LIMIT ? OFFSET ?`)
        .bind(...bindings, held.limit, held.offset)
    );
  };

  const softwareVisible = () => (sees(manager, "software") ? "" : " AND s.published = 1");
  // A file is only public when its own title is, or hiding a title would leave
  // its downloads on show.
  const filesVisible = () =>
    sees(manager, "files")
      ? ""
      : " AND f.published = 1 AND EXISTS (SELECT 1 FROM software owner" +
        " WHERE owner.slug = f.software_slug AND owner.published = 1)";

  return {
    PageInfo: {},

    Page: {
      pageInfo: async (held) => {
        const total = await held.counted;
        const lastPage = Math.max(1, Math.ceil(total / held.perPage));

        return {
          total,
          perPage: held.perPage,
          currentPage: held.page,
          lastPage,
          hasNextPage: held.page < lastPage,
        };
      },

      categories: (held, { query }) => pagedVocabulary(held, "categories", query),
      platforms: (held, { query }) => pagedVocabulary(held, "platforms", query),
      languages: (held, { query }) => pagedVocabulary(held, "languages", query),
      publishers: (held, { query }) => pagedVocabulary(held, "publishers", query),
      interfaces: (held, { query }) => pagedVocabulary(held, "interfaces", query),

      fileTypes: (held, { query }) => pagedVocabulary(held, "file_types", query),

      software: (held, { query, category }) => {
        const conditions = [];
        const bindings = [];

        applyMatch(query, ["s.name", "s.slug", "s.description"], null, conditions, bindings);

        if (category) {
          conditions.push("s.category = ?");
          bindings.push(category);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "WHERE 1 = 1";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM software s ${where}${softwareVisible()}`,
          `SELECT s.* FROM software s ${where}${softwareVisible()}
           ORDER BY s.sort_order, s.name LIMIT ? OFFSET ?`,
          bindings
        );
      },

      files: (held, { query }) => {
        const conditions = [];
        const bindings = [];

        applyMatch(query, ["f.display_name", "f.slug", "f.notes"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "WHERE 1 = 1";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM catalogue_files f ${where}${filesVisible()}`,
          `SELECT f.* FROM catalogue_files f ${where}${filesVisible()}
           ORDER BY f.display_name LIMIT ? OFFSET ?`,
          bindings
        );
      },

      requests: (held, { state, query }) => {
        const conditions = [];
        const bindings = [];

        if (state) {
          conditions.push("state = ?");
          bindings.push(state);
        }

        applyMatch(query, ["title", "publisher", "notes"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM requests ${where}`,
          `SELECT * FROM requests ${where} ORDER BY happened_at DESC LIMIT ? OFFSET ?`,
          bindings
        );
      },

      facetOptions: (held, { facet, query }) => facetRows(held, facet, query),

      versions: (held, { query }) => {
        const conditions = [];
        const bindings = [];

        applyMatch(query, ["v.version", "v.slug", "v.notes"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM catalogue_versions v ${where}`,
          `SELECT v.* FROM catalogue_versions v ${where}
           ORDER BY v.software_name, v.sort_order LIMIT ? OFFSET ?`,
          bindings
        );
      },

      people: (held, { query }) => {
        if (!sees(manager, "people")) {
          refuse("list people");
        }

        return pagedTable(held, "managers", ["email", "display_name"], query, "email");
      },

      roles: (held, { query }) => {
        if (!sees(manager, "roles")) {
          refuse("list roles");
        }

        return pagedTable(held, "roles", ["name", "permissions"], query, "sort_order, name");
      },

      changes: (held, { query }) => {
        if (!sees(manager, "history")) {
          refuse("read the audit log");
        }

        return pagedTable(held, "changes", ["subject", "deed", "detail"], query, "happened_at DESC");
      },

      hotlinks: (held, { query }) => {
        if (!sees(manager, "hotlinks")) {
          refuse("list hotlinks");
        }

        const conditions = [];
        const bindings = [];

        applyMatch(query, ["name", "slug", "target_url"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM catalogue_hotlinks ${where}`,
          `SELECT slug, name, target_url AS targetUrl, size_bytes AS sizeBytes,
                  (file_count + icon_count + screenshot_count) AS useCount
           FROM catalogue_hotlinks ${where} ORDER BY name LIMIT ? OFFSET ?`,
          bindings
        );
      },

      versionChoices: (held, { query }) => {
        if (!sees(manager, "versions")) {
          refuse("list versions");
        }

        const conditions = [];
        const bindings = [];

        applyMatch(query, ["version", "slug", "software_name"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM catalogue_versions ${where}`,
          `SELECT software_slug || '/' || slug AS path, version, software_name AS softwareName,
                  software_slug AS softwareSlug, file_count AS fileCount
           FROM catalogue_versions ${where} ORDER BY software_name, sort_order LIMIT ? OFFSET ?`,
          bindings
        );
      },

      vocabulary: (held, { kind, query }) => {
        const shape = VOCABULARY_SOURCES[kind];

        if (!shape) {
          throw new Error(`No vocabulary called ${kind}`);
        }

        const conditions = [];
        const bindings = [];

        applyMatch(query, ["t.name", "t.slug"], null, conditions, bindings);

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        return pageOf(
          held,
          `SELECT COUNT(*) AS held FROM ${shape.table} t ${where}`,
          `SELECT t.slug, t.name,
                  (SELECT COUNT(*) FROM ${shape.used} u WHERE u.${shape.column} = t.slug) AS used
           FROM ${shape.table} t ${where} ORDER BY t.sort_order, t.name LIMIT ? OFFSET ?`,
          bindings
        );
      },

      bucketObjects: async (held, { query, prefix }) => {
        if (!sees(manager, "bucket")) {
          refuse("browse the bucket");
        }

        const listed = await filesFor(environment).list({ prefix: prefix || undefined, limit: 1000 });
        const wanted = (query ?? "").trim().toLowerCase();
        const kept = listed.objects
          .filter((one) => !wanted || one.key.toLowerCase().includes(wanted))
          .map((one) => ({
            key: one.key,
            sizeBytes: one.size,
            uploadedAt: one.uploaded?.toISOString?.() ?? "",
            claimed: false,
          }));

        held.settle(kept.length);

        return kept.slice(held.offset, held.offset + held.limit);
      },
    },

    Query: {
      Page: (_root, { page, perPage }) => openPage(page, perPage),

      Software: (_root, { slug }) =>
        database
          .prepare(`SELECT s.* FROM software s WHERE s.slug = ?${softwareVisible()}`)
          .bind(slug)
          .first(),

      Category: (_root, { slug }) =>
        database.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first(),

      Version: (_root, { id }) =>
        database
          .prepare(`SELECT v.* FROM versions v JOIN software s ON s.slug = v.software_slug
                    WHERE v.id = ?${softwareVisible()}`)
          .bind(id)
          .first(),

      File: (_root, { id }) =>
        database
          .prepare(`SELECT f.* FROM catalogue_files f WHERE f.id = ?${filesVisible()}`)
          .bind(id)
          .first(),

      Publisher: (_root, { slug }) =>
        database.prepare("SELECT * FROM publishers WHERE slug = ?").bind(slug).first(),

      Platform: (_root, { slug }) =>
        database.prepare("SELECT * FROM platforms WHERE slug = ?").bind(slug).first(),

      Language: (_root, { slug }) =>
        database.prepare("SELECT * FROM languages WHERE slug = ?").bind(slug).first(),

      Interface: (_root, { slug }) =>
        database.prepare("SELECT * FROM interfaces WHERE slug = ?").bind(slug).first(),

      FileType: (_root, { slug }) =>
        database.prepare("SELECT * FROM file_types WHERE slug = ?").bind(slug).first(),

      Request: (_root, { id }) =>
        database.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first(),

      Viewer: () =>
        manager
          ? {
              email: manager.email,
              name: manager.name,
              roleName: manager.roleName,
              permissions: manager.permissions,
            }
          : null,

      Hotlink: (_root, { slug }) => {
        if (!sees(manager, "hotlinks")) {
          refuse("read hotlinks");
        }

        return database
          .prepare(`
            SELECT slug, name, target_url AS targetUrl, size_bytes AS sizeBytes,
                   (file_count + icon_count + screenshot_count) AS useCount
            FROM catalogue_hotlinks WHERE slug = ?`)
          .bind(slug)
          .first();
      },
    },

    Category: {
      summaryHtml: (row) => rendered(row.summary),
      titleCount: async (row) => {
        const held = await database
          .prepare(`SELECT COUNT(*) AS held FROM software s WHERE s.category = ?${softwareVisible()}`)
          .bind(row.slug)
          .first();

        return held.held;
      },
      software: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`SELECT s.* FROM software s WHERE s.category = ?${softwareVisible()} ORDER BY s.sort_order, s.name LIMIT ? OFFSET ?`)
            .bind(row.slug, paged(limit, offset).limit, paged(limit, offset).offset)
        ),
    },

    Software: {
      releasedOn: (row) => datePartsOf(row.released_on),
      endOfLife: (row) => datePartsOf(row.end_of_life),
      createdAt: (row) => datePartsOf(row.created_at),
      updatedAt: (row) => datePartsOf(row.updated_at),
      published: (row) => row.published === 1,
      publishers: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`
              SELECT p.* FROM publishers p JOIN software_publishers sp ON sp.publisher_slug = p.slug
              WHERE sp.software_slug = ? ORDER BY p.sort_order, p.name`)
            .bind(row.slug)
        ),
      descriptionHtml: (row) => rendered(row.description),
      iconUrl: (row) => (row.icon_key ? `/icon/${row.category}/${row.slug}` : null),
      category: (row) => database.prepare("SELECT * FROM categories WHERE slug = ?").bind(row.category).first(),
      versions: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare("SELECT * FROM versions WHERE software_slug = ? ORDER BY sort_order, version")
            .bind(row.slug)
        ),
      versionCount: async (row) => {
        const held = await database
          .prepare("SELECT COUNT(*) AS held FROM versions WHERE software_slug = ?")
          .bind(row.slug)
          .first();

        return held.held;
      },
      fileCount: async (row) => {
        const held = await database
          .prepare(`
            SELECT COUNT(*) AS held FROM files f JOIN versions v ON v.id = f.version_id
            WHERE v.software_slug = ?${filesVisible()}`)
          .bind(row.slug)
          .first();

        return held.held;
      },
    },

    Version: {
      releasedOn: (row) => datePartsOf(row.released_on),
      notesHtml: (row) => rendered(row.notes),
      software: (row) =>
        database
          .prepare(`SELECT s.* FROM software s WHERE s.slug = ?${softwareVisible()}`)
          .bind(row.software_slug)
          .first(),
      files: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`SELECT f.* FROM catalogue_files f WHERE f.version_id = ?${filesVisible()} ORDER BY f.sort_order, f.display_name`)
            .bind(row.id)
        ),
      fileCount: async (row) => {
        const held = await database
          .prepare(`SELECT COUNT(*) AS held FROM catalogue_files f
                    WHERE f.version_id = ?${filesVisible()}`)
          .bind(row.id)
          .first();

        return held.held;
      },
    },

    File: {
      fileType: (row) => row.file_type,
      sizeBytes: (row) => row.size_bytes,
      checksumAlgorithm: (row) => row.checksum_algorithm,
      published: (row) => row.published === 1,
      notesHtml: (row) => rendered(row.notes),
      objectKey: (row) => (sees(manager, "files") ? row.object_key : null),
      downloadUrl: async (row) => {
        const held = await database
          .prepare(`
            SELECT v.version, s.slug, s.category FROM versions v
            JOIN software s ON s.slug = v.software_slug WHERE v.id = ?`)
          .bind(row.version_id)
          .first();

        return held
          ? `/${held.category}/${held.slug}/${encodeURIComponent(held.version)}/${encodeURIComponent(row.slug)}`
          : null;
      },
      version: (row) => database.prepare("SELECT * FROM versions WHERE id = ?").bind(row.version_id).first(),
      displayName: (row) => row.display_name,
      platforms: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`
              SELECT p.* FROM platforms p JOIN software_platforms fp ON fp.platform_slug = p.slug
              WHERE fp.software_slug = ? ORDER BY p.sort_order, p.name`)
            .bind(row.software_slug)
        ),
      languages: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`
              SELECT l.* FROM languages l JOIN file_languages fl ON fl.language_slug = l.slug
              WHERE fl.file_id = ? ORDER BY l.sort_order, l.name`)
            .bind(row.id)
        ),
      platform: (row) =>
        row.platform ? database.prepare("SELECT * FROM platforms WHERE slug = ?").bind(row.platform).first() : null,
      language: (row) =>
        row.language ? database.prepare("SELECT * FROM languages WHERE slug = ?").bind(row.language).first() : null,
    },

    Publisher: {
      titleCount: async (row) => {
        const held = await database
          .prepare(`
            SELECT COUNT(*) AS held FROM software_publishers sp JOIN software s ON s.slug = sp.software_slug
            WHERE sp.publisher_slug = ?${softwareVisible()}`)
          .bind(row.slug)
          .first();

        return held.held;
      },
      software: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`
              SELECT s.* FROM software s JOIN software_publishers sp ON sp.software_slug = s.slug
              WHERE sp.publisher_slug = ?${softwareVisible()} ORDER BY s.name`)
            .bind(row.slug)
        ),
    },

    Platform: {
      fileCount: async (row) => {
        const held = await database
          .prepare(`SELECT COUNT(*) AS held FROM catalogue_files f WHERE EXISTS (SELECT 1 FROM software_platforms sp WHERE sp.software_slug = f.software_slug AND sp.platform_slug = ?)${filesVisible()}`)
          .bind(row.slug)
          .first();

        return held.held;
      },
      files: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`SELECT f.* FROM catalogue_files f WHERE EXISTS (SELECT 1 FROM software_platforms sp WHERE sp.software_slug = f.software_slug AND sp.platform_slug = ?)${filesVisible()} ORDER BY f.display_name LIMIT 200`)
            .bind(row.slug)
        ),
    },

    Language: {
      fileCount: async (row) => {
        const held = await database
          .prepare(`SELECT COUNT(*) AS held FROM catalogue_files f WHERE EXISTS (SELECT 1 FROM file_languages fl WHERE fl.file_id = f.id AND fl.language_slug = ?)${filesVisible()}`)
          .bind(row.slug)
          .first();

        return held.held;
      },
      files: (row, { limit, offset } = {}) =>
        rowsOf(
          database
            .prepare(`SELECT f.* FROM catalogue_files f WHERE EXISTS (SELECT 1 FROM file_languages fl WHERE fl.file_id = f.id AND fl.language_slug = ?)${filesVisible()} ORDER BY f.display_name LIMIT 200`)
            .bind(row.slug)
        ),
    },

    Request: {
      happenedAt: (row) => datePartsOf(row.happened_at),
      wantedVersion: (row) => row.wanted_version,
      askedBy: (row) => (sees(manager, "requests") ? row.asked_by : null),
    },

    Interface: {
      titleCount: async (row) => {
        const held = await database
          .prepare("SELECT COUNT(*) AS held FROM software_interfaces WHERE interface_slug = ?")
          .bind(row.slug)
          .first();

        return held.held;
      },
    },

    FileType: {
      fileCount: async (row) => {
        const held = await database
          .prepare("SELECT COUNT(*) AS held FROM files WHERE file_type_slug = ?")
          .bind(row.slug)
          .first();

        return held.held;
      },
    },

    Person: {
      createdAt: (row) => datePartsOf(row.created_at),
      lastSeenAt: (row) => datePartsOf(row.last_seen_at),
      displayName: (row) => row.display_name,
      roleName: (row) => row.role_name,
    },

    Role: {
      everything: (row) => row.permissions === "*",
      peopleCount: (row) => row.people_count ?? 0,
    },

    Change: {
      happenedAt: (row) => datePartsOf(row.happened_at),
    },
  };
}
