import { applyMatch } from "../searching.js";
import { can, refuse } from "./permissions.js";
import { COLLECTIONS } from "./collections.js";
import { columnFilter, operatorsFor } from "./filters.js";
import { rangesFor } from "./ranges.js";
import { goTo, htmlPage, rowsOf } from "./shared.js";

export { COLLECTIONS };

const PER_PAGE = 60;

// One statement counts a whole facet, so a very long list keeps its own totals
// rather than building an enormous query.
const COUNT_AT_MOST = 60;

function facetClauseFor(shape, every, name, values) {
  const facet = every.find((one) => one.name === name);

  if (!facet) {
    return null;
  }

  if (facet.kind === "flag") {
    return values[0] === "yes"
      ? { clause: facet.when, bindings: [] }
      : { clause: `NOT (${facet.when})`, bindings: [] };
  }

  const clause = facet.where ?? shape.where?.[name];

  if (!clause) {
    return null;
  }

  // each clause is declared for one pick, so several widen its "= ?" to "IN"
  const widened = values.length > 1
    ? clause.replace("= ?", `IN (${values.map(() => "?").join(", ")})`)
    : clause;

  return { clause: widened, bindings: values };
}

// Columns are chosen per view. Whatever is asked for wins, the ones marked
// always-on come first, and a collection's own defaults stand in for silence.
export function columnsFor(shape, asked) {
  const wanted = (asked ?? "").split(",").map((one) => one.trim()).filter(Boolean);
  const known = new Map(shape.columns.map((one) => [one.key, one]));
  const chosen = wanted.length > 0
    ? wanted.map((one) => known.get(one)).filter(Boolean)
    : shape.columns.filter((one) => one.on);

  const held = shape.columns.filter((one) => one.fixed && !chosen.includes(one));

  return [...held, ...chosen];
}

export function filtersFor(shape, url, conditions, bindings) {
  const held = [];

  for (const column of shape.columns) {
    const operator = url?.searchParams.get(`f.${column.key}`) ?? "";
    const value = url?.searchParams.get(`v.${column.key}`) ?? "";
    const made = operator ? columnFilter(column, operator, value) : null;

    if (made) {
      conditions.push(made.clause);
      bindings.push(...made.bindings);
    }

    held.push({ column, operator: made ? operator : "", value: made ? value : "" });
  }

  return held;
}

function titled(word) {
  const text = String(word ?? "");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Every column can also be narrowed by the values it actually holds, so a list
// offers a facet for each of them alongside the ones it declares by hand.
function facetsOf(shape, source) {
  const declared = new Set((shape.facets ?? []).map((one) => one.name));
  const own = shape.columns
    .filter((one) => one.type === "text" && !declared.has(one.key) && !one.leads && !one.own)
    .map((one) => ({
      name: `by.${one.key}`,
      label: one.label,
      kind: "choice",
      raw: true,
      sql: `SELECT ${one.field} AS value, ${one.field} AS label, COUNT(*) AS held
            FROM ${source} WHERE ${one.field} IS NOT NULL AND trim(${one.field}) <> ''
            GROUP BY ${one.field} ORDER BY held DESC, ${one.field} LIMIT 200`,
      where: `${one.field} = ?`,
    }));

  return [...(shape.facets ?? []), ...own];
}

// What a facet offers is counted over the rows the rest of the narrowing leaves,
// so the number beside an option is what choosing it would give. A facet never
// counts itself, or picking one value would hide all the others.
async function countedWithin(database, facet, options, ground) {
  const clause = facet.where ?? ground.shape.where?.[facet.name];

  if (!clause || options.length === 0 || options.length > COUNT_AT_MOST) {
    return options;
  }

  const others = ground.chosen.filter((one) => one.name !== facet.name);
  const where = [...ground.beside, ...others.map((one) => one.clause)];
  const sums = options.map((one, at) => `SUM(CASE WHEN ${clause} THEN 1 ELSE 0 END) AS held${at}`);
  const bound = [
    ...options.map((one) => one.value),
    ...ground.besideBound,
    ...others.flatMap((one) => one.bindings),
  ];

  const counted = await database
    .prepare(`SELECT ${sums.join(", ")} FROM ${ground.source}` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""))
    .bind(...bound)
    .first()
    .catch(() => null);

  return counted
    ? options.map((one, at) => ({ ...one, held: counted[`held${at}`] ?? 0 }))
    : options;
}

