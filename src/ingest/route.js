import { upsertFile, upsertSoftware, upsertVersion } from "./writing.js";
import { storeIcon } from "./icons.js";
import { can } from "../admin/permissions.js";

const NEEDED = ["software.create", "versions.create", "files.create", "hotlinks.create"];

function answer(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function ingestRoute(request, environment, manager) {
  if (request.method !== "POST") {
    return answer({ error: "Send the document with POST." }, 405);
  }

  if (!manager) {
    return answer({ error: "A key is required. Send it as Authorization: Bearer." }, 401);
  }

  const missing = NEEDED.filter((permission) => !can(manager, permission));

  if (missing.length > 0) {
    return answer({ error: `This key may not ${missing.join(", ")}.` }, 403);
  }

  let document = null;

  try {
    document = await request.json();
  } catch (problem) {
    return answer({ error: "That body is not JSON." }, 400);
  }

  if (!document?.software) {
    return answer({ error: "A document needs a software object." }, 400);
  }

  const database = environment.CATALOGUE;
  const report = { made: [], changed: [], source: document.source ?? null };

  // Nothing here is wrapped in a transaction, so a document that fails part way
  // leaves what it already wrote. The report says what landed rather than pretending.
  try {
    const softwareSlug = await upsertSoftware(database, manager, document.software, report);

    await storeIcon(environment, database, manager, softwareSlug, document.software.icon, report);

    for (const offered of document.versions ?? []) {
      const version = await upsertVersion(database, manager, softwareSlug, offered, report);

      for (const file of offered.files ?? []) {
        await upsertFile(database, manager, version, file, report);
      }
    }

    return answer({ ...report, software: softwareSlug });
  } catch (problem) {
    return answer({ ...report, error: problem.message }, 400);
  }
}
