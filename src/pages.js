import {
  categoryBySlug,
  distinctExtensions,
  distinctPublishers,
  downloadTotal,
  fileTotal,
  filesOfVersion,
  heldCount,
  languages,
  lastUpdated,
  platforms,
  recentSoftware,
  releaseYears,
  screenshotsOfVersion,
  softwareBySlug,
  softwareInCategory,
  stockedCategories,
  versionBySlug,
  versionsOf,
  visitorTotal,
} from "./database.js";
import { MONTHS } from "./admin/shared.js";
import {
  CHOICE_FACETS,
  RANGE_FACETS,
  SIZE_UNITS,
  SORTS,
  SPEED_UNITS,
  anyFilterSet,
  searchFiles,
  searchSoftware,
} from "./search.js";
import { describedDate, describedMeasure, describedSize, downloadName, htmlResponse } from "./rendering.js";
import { plain, rendered } from "./markdown.js";
import { apiDescription } from "./api/documented.js";
import { rowsOf } from "./database.js";

const RECENT_LIMIT = 3;

async function shell(database) {
  const held = await stockedCategories(database);
  const counted = await heldCount(database);
  const served = await downloadTotal(database);
  const stored = await fileTotal(database);
  const seen = await visitorTotal(database);
  const updated = await lastUpdated(database);

  return {
    railCategories: held,
    railCategoryLabels: labelsFor(held, "slug", "name"),
    count: (counted ? counted.held : 0).toLocaleString("en"),
    filesHeld: (stored ? stored.total : 0).toLocaleString("en"),
    downloads: (served ? served.total : 0).toLocaleString("en"),
    visitors: (seen ? seen.total : 0).toLocaleString("en"),
    updated: updated && updated.updated ? updated.updated.slice(0, 10) : "never",
    year: new Date().getUTCFullYear(),
    stocked: held,
  };
}

function named(rows) {
  return new Map(rows.map((row) => [row.slug, row.name]));
}

function iconFor(row) {
  if (!row.icon_key && !row.icon_hotlink_slug) {
    return null;
  }

  if (row.icon_key && row.icon_key.startsWith("/")) {
    return row.icon_key;
  }

  return `/icon/${row.category}/${row.slug}`;
}

// Anything a fact names can be searched for, so each becomes a link into
// advanced search already narrowed to it.
function linkedFacts(names, slugs, facet) {
  const labels = String(names ?? "").split(",").map((one) => one.trim()).filter(Boolean);
  const keys = String(slugs ?? "").split(",").map((one) => one.trim()).filter(Boolean);

  if (labels.length === 0) {
    return null;
  }

  return labels.map((name, index) => ({
    name,
    href: `/search?mode=advanced&${facet}=${encodeURIComponent(keys[index] ?? slugOfName(name))}`,
    last: index === labels.length - 1,
  }));
}

function slugOfName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// A fact with nothing in it is not shown at all, rather than shown empty.
function statedFacts(row) {
  return [
    { label: "First released", value: describedDate(row.released_on) },
    { label: "Platform", value: row.platform_names, links: linkedFacts(row.platform_names, null, "platform") },
    { label: "Interface", value: row.interface_names, links: linkedFacts(row.interface_names, null, "interface") },
    {
      label: "Minimum CPU",
      value: [row.minimum_cpu_name, describedMeasure(row.minimum_cpu_speed, row.minimum_cpu_speed_unit)]
        .filter(Boolean)
        .join(" @ "),
      links: row.minimum_cpu_name
        ? [{
            name: [row.minimum_cpu_name, describedMeasure(row.minimum_cpu_speed, row.minimum_cpu_speed_unit)]
              .filter(Boolean).join(" @ "),
            href: `/search?mode=advanced&processor=${encodeURIComponent(row.minimum_cpu_slug ?? "")}`,
            last: true,
          }]
        : null,
    },
    { label: "Minimum RAM", value: describedMeasure(row.minimum_ram_size, row.minimum_ram_unit) },
    { label: "Free disk space", value: describedMeasure(row.minimum_disk_size, row.minimum_disk_unit) },
    { label: "End of life", value: describedDate(row.end_of_life) },
  ].filter((one) => one.value !== null && one.value !== undefined && String(one.value).trim() !== "");
}

function counted(howMany, word, many) {
  return `${howMany} ${howMany === 1 ? word : many ?? `${word}s`}`;
}