async function facetsFor(database, every, picked, manager, ground) {
  const held = [];

  for (const facet of every) {
    const taken = picked.get(facet.name) ?? [];

    if (facet.kind === "flag") {
      held.push({
        name: facet.name,
        label: facet.label,
        value: taken[0] ?? "",
        isFlag: true,
        options: [
          { value: "yes", label: "Yes", chosen: taken[0] === "yes" },
          { value: "no", label: "No", chosen: taken[0] === "no" },
        ],
      });

      continue;
    }

    const offered = await rowsOf(
      database.prepare(typeof facet.sql === "function" ? facet.sql(manager) : facet.sql)
    );

    if (offered.length === 0) {
      continue;
    }

    const options = await countedWithin(database, facet, offered, ground);

    held.push({
      name: facet.name,
      label: facet.label,
      value: taken.join(","),
      options: options.map((one) => ({
        ...one,
        label: facet.raw ? titled(one.label) : one.label,
        chosen: taken.includes(one.value),
      })),
    });
  }

  return held;
}
// A view is a saved set of filters, kept per person and named by them.
async function savedViewsFor(database, manager, kind, current) {
  if (!manager) {
    return [];
  }

  const held = await rowsOf(
    database
      .prepare("SELECT id, name, query FROM saved_views WHERE manager_id = ? AND kind = ? ORDER BY name")
      .bind(manager.id, kind)
  );

  return held.map((one) => ({ ...one, chosen: one.query === current }));
}

