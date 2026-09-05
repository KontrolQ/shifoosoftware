import { fileBySlug, incrementDownload, noteVisit, softwareBySlug, versionBySlug } from "./database.js";
import { downloadName } from "./rendering.js";
import { adminRoute } from "./admin/routes.js";
import { takeRequest } from "./admin/requests.js";
import { graphRoute } from "./api/graph.js";
import { ingestRoute } from "./ingest/route.js";
import { managerFor } from "./admin/openid.js";
import {
  advancedSearch,
  api,
  category,
  checksums,
  directory,
  home,
  missing,
  recent,
  requests,
  search,
  software,
  version,
} from "./pages.js";
import { filtersFrom, needsTidying, tidiedQuery } from "./search.js";
import { filesFor } from "./storage/bucket.js";

const STATIC_PREFIX = "static";

// The look is chosen by the reader and kept in a cookie. Rather than thread that
// choice through every page, one stylesheet is served at a fixed address and its
// contents depend on the cookie — so the right theme arrives with the first paint
// and nothing flashes.
const THEMES = ["shifoo", "light", "dark"];

function themeIn(request) {
  const held = /(?:^|;)\s*theme=([a-z]+)/.exec(request.headers.get("cookie") ?? "");

  return THEMES.includes(held?.[1]) ? held[1] : THEMES[0];
}

async function themeSheet(request, environment, url) {
  const wanted = new URL(`/static/css/themes/${themeIn(request)}.css`, url.origin);
  const held = await environment.ASSETS.fetch(new Request(wanted, { headers: request.headers }));
  const answered = new Response(held.body, held);

  answered.headers.set("content-type", "text/css; charset=utf-8");
  answered.headers.set("vary", "cookie");
  answered.headers.set("cache-control", "no-cache");

  return answered;
}

// The reader is put back where they were, but only if that is a page of ours: a
// prefix test would accept software.shi.foo.example.com, so the origin is compared.
function backTo(request, url) {
  try {
    const held = new URL(request.headers.get("referer") ?? "", url.origin);

    return held.origin === url.origin ? `${held.pathname}${held.search}` : "/";
  } catch (unreadable) {
    return "/";
  }
}

function themeChosen(request, form, url) {
  const wanted = String(form.get("theme") ?? "");

  return new Response(null, {
    status: 303,
    headers: {
      location: backTo(request, url),
      "set-cookie": `theme=${THEMES.includes(wanted) ? wanted : THEMES[0]}` +
        "; Path=/; Max-Age=31536000; SameSite=Lax",
    },
  });
}

function segments(pathname) {
  return pathname
    .split("/")
    .filter((held) => held !== "")
    .map((held) => decodeURIComponent(held));
}

async function download(environment, categorySlug, slug, versionName, fileName) {
  const heldSoftware = await softwareBySlug(environment.CATALOGUE, categorySlug, slug);

  if (!heldSoftware) {
    return null;
  }

  const heldVersion = await versionBySlug(environment.CATALOGUE, slug, versionName);

  if (!heldVersion) {
    return null;
  }

  const file = await fileBySlug(environment.CATALOGUE, heldVersion.id, fileName);

  if (!file) {
    return null;
  }

  if (file.external_url) {
    await incrementDownload(environment.CATALOGUE, file.id);

    return Response.redirect(file.external_url, 302);
  }

  if (!file.object_key) {
    return null;
  }

  const object = await filesFor(environment).get(file.object_key);

  if (!object) {
    return null;
  }

  await incrementDownload(environment.CATALOGUE, file.id);

  const headers = new Headers();

  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `attachment; filename="${downloadName(file.slug, file.extension)}"`);
  headers.set("cache-control", "public, max-age=86400");

  return new Response(object.body, { headers });
}

async function icon(environment, categorySlug, slug) {
  const held = await softwareBySlug(environment.CATALOGUE, categorySlug, slug);

  if (!held) {
    return null;
  }

  if (held.icon_hotlink_slug) {
    const linked = await environment.CATALOGUE
      .prepare("SELECT target_url FROM hotlinks WHERE slug = ?")
      .bind(held.icon_hotlink_slug)
      .first();

    return linked ? Response.redirect(linked.target_url, 302) : null;
  }

  if (!held.icon_key) {
    return null;
  }

  const object = await filesFor(environment).get(held.icon_key);

  if (!object) {
    return null;
  }

  const headers = new Headers();

  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=86400");

  return new Response(object.body, { headers });
}

