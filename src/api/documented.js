import { buildSchema, isObjectType } from "graphql";

import { PUBLIC_DEFINITIONS } from "./schema.js";

const SAMPLE = `query WhatIsHere {
  Page(page: 1, perPage: 5) {
    pageInfo { total currentPage lastPage hasNextPage }
    software {
      name
      releasedOn { year month day }
      category { name }
      publishers { name }
    }
  }
}`;

let described = null;

export function apiDescription() {
  if (described) {
    return { types: described, sample: SAMPLE };
  }

  const schema = buildSchema(PUBLIC_DEFINITIONS);
  const held = [];

  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith("__")) {
      continue;
    }

    held.push({
      name: type.name,
      fields: Object.values(type.getFields()).map((field, position) => ({
        typeName: type.name,
        first: position === 0,
        name: field.name,
        type: String(field.type),
        argText: field.args.map((one) => `${one.name}: ${one.type}`).join(", "),
        description: field.description ?? "",
      })),
    });
  }

  described = held.sort((a, b) => (a.name === "Query" ? -1 : b.name === "Query" ? 1 : a.name.localeCompare(b.name)));

  return { types: described, sample: SAMPLE };
}
