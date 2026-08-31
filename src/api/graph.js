import { buildSchema, execute, extendSchema, parse, specifiedRules, validate } from "graphql";

import { ADMIN_EXTRAS, PUBLIC_DEFINITIONS } from "./schema.js";
import { resolversFor } from "./resolvers.js";

let openSchema = null;
let fullSchema = null;

function schemaFor(manager) {
  if (!openSchema) {
    openSchema = buildSchema(PUBLIC_DEFINITIONS);
  }

  if (!manager) {
    return openSchema;
  }

  if (!fullSchema) {
    fullSchema = extendSchema(openSchema, parse(ADMIN_EXTRAS));
  }

  return fullSchema;
}

function answer(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function fieldResolver(source, args, context, info) {
  const bespoke = context.resolvers[info.parentType.name]?.[info.fieldName];

  if (bespoke) {
    return bespoke(source, args, context, info);
  }

  return source?.[info.fieldName];
}

async function askedFor(request, url) {
  if (request.method === "GET") {
    return {
      query: url.searchParams.get("query"),
      variables: url.searchParams.get("variables")
        ? JSON.parse(url.searchParams.get("variables"))
        : undefined,
      operationName: url.searchParams.get("operationName") ?? undefined,
    };
  }

  const kind = request.headers.get("content-type") ?? "";

  if (kind.includes("application/graphql")) {
    return { query: await request.text() };
  }

  return request.json();
}

export async function graphRoute(request, environment, url, manager) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  let asked;

  try {
    asked = await askedFor(request, url);
  } catch (problem) {
    return answer({ errors: [{ message: `That request could not be read: ${problem.message}` }] }, 400);
  }

  if (!asked?.query) {
    return answer({ errors: [{ message: "No query given." }] }, 400);
  }

  let document;

  try {
    document = parse(asked.query);
  } catch (problem) {
    return answer({ errors: [{ message: problem.message }] }, 400);
  }

  const wanted = schemaFor(manager);
  const complaints = validate(wanted, document, specifiedRules);

  if (complaints.length > 0) {
    return answer({ errors: complaints.map((one) => ({ message: one.message })) }, 400);
  }

  const result = await execute({
    schema: wanted,
    document,
    contextValue: { environment, manager, resolvers: resolversFor(environment, manager) },
    variableValues: asked.variables,
    operationName: asked.operationName,
    fieldResolver,
  });

  return answer(result);
}