function withCategoryNames(rows, lookup) {
  return rows.map((row) => ({
    ...row,
    categoryName: lookup.get(row.category) ?? row.category,
    added: (row.created_at ?? "").slice(0, 10),
    blurb: plain(row.description, 320),
    icon: iconFor(row),
    versionsLabel: counted(row.versions ?? 0, "version"),
    filesLabel: counted(row.file_count ?? 0, "file"),
  }));
}

export async function home(database) {
  const base = await shell(database);
  const lookup = named(base.stocked);
  const recent = await recentSoftware(database, RECENT_LIMIT);

  return htmlResponse("home", {
    ...base,
    title: "Shifoo's Software Archive",
    categories: base.stocked.map((row) => ({
      ...row,
      summaryText: plain(row.summary, 320),
      icon: row.icon_from ? `/icon/${row.icon_from}` : null,
      heldLabel: counted(row.held ?? 0, "title"),
    })),
    categoryCount: base.stocked.length,
    categoryLabel: counted(base.stocked.length, "section"),
    hasCategories: base.stocked.length > 0,
    recent: withCategoryNames(recent, lookup),
    hasRecent: recent.length > 0,
  });
}

export async function category(database, slug) {
  const held = await categoryBySlug(database, slug);

  if (!held) {
    return null;
  }

  const base = await shell(database);
  const software = (await softwareInCategory(database, slug)).map((row) => ({
    ...row,
    icon: iconFor(row),
    blurb: plain(row.description, 320),
    size: describedSize(row.bytes_held),
    versionsLabel: counted(row.versions ?? 0, "version"),
    filesLabel: counted(row.file_count ?? 0, "file"),
  }));

  return htmlResponse("category", {
    ...base,
    title: held.name,
    category: held,
    categoryIcon: held.icon_from ? `/icon/${held.icon_from}` : null,
    summaryHtml: rendered(held.summary),
    categoryDescription: `${held.summary
      ? held.summary.charAt(0).toUpperCase() + held.summary.slice(1)
      : held.name}. ${software.length} ${software.length === 1 ? "title" : "titles"} held in this category.`,
    software,
    softwareCount: software.length,
    softwareLabel: counted(software.length, "title"),
    hasSoftware: software.length > 0,
  });
}

export async function software(database, categorySlug, slug) {
  const held = await softwareBySlug(database, categorySlug, slug);

  if (!held) {
    return null;
  }

  const base = await shell(database);
  const versions = (await versionsOf(database, slug)).map((row) => ({
    ...row,
    category: categorySlug,
    softwareSlug: slug,
    released: describedDate(row.released_on),
    size: describedSize(row.total_bytes),
    blurb: plain(row.notes, 320),
  }));

  const facts = statedFacts(held);
  const publisherSlug = slugOfName(String(held.publisher ?? "").split(",")[0]);

  return htmlResponse("software", {
    ...base,
    title: held.name,
    software: { ...held, publisherSlug },
    descriptionHtml: rendered(held.description),
    icon: iconFor(held),
    categoryName: named(base.stocked).get(categorySlug) ?? categorySlug,
    facts,
    hasFacts: facts.length > 0,
    versions,
    versionCount: versions.length,
    hasVersions: versions.length > 0,
  });
}

async function versionContext(database, categorySlug, slug, versionName) {
  const heldSoftware = await softwareBySlug(database, categorySlug, slug);

  if (!heldSoftware) {
    return null;
  }

  const heldVersion = await versionBySlug(database, slug, versionName);

  if (!heldVersion) {
    return null;
  }

  const base = await shell(database);
  const files = (await filesOfVersion(database, heldVersion.id)).map((row) => ({
    ...row,
    href: `/${categorySlug}/${slug}/${versionName}/${downloadName(row.slug, row.extension)}`,
    size: describedSize(row.size_bytes),
    blurb: plain(row.notes, 320),
    savesAs: downloadName(row.slug, row.extension),
  }));

  const screenshots = (await screenshotsOfVersion(database, heldVersion.id)).map((row) => ({
    ...row,
    src: row.target_url ?? `/screenshot/${categorySlug}/${slug}/${versionName}/${row.slug}`,
  }));

  const siblings = (await versionsOf(database, slug))
    .filter((row) => row.slug !== versionName)
    .map((row) => ({
      ...row,
      category: categorySlug,
      softwareSlug: slug,
      released: describedDate(row.released_on),
      size: describedSize(row.total_bytes),
    }));

  const totalBytes = files.reduce((running, row) => running + (row.size_bytes ?? 0), 0);

  return {
    ...base,
    software: {
      ...heldSoftware,
      publisherSlug: slugOfName(String(heldSoftware.publisher ?? "").split(",")[0]),
    },
    icon: iconFor(heldSoftware),
    categoryName: named(base.stocked).get(categorySlug) ?? categorySlug,
    version: heldVersion,
    released: describedDate(heldVersion.released_on),
    architecture: heldVersion.architecture ?? "",
    hasArchitecture: Boolean(heldVersion.architecture),
    screenshots,
    hasScreenshots: screenshots.length > 0,
    notesHtml: rendered(heldVersion.notes),
    versionLede: `Version ${heldVersion.version} of ${heldSoftware.name}${
      heldVersion.released_on ? `, released ${describedDate(heldVersion.released_on)}` : ""
    }.`,
    files,
    fileCount: files.length,
    hasFiles: files.length > 0,
    totalSize: describedSize(totalBytes),
    otherVersions: siblings,
    hasOtherVersions: siblings.length > 0,
  };
}

