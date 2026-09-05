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
  PER_PAGE,
  anyFilterSet,
  searchFiles,
  searchSoftware,
} from "./search.js";
import { describedDate, describedMeasure, describedSize, downloadName, htmlResponse } from "./rendering.js";
import { plain, rendered } from "./markdown.js";
import { apiDescription } from "./api/documented.js";
import { lettersHeld, rowsOf, softwareByLetter } from "./database.js";

const RECENT_LIMIT = 12;

// A browsed list is read, not scanned, so it is shorter than a page of search results.
const BROWSE_PER_PAGE = 24;

// Link previews are built by machines that never sign in, so every page states in its
// own head what it is. The addresses have to be absolute for those machines to follow.
const SITE = "https://software.shi.foo";
const SITE_NAME = "Shifoo's Software Archive";

function absolute(path) {
  return path && path.startsWith("/") ? `${SITE}${path}` : path;
}

// These are written into attributes unescaped, so that a preview reader sees a real
// address rather than entities. Anything that could close the attribute is encoded
// first — a screenshot's address is stored text and cannot be trusted as markup.
function safeUrl(held) {
  if (!held) {
    return null;
  }

  return encodeURI(String(held)).replace(/["'<>]/g, (one) => encodeURIComponent(one));
}

// One or two sentences, plain, under what a preview will show of it.
export function trimmedTo(text, howMany = 200) {
  const held = String(text ?? "").replace(/\s+/g, " ").trim();

  if (held.length <= howMany) {
    return held;
  }

  const cut = held.slice(0, howMany);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));

  return `${cut.slice(0, stop > 60 ? stop : howMany).trim()}…`;
}

function metadata(base, { path, title, description, image, kind }) {
  return {
    canonical: safeUrl(`${SITE}${path}`),
    pageDescription: trimmedTo(description) || SITE_NAME,
    ogTitle: title,
    ogType: kind ?? "website",
    ogImage: safeUrl(absolute(image)),
    siteName: SITE_NAME,
  };
}

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
    bytesHeld: describedSize(stored ? stored.bytes : 0),
    downloads: (served ? served.total : 0).toLocaleString("en"),
    visitors: (seen ? seen.total : 0).toLocaleString("en"),
    updated: updated && updated.updated ? updated.updated.slice(0, 10) : "never",
    updatedAt: updated?.updated ?? "",
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
    { label: "Publisher", value: row.publisher_names ?? row.publisher,
      links: linkedFacts(row.publisher_names ?? row.publisher, null, "publisher") },
    { label: "Platform", value: row.platform_names, links: linkedFacts(row.platform_names, null, "platform") },
    { label: "Architecture", value: row.architecture_names },
    { label: "Interface", value: row.interface_names, links: linkedFacts(row.interface_names, null, "interface") },
    { label: "Hardware", value: row.device_names, links: linkedFacts(row.device_names, null, "device") },
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
    publishers: linkedFacts(row.publisher, null, "publisher"),
  }));
}

export async function home(database) {
  const base = await shell(database);
  const lookup = named(base.stocked);
  const recent = await recentSoftware(database, RECENT_LIMIT);

  return htmlResponse("home", {
    ...base,
    ...metadata(base, {
      path: "/",
      title: "Shifoo's Software Archive",
      description: `An archive of ${base.count} titles and ${base.filesHeld} files of retro `
        + `software — operating systems, drivers and utilities, each with its platform, its `
        + `language, its size and a SHA-256 checksum.`,
    }),
    title: "Shifoo's Software Archive",
    categories: base.stocked.map((row) => ({
      ...row,
      summaryText: plain(row.summary, 320),
      icon: row.icon_from ? `/icon/${row.icon_from}` : null,
    })),
    categoryCount: base.stocked.length,
    categoryLabel: counted(base.stocked.length, "section"),
    hasCategories: base.stocked.length > 0,
    recent: withCategoryNames(recent, lookup),
    hasRecent: recent.length > 0,
  });
}

// A pager for a list that is only ever narrowed one way, by the address it sits at.
function pagesOf(path, total, wanted) {
  const lastPage = Math.max(1, Math.ceil(total / BROWSE_PER_PAGE));
  const page = Math.min(Math.max(1, wanted), lastPage);
  const linkTo = (at) => (at > 1 ? `${path}?page=${at}` : path);

  return {
    page,
    lastPage,
    total,
    from: total === 0 ? 0 : (page - 1) * BROWSE_PER_PAGE + 1,
    to: Math.min(page * BROWSE_PER_PAGE, total),
    hasMore: lastPage > 1,
    hasBack: page > 1,
    hasNext: page < lastPage,
    backHref: linkTo(page - 1),
    nextHref: linkTo(page + 1),
  };
}