async function route(request, environment, url) {
  const parts = segments(url.pathname);

  const root = environment.ADMIN_PATH ? `/${environment.ADMIN_PATH.replace(/^\/+|\/+$/g, "")}` : null;

  if (root && url.pathname.startsWith(root)) {
    return adminRoute(request, environment, root, segments(url.pathname.slice(root.length)), url);
  }

  if (parts[0] === STATIC_PREFIX) {
    return environment.ASSETS.fetch(request);
  }

  if (parts[0] === "theme.css") {
    return themeSheet(request, environment, url);
  }

  if (parts[0] === "theme" && request.method === "POST") {
    return themeChosen(request, await request.formData(), url);
  }

  if (parts[0] === "graphql") {
    return graphRoute(request, environment, url, await managerFor(request, environment.CATALOGUE));
  }

  if (parts[0] === "ingest") {
    return ingestRoute(request, environment, await managerFor(request, environment.CATALOGUE));
  }


  if (parts[0] === "screenshot" && parts[4]) {
    const shot = await environment.CATALOGUE
      .prepare(`
        SELECT vs.object_key, h.target_url
        FROM version_screenshots vs
        JOIN versions v ON v.id = vs.version_id
        JOIN software s ON s.slug = v.software_slug
        LEFT JOIN hotlinks h ON h.slug = vs.hotlink_slug
        WHERE s.category = ? AND v.software_slug = ? AND v.slug = ? AND vs.slug = ?`)
      .bind(parts[1], parts[2], parts[3], parts[4])
      .first();

    if (!shot) {
      return null;
    }

    if (shot.target_url) {
      return Response.redirect(shot.target_url, 302);
    }

    const object = shot.object_key ? await filesFor(environment).get(shot.object_key) : null;

    if (!object) {
      return null;
    }

    const headers = new Headers();

    object.writeHttpMetadata(headers);
    headers.set("cache-control", "public, max-age=86400");

    return new Response(object.body, { headers });
  }

  if (parts[0] === "hotlink" && parts[1]) {
    const held = await environment.CATALOGUE
      .prepare("SELECT target_url FROM hotlinks WHERE slug = ?")
      .bind(parts.slice(1).join("/"))
      .first();

    return held ? Response.redirect(held.target_url, 302) : null;
  }

  if (parts[0] === "icon" && parts[2]) {
    return icon(environment, parts[1], parts[2]);
  }

  if (parts.length === 0) {
    return home(environment.CATALOGUE);
  }

  if (parts[0] === "api") {
    return api(environment.CATALOGUE);
  }

  if (parts[0] === "requests") {
    if (request.method === "POST") {
      const taken = await takeRequest(environment.CATALOGUE, await request.formData());

      return new Response(null, {
        status: 303,
        headers: { location: taken ? "/requests?thanks=1" : "/requests" },
      });
    }

    return requests(environment.CATALOGUE, url.searchParams.get("thanks") === "1");
  }

  if (parts[0] === "search") {
    if (needsTidying(url.searchParams)) {
      const tidied = tidiedQuery(url.searchParams).toString();

      return new Response(null, {
        status: 303,
        headers: { location: tidied ? `/search?${tidied}` : "/search" },
      });
    }

    return url.searchParams.get("mode") === "advanced"
      ? advancedSearch(environment.CATALOGUE, filtersFrom(url.searchParams))
      : search(environment.CATALOGUE, filtersFrom(url.searchParams));
  }

  if (parts[0] === "recent") {
    return recent(environment.CATALOGUE);
  }

  if (parts[0] === "software" && parts.length === 1) {
    return directory(
      environment.CATALOGUE,
      url.searchParams.get("letter"),
      url.searchParams.get("page")
    );
  }

  if (parts.length === 1) {
    return category(environment.CATALOGUE, parts[0], url.searchParams.get("page"));
  }

  if (parts.length === 2) {
    return software(environment.CATALOGUE, parts[0], parts[1]);
  }

  if (parts.length === 3) {
    return version(environment.CATALOGUE, parts[0], parts[1], parts[2]);
  }

  if (parts.length === 4) {
    if (parts[3] === "checksums") {
      return checksums(environment.CATALOGUE, parts[0], parts[1], parts[2]);
    }

    return download(environment, parts[0], parts[1], parts[2], parts[3]);
  }

  return null;
}

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);

    const today = new Date().toISOString().slice(0, 10);
    const seenToday = (request.headers.get("cookie") ?? "").includes(`seen=${today}`);
    const counts = request.method === "GET" && !url.pathname.startsWith("/static") && !seenToday;

    if (counts) {
      await noteVisit(environment.CATALOGUE, today);
    }

    const held = (await route(request, environment, url)) ?? (await missing(environment.CATALOGUE));

    if (!counts) {
      return held;
    }

    const answered = new Response(held.body, held);

    answered.headers.append(
      "set-cookie",
      `seen=${today}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`
    );

    return answered;
  },
};