export async function version(database, categorySlug, slug, versionName) {
  const context = await versionContext(database, categorySlug, slug, versionName);

  if (!context) {
    return null;
  }

  return htmlResponse("version", {
    ...context,
    title: `${context.software.name} ${context.version.version}`,
  });
}

export async function checksums(database, categorySlug, slug, versionName) {
  const context = await versionContext(database, categorySlug, slug, versionName);

  if (!context) {
    return null;
  }

  return htmlResponse("checksums", {
    ...context,
    title: `${context.software.name} ${context.version.version} checksums`,
  });
}

export async function requests(database, thanks) {
  const base = await shell(database);

  const open = await rowsOf(
    database.prepare(`
      SELECT title, publisher, wanted_version, happened_at FROM requests
      WHERE state IN ('open', 'accepted') ORDER BY happened_at DESC LIMIT 40`)
  );

  const counted = await database.prepare("SELECT COUNT(*) AS held FROM requests").first();

  return htmlResponse("requests", {
    ...base,
    title: "Request something",
    thanks,
    count: counted?.held ?? 0,
    open: open.map((row) => ({ ...row, when: (row.happened_at ?? "").slice(0, 10) })),
    hasOpen: open.length > 0,
  });
}

export async function api(database) {
  const base = await shell(database);
  const { types, sample } = apiDescription();

  return htmlResponse("api", { ...base, title: "API", types, sample });
}

export async function recent(database) {
  const base = await shell(database);
  const held = await recentSoftware(database, 100);

  return htmlResponse("recent", {
    ...base,
    title: "Recently added",
    software: withCategoryNames(held, named(base.stocked)),
    hasSoftware: held.length > 0,
  });
}


function labelsFor(rows, key, label) {
  return JSON.stringify(Object.fromEntries(rows.map((row) => [row[key], row[label]])));
}

function marked(rows, chosen, key = "name") {
  return rows.map((row) => ({ ...row, chosen: (row.value ?? row[key]) === chosen }));
}

// What a result looks like is the same whichever form asked for it.
async function resultsFor(database, filters) {
  const searched = anyFilterSet(filters);
  const wantsSoftware = filters.show !== "files";
  const wantsFiles = filters.show === "files" || filters.show === "both";

  const results = searched && wantsSoftware ? await searchSoftware(database, filters) : [];
  const matchedFiles = searched && wantsFiles ? await searchFiles(database, filters) : [];

  return { searched, results, matchedFiles };
}

function shownResults(base, results, matchedFiles) {
  const lookup = named(base.stocked);

  return {
    results: withCategoryNames(results, lookup),
    resultCount: results.length,
    hasResults: results.length > 0,
    matchedFiles: matchedFiles.map((row) => ({
      ...row,
      softwareName: row.software_name,
      href: `/${row.category}/${row.software_slug}/${row.version_slug}/${downloadName(row.slug, row.extension)}`,
      size: describedSize(row.size_bytes),
    })),
    fileCount: matchedFiles.length,
    hasMatchedFiles: matchedFiles.length > 0,
    anyFound: results.length > 0 || matchedFiles.length > 0,
  };
}

function carriedFilters(filters) {
  const carried = new URLSearchParams();

  if (filters.query) {
    carried.set("q", filters.query);
  }

  for (const facet of CHOICE_FACETS) {
    for (const value of filters.chosen[facet.key]) {
      carried.append(facet.key, value);
    }
  }

  return carried;
}

