// A number or a date is narrowed by asking for a span of it rather than by
// picking from a list, so each of those columns offers a from and a to.
const UNITS = {
  size: [["B", 1], ["KB", 1024], ["MB", 1048576], ["GB", 1073741824]],
  hertz: [["Hz", 1], ["MHz", 1000000], ["GHz", 1000000000]],
};

export function unitsFor(unit) {
  return UNITS[unit] ?? [];
}

function measured(value, unit, named) {
  const amount = Number(String(value).trim());

  if (!Number.isFinite(amount)) {
    return null;
  }

  const scale = unitsFor(unit).find((one) => one[0] === named);

  return amount * (scale ? scale[1] : 1);
}

export function rangeFor(column, edge, value, named) {
  if (String(value ?? "").trim() === "") {
    return null;
  }

  if (column.type === "date") {
    // a stored value may be a year or a year and month, so both sides are read
    // as whole days before they are compared
    return {
      clause: `substr(${column.field} || '-01-01', 1, 10) ${edge === "from" ? ">=" : "<="} ?`,
      binding: String(value).trim(),
    };
  }

  const amount = measured(value, column.unit, named);

  return amount === null
    ? null
    : { clause: `${column.field} ${edge === "from" ? ">=" : "<="} ?`, binding: amount };
}

// Every number and date column can be asked for a span; the rest cannot.
export function rangesFor(shape, url, conditions, bindings) {
  const held = [];

  for (const column of shape.columns) {
    if (column.type !== "number" && column.type !== "date") {
      continue;
    }

    const named = url?.searchParams.get(`r.${column.key}.unit`) ?? unitsFor(column.unit)[0]?.[0] ?? "";
    const edges = {};

    for (const edge of ["from", "to"]) {
      const value = url?.searchParams.get(`r.${column.key}.${edge}`) ?? "";
      const made = rangeFor(column, edge, value, named);

      edges[edge] = made ? value : "";

      if (made) {
        conditions.push(made.clause);
        bindings.push(made.binding);
      }
    }

    held.push({
      name: column.key,
      label: column.label,
      isRange: true,
      from: edges.from,
      to: edges.to,
      taken: (edges.from ? 1 : 0) + (edges.to ? 1 : 0),
      units: unitsFor(column.unit).map((one) => ({ value: one[0], chosen: one[0] === named })),
      hasUnits: unitsFor(column.unit).length > 0,
      isDate: column.type === "date",
    });
  }

  return held;
}