export async function listing(environment, root, manager, kind, url, saved) {
  const shape = COLLECTIONS[kind];

  if (!shape.open && !can(manager, `${shape.permission}.view`)) {
    return refuse(`see ${shape.label.toLowerCase()}`);
  }

  const database = environment.CATALOGUE;
  const query = (url?.searchParams.get("q") ?? "").trim();
  const everyFacet = facetsOf(
    shape,
    `(${typeof shape.from === "function" ? shape.from(manager) : shape.from})`
  );

  // The narrowing is kept in three parts so that a facet can be counted against
  // everything except itself.
  const searched = [];
  const searchBound = [];

  applyMatch(query, shape.search, shape.reach, searched, searchBound);

  const picked = new Map();
  const chosen = [];

  for (const name of new Set([...(url?.searchParams.keys() ?? [])])) {
    const values = url.searchParams
      .getAll(name)
      .flatMap((one) => one.split(","))
      .map((one) => one.trim())
      .filter(Boolean);

    if (values.length === 0) {
      continue;
    }

    const held = facetClauseFor(shape, everyFacet, name, values);

    if (held) {
      picked.set(name, values);
      chosen.push({ name, clause: held.clause, bindings: held.bindings });
    }
  }

  const narrowed = [];
  const narrowedBound = [];
  const shown = columnsFor(shape, url?.searchParams.get("cols"));
  const filters = filtersFor(shape, url, narrowed, narrowedBound);
  const spans = rangesFor(shape, url, narrowed, narrowedBound);
  const conditions = [...searched, ...chosen.map((one) => one.clause), ...narrowed];
  const bindings = [...searchBound, ...chosen.flatMap((one) => one.bindings), ...narrowedBound];
  // Any column can be sorted on, either way; a collection's own default stands
  // in when nothing has been asked for.
  const wanted = url?.searchParams.get("sort") ?? "";
  const sortColumn = shape.columns.find((one) => one.key === wanted) ?? null;
  const falling = url?.searchParams.get("dir") === "down";
  const sort = sortColumn
    ? { key: sortColumn.key, clause: `${sortColumn.field} ${falling ? "DESC" : "ASC"}` }
    : { key: "", clause: shape.order };
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const source = `(${typeof shape.from === "function" ? shape.from(manager) : shape.from}) AS held`;

  const counted = await database
    .prepare(`SELECT COUNT(*) AS held FROM ${source} ${where}`)
    .bind(...bindings)
    .first();

  const total = counted.held;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Number(url?.searchParams.get("page")) || 1), pages);

  const rows = await rowsOf(
    database
      .prepare(`SELECT * FROM ${source} ${where} ORDER BY ${sort.clause} LIMIT ? OFFSET ?`)
      .bind(...bindings, PER_PAGE, (page - 1) * PER_PAGE)
  );

  const carried = new URLSearchParams();

  if (query) {
    carried.set("q", query);
  }

  for (const [name, values] of picked) {
    for (const one of values) {
      carried.append(name, one);
    }
  }

  if (sort.key) {
    carried.set("sort", sort.key);

    if (falling) {
      carried.set("dir", "down");
    }
  }

  for (const held of filters) {
    if (held.operator) {
      carried.set(`f.${held.column.key}`, held.operator);

      if (held.value) {
        carried.set(`v.${held.column.key}`, held.value);
      }
    }
  }

  for (const span of spans) {
    for (const edge of ["from", "to"]) {
      if (span[edge]) {
        carried.set(`r.${span.name}.${edge}`, span[edge]);
      }
    }

    if (span.taken > 0 && span.hasUnits) {
      carried.set(`r.${span.name}.unit`, span.units.find((one) => one.chosen)?.value ?? "");
    }
  }

  const columnKeys = shown.map((one) => one.key).join(",");
  const byDefault = shape.columns.filter((one) => one.on).map((one) => one.key).join(",");

  if (columnKeys !== byDefault) {
    carried.set("cols", columnKeys);
  }

  const listPath = `${root}/${shape.path}`;
  const drawn = rows.map((one) => {
    const href = shape.href(root, one);

    return shown.map((column) => {
      const made = column.cell(one);
      const text = made.link ?? made.text ?? "";

      return {
        shown: text,
        right: column.right,
        tight: column.tight,
        styled: column.width ? `max-width:${column.width}` : "",
        muted: made.muted,
        warn: made.warn,
        // a cell leads where it names; only the one that names the row leads to it
        rowHref: text === ""
          ? null
          : ((column.href && column.href(root, one))
            || (column.leads || column.own
              ? href
              : `${listPath}?f.${column.key}=is&v.${column.key}=${encodeURIComponent(text)}`)),
      };
    });
  });

  const views = await savedViewsFor(database, manager, kind, carried.toString());
  const facets = await facetsFor(database, everyFacet, picked, manager, {
    shape,
    source,
    chosen,
    beside: [...searched, ...narrowed],
    besideBound: [...searchBound, ...narrowedBound],
  });

  // a view stays the one being looked at while its filters are edited, so it can
  // be updated rather than only replaced
  const asked = Number(url?.searchParams.get("view")) || 0;
  const standing = views.find((one) => one.id === asked) ?? views.find((one) => one.chosen) ?? null;
  const here = new URLSearchParams(carried);

  if (standing) {
    here.set("view", String(standing.id));
  }

  return htmlPage(database, "browse-list", {
    root,
    manager,
    saved,
    title: shape.label,
    heading: shape.label,
    subheading: `${total} shown`,
    [shape.flag]: true,
    listPath,
    newHref: shape.makes && can(manager, `${shape.permission}.create`) ? `${listPath}/new` : null,
    kind,
    query,
    facets: [
      ...facets.map((one) => ({
        ...one,
        taken: one.isFlag
          ? (one.value ? 1 : 0)
          : one.options.filter((option) => option.chosen).length,
      })),
      ...spans,
    ].map((one, at) => ({ ...one, first: at === 0 })),
    narrowing: facets.some((one) => one.value !== "") || filters.some((one) => one.operator !== ""),
    sorts: shown.map((one) => ({
      key: one.key,
      label: one.label,
      chosen: one.key === sort.key,
    })),
    falling,
    views: views.map((one) => ({ ...one, href: `${listPath}?${one.query}&view=${one.id}` })),
    onDefault: carried.toString() === "",
    carried: carried.toString(),
    here: here.toString(),
    sifted: carried.toString() !== "",
    standingView: standing?.id,
    standingName: standing?.name,
    changedView: Boolean(standing) && standing.query !== carried.toString(),
    maySave: Boolean(manager) &&
      (standing ? standing.query !== carried.toString() : carried.toString() !== ""),
    columns: shown.map((one) => {
      const beside = new URLSearchParams(carried);

      beside.set("sort", one.key);

      if (one.key === sort.key && !falling) {
        beside.set("dir", "down");
      } else {
        beside.delete("dir");
      }

      return {
        key: one.key,
        label: one.label,
        right: one.right,
        tight: one.tight,
        fixed: one.fixed,
        sorted: one.key === sort.key,
        falling: one.key === sort.key && falling,
        sortHref: `${listPath}?${beside}`,
      };
    }),
    choicesJson: JSON.stringify(shape.columns.map((one) => ({
      key: one.key,
      label: one.label,
      fixed: one.fixed,
    }))),
    chosenColumns: columnKeys,
    filters: filters.filter((held) => shown.includes(held.column)).map((held) => ({
      name: held.column.key,
      label: held.column.label,
      value: held.value,
      styled: held.column.width ? `width:${held.column.width}` : "",
      operators: operatorsFor(held.column.type).map((one) => ({
        value: one.key,
        label: one.label,
        chosen: one.key === held.operator,
      })),
    })),
    rows: drawn.map((cells) => ({ cells })),
    hasRows: rows.length > 0,
    page,
    pages,
    hasPages: pages > 1,
    hasPrevious: page > 1,
    hasNext: page < pages,
    previousPage: page - 1,
    nextPage: page + 1,
  });
}