export async function category(database, slug, wanted) {
  const held = await categoryBySlug(database, slug);

  if (!held) {
    return null;
  }

  const base = await shell(database);
  const page = Math.max(1, Number.parseInt(wanted, 10) || 1);
  const found = await softwareInCategory(database, slug, page, BROWSE_PER_PAGE);
  const software = found.rows.map((row) => ({
    ...row,
    icon: iconFor(row),
    blurb: plain(row.description, 320),
    size: describedSize(row.bytes_held),
    publishers: linkedFacts(row.publisher, null, "publisher"),
  }));
  const pager = pagesOf(`/${slug}/`, found.total, page);

  return htmlResponse("category", {
    ...base,
    ...metadata(base, {
      path: `/${slug}/`,
      title: held.name,
      description: `${plain(held.summary, 200) || held.name}. `
        + `${counted(found.total, "title")} in this section of the archive.`,
      image: held.icon_from ? `/icon/${held.icon_from}` : null,
    }),
    title: held.name,
    category: held,
    categoryIcon: held.icon_from ? `/icon/${held.icon_from}` : null,
    summaryHtml: rendered(held.summary),
    categoryDescription: `${held.summary
      ? held.summary.charAt(0).toUpperCase() + held.summary.slice(1)
      : held.name}. ${found.total} ${found.total === 1 ? "title" : "titles"} held in this category.`,
    software,
    pager,
    softwareCount: found.total,
    softwareLabel: counted(found.total, "title"),
    hasSoftware: software.length > 0,
  });
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export async function directory(database, letter, page) {
  const base = await shell(database);
  const counts = new Map((await lettersHeld(database)).map((row) => [row.letter, row.held]));
  const asked = letter && (letter === "#" || ALPHABET.includes(letter.toUpperCase()))
    ? (letter === "#" ? "#" : letter.toUpperCase())
    : null;

  const wanted = Math.max(1, Number.parseInt(page, 10) || 1);
  const held = await softwareByLetter(database, asked, wanted, BROWSE_PER_PAGE);
  const lookup = named(base.stocked);

  const linkTo = (one, at) => {
    const carried = new URLSearchParams();

    if (one) carried.set("letter", one);
    if (at > 1) carried.set("page", String(at));

    const query = carried.toString();

    return query ? `/software/?${query}` : "/software/";
  };

  const lastPage = Math.max(1, Math.ceil(held.total / BROWSE_PER_PAGE));
  const at = Math.min(wanted, lastPage);

  return htmlResponse("directory", {
    ...base,
    ...metadata(base, {
      path: linkTo(asked, wanted),
      title: asked === null ? "All Software" : `All Software — ${asked}`,
      description: `Every title in the archive in one list, ${held.total} of them, `
        + `sorted by name and filterable by first letter.`,
    }),
    title: "All Software",
    letters: [{ label: "All", value: null, held: true, chosen: asked === null, href: linkTo(null, 1) }]
      .concat(
        ["#"].concat(ALPHABET).map((one) => ({
          label: one,
          value: one,
          held: (counts.get(one) ?? 0) > 0,
          chosen: asked === one,
          href: linkTo(one, 1),
        }))
      ),
    heading: asked === null ? "All Software" : `Titles starting with ${asked === "#" ? "a number or symbol" : asked}`,
    software: withCategoryNames(held.rows, lookup).map((row) => ({
      ...row,
      icon: iconFor(row),
      blurb: plain(row.description, 320),
    })),
    softwareLabel: counted(held.total, "title"),
    hasSoftware: held.rows.length > 0,
    pager: {
      page: at,
      lastPage,
      total: held.total,
      from: held.total === 0 ? 0 : (at - 1) * BROWSE_PER_PAGE + 1,
      to: Math.min(at * BROWSE_PER_PAGE, held.total),
      hasMore: lastPage > 1,
      hasBack: at > 1,
      hasNext: at < lastPage,
      backHref: linkTo(asked, at - 1),
      nextHref: linkTo(asked, at + 1),
    },
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

  return htmlResponse("software", {
    ...base,
    ...metadata(base, {
      path: `/${categorySlug}/${slug}/`,
      title: held.name,
      description: plain(held.description, 260)
        || `${held.name}${held.publisher ? ` by ${held.publisher}` : ""} — `
          + `${counted(versions.length, "version")} held in the archive.`,
      image: iconFor(held),
      kind: "article",
    }),
    title: held.name,
    software: held,
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
    platforms: linkedFacts(row.platform, null, "platform"),
    devices: linkedFacts(row.device_names, null, "device"),
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
      blurb: plain(row.notes, 320),
      size: describedSize(row.total_bytes),
    }));

  const totalBytes = files.reduce((running, row) => running + (row.size_bytes ?? 0), 0);

  return {
    ...base,
    software: heldSoftware,
    publishers: linkedFacts(heldSoftware.publisher, null, "publisher"),
    platforms: linkedFacts(heldVersion.platform_names, null, "platform"),
    hasPlatforms: Boolean(heldVersion.platform_names),
    icon: iconFor(heldSoftware),
    categoryName: named(base.stocked).get(categorySlug) ?? categorySlug,
    version: heldVersion,
    released: describedDate(heldVersion.released_on),
    architecture: heldVersion.architecture ?? "",
    hasArchitecture: Boolean(heldVersion.architecture),
    hasDevices: files.some((row) => row.devices),
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
    ...metadata(context, {
      path: `/${categorySlug}/${slug}/${versionName}/`,
      title: `${context.software.name} ${context.version.version}`,
      description: plain(context.version.notes, 260) || context.versionLede,
      image: context.screenshots[0]?.src ?? context.icon,
      kind: "article",
    }),
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
    ...metadata(context, {
      path: `/${categorySlug}/${slug}/${versionName}/checksums`,
      title: `${context.software.name} ${context.version.version} checksums`,
      description: `SHA-256 checksums for all ${counted(context.fileCount, "file")} of `
        + `${context.software.name} ${context.version.version}, so a download can be `
        + `checked against what the archive holds.`,
      image: context.icon,
    }),
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
    ...metadata(base, {
      path: "/requests",
      title: "Request something",
      description: "Ask for a piece of software the archive does not hold yet.",
    }),
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

  return htmlResponse("api", {
    ...base,
    ...metadata(base, {
      path: "/api",
      title: "API",
      description: "Everything in the archive is readable through one GraphQL endpoint. "
        + "It takes GET or POST, needs no key, and allows requests from any origin.",
    }),
    title: "API",
    types,
    sample,
  });
}

export async function recent(database) {
  const base = await shell(database);
  const held = await recentSoftware(database, 100);

  return htmlResponse("recent", {
    ...base,
    ...metadata(base, {
      path: "/recent",
      title: "Recently added",
      description: "The newest titles in the archive, most recently added first.",
    }),
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

  const software = searched && wantsSoftware
    ? await searchSoftware(database, filters)
    : { rows: [], total: 0 };
  const files = searched && wantsFiles
    ? await searchFiles(database, filters)
    : { rows: [], total: 0 };

  return {
    searched,
    results: software.rows,
    resultTotal: software.total,
    matchedFiles: files.rows,
    fileTotal: files.total,
  };
}


// Page links keep whatever narrowed the search, so stepping through never widens it.
function pagerFor(filters, total, carried) {
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(filters.page, lastPage);

  const linkTo = (wanted) => {
    const held = new URLSearchParams(carried);

    held.set("page", String(wanted));

    return `?${held.toString()}`;
  };

  return {
    page,
    lastPage,
    total,
    from: total === 0 ? 0 : (page - 1) * PER_PAGE + 1,
    to: Math.min(page * PER_PAGE, total),
    hasMore: lastPage > 1,
    hasBack: page > 1,
    hasNext: page < lastPage,
    backHref: linkTo(page - 1),
    nextHref: linkTo(page + 1),
  };
}

function shownResults(base, held, filters, carried) {
  const lookup = named(base.stocked);
  const { results, matchedFiles } = held;

  return {
    softwarePager: pagerFor(filters, held.resultTotal, carried),
    filePager: pagerFor(filters, held.fileTotal, carried),
    results: withCategoryNames(results, lookup),
    resultCount: held.resultTotal,
    hasResults: results.length > 0,
    matchedFiles: matchedFiles.map((row) => ({
      ...row,
      softwareName: row.software_name,
      href: `/${row.category}/${row.software_slug}/${row.version_slug}/${downloadName(row.slug, row.extension)}`,
      size: describedSize(row.size_bytes),
      platforms: linkedFacts(row.platform, null, "platform"),
      devices: linkedFacts(row.device_names, null, "device"),
    })),
    anyHardware: matchedFiles.some((row) => row.device_names),
    fileCount: held.fileTotal,
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
  const found = await resultsFor(database, filters);
  const carried = carriedFilters(filters);
  const { searched } = found;

  return htmlResponse("search", {
    ...base,
    ...metadata(base, {
      path: "/search",
      title: filters.query ? `Search — ${filters.query}` : "Search",
      description: filters.query
        ? `Titles and files in the archive matching “${filters.query}”.`
        : "Search the archive by keyword, category, platform, hardware, language, "
          + "publisher, file type and system requirements.",
    }),
    unlisted: true,
    title: "Search",
    query: filters.query ?? "",
    showSoftware: filters.show === "software",
    showFiles: filters.show === "files",
    showBoth: filters.show !== "software" && filters.show !== "files",
    sorts: SORTS.map((row) => ({ ...row, chosen: row.value === filters.sort })),
    advancedHref: `/search?mode=advanced${carried.toString() ? `&${carried.toString()}` : ""}`,
    narrowed: [...carried.keys()].some((one) => one !== "q"),
    searched,
    ...shownResults(base, found, filters, carried),
  });
}

export async function advancedSearch(database, filters) {
  const base = await shell(database);
  const found = await resultsFor(database, filters);
  const carried = carriedFilters(filters);
  const { searched } = found;

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
    ...metadata(base, {
      path: "/search?mode=advanced",
      title: "Advanced search",
      description: "Narrow the archive by category, publisher, platform, hardware, "
        + "architecture, language, file type, release date and system requirements.",
    }),
    unlisted: true,
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
    ...shownResults(base, found, filters, carried),
  });
}

export async function missing(database) {
  const base = await shell(database);

  return htmlResponse("missing", {
    ...base,
    ...metadata(base, {
      path: "/",
      title: "Not found",
      description: "There is nothing at that address in the archive.",
    }),
    title: "Not found",
  }, 404);
}