export async function search(database, filters) {
  const base = await shell(database);
  const { searched, results, matchedFiles } = await resultsFor(database, filters);
  const carried = carriedFilters(filters);

  return htmlResponse("search", {
    ...base,
    title: "Search",
    query: filters.query ?? "",
    showSoftware: filters.show === "software",
    showFiles: filters.show === "files",
    showBoth: filters.show !== "software" && filters.show !== "files",
    sorts: SORTS.map((row) => ({ ...row, chosen: row.value === filters.sort })),
    advancedHref: `/search?mode=advanced${carried.toString() ? `&${carried.toString()}` : ""}`,
    narrowed: [...carried.keys()].some((one) => one !== "q"),
    searched,
    ...shownResults(base, results, matchedFiles),
  });
}

export async function advancedSearch(database, filters) {
  const base = await shell(database);
  const { searched, results, matchedFiles } = await resultsFor(database, filters);

  const spread = await releaseYears(database);
  const known = spread.map((row) => Number(row.year)).filter((year) => year > 0);
  const earliest = known.length ? Math.min(...known) : new Date().getUTCFullYear() - 40;
  const latest = Math.max(known.length ? Math.max(...known) : 0, new Date().getUTCFullYear());
  const years = [];

  for (let year = latest; year >= earliest; year -= 1) {
    years.push(String(year));
  }

  const days = Array.from({ length: 31 }, (_, at) => String(at + 1).padStart(2, "0"));

  // a date is picked, never typed, and any part of it may be left alone
  const dateEnd = (name, label, held) => {
    const [year = "", month = "", day = ""] = String(held ?? "").split("-");

    return {
      name,
      label,
      days: days.map((value) => ({ value, chosen: value === day })),
      months: MONTHS.map((one) => ({ ...one, chosen: one.value === month })),
      years: years.map((value) => ({ value, chosen: value === year })),
    };
  };

  const measureEnd = (name, label, value, unit, units) => ({
    name,
    label,
    value: value ?? "",
    units: Object.keys(units).map((one) => ({ value: one, chosen: one === unit })),
  });

  return htmlResponse("advanced", {
    ...base,
    title: "Advanced search",
    query: filters.query ?? "",
    showSoftware: filters.show === "software",
    showFiles: filters.show === "files",
    showBoth: filters.show !== "software" && filters.show !== "files",
    sorts: SORTS.map((row) => ({ ...row, chosen: row.value === filters.sort })),
    choiceFacets: CHOICE_FACETS.map((facet) => ({
      ...facet,
      picked: filters.chosen[facet.key].join(","),
    })),
    dateFacets: [
      {
        key: "released",
        ends: [dateEnd("from", "From", filters.from), dateEnd("to", "To", filters.to)],
      },
      {
        key: "eol",
        ends: [dateEnd("eol_from", "From", filters.eolFrom), dateEnd("eol_to", "To", filters.eolTo)],
      },
    ],
    measureFacets: [
      {
        key: "ram",
        ends: [
          measureEnd("ram_from", "At least", filters.ramFromRaw, filters.ramFromUnit, SIZE_UNITS),
          measureEnd("ram_to", "At most", filters.ramToRaw, filters.ramToUnit, SIZE_UNITS),
        ],
      },
      {
        key: "disk",
        ends: [
          measureEnd("disk_from", "At least", filters.diskFromRaw, filters.diskFromUnit, SIZE_UNITS),
          measureEnd("disk_to", "At most", filters.diskToRaw, filters.diskToUnit, SIZE_UNITS),
        ],
      },
      {
        key: "cpu",
        ends: [
          measureEnd("cpu_from", "At least", filters.cpuFromRaw, filters.cpuFromUnit, SPEED_UNITS),
          measureEnd("cpu_to", "At most", filters.cpuToRaw, filters.cpuToUnit, SPEED_UNITS),
        ],
      },
      {
        key: "filesize",
        ends: [
          measureEnd("filesize_from", "At least", filters.sizeFromRaw, filters.sizeFromUnit, SIZE_UNITS),
          measureEnd("filesize_to", "At most", filters.sizeToRaw, filters.sizeToUnit, SIZE_UNITS),
        ],
      },
    ],
    rangeFacets: RANGE_FACETS,
    searched,
    ...shownResults(base, results, matchedFiles),
  });
}

export async function missing(database) {
  return htmlResponse("missing", { ...(await shell(database)), title: "Not found" }, 404);
}