export async function saveView(environment, root, manager, kind, form) {
  const shape = COLLECTIONS[kind];

  if (!shape || !manager) {
    return goTo(`${root}/categories`);
  }

  const held = String(form.get("query") ?? "").trim();
  const standing = Number(form.get("view")) || 0;

  if (standing) {
    await environment.CATALOGUE
      .prepare("UPDATE saved_views SET query = ? WHERE id = ? AND manager_id = ? AND kind = ?")
      .bind(held, standing, manager.id, kind)
      .run();

    return goTo(`${root}/${shape.path}?${held}&view=${standing}&saved=View updated.`);
  }

  const name = String(form.get("name") ?? "").trim();

  if (!name || !held) {
    return goTo(`${root}/${shape.path}?${held}`);
  }

  const made = await environment.CATALOGUE
    .prepare(`
      INSERT INTO saved_views (manager_id, kind, name, query) VALUES (?, ?, ?, ?)
      ON CONFLICT(manager_id, kind, name) DO UPDATE SET query = excluded.query
      RETURNING id`)
    .bind(manager.id, kind, name, held)
    .first();

  return goTo(`${root}/${shape.path}?${held}&view=${made?.id ?? ""}&saved=View saved.`);
}

export async function dropView(environment, root, manager, kind, form) {
  const shape = COLLECTIONS[kind];

  if (!shape || !manager) {
    return goTo(`${root}/categories`);
  }

  await environment.CATALOGUE
    .prepare("DELETE FROM saved_views WHERE manager_id = ? AND kind = ? AND id = ?")
    .bind(manager.id, kind, Number(form.get("view")) || 0)
    .run();

  return goTo(`${root}/${shape.path}?saved=View removed.`);
}
