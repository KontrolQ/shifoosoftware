import { escaped } from "../searching.js";

// What each kind of value can be asked about. `needs` marks the operators that
// take a typed value; the rest stand alone.
const OPERATORS = {
  text: [
    { key: "has", label: "contains", needs: true,
      sql: (field) => `${field} LIKE ? ESCAPE '~'`, bind: (value) => `%${escaped(value)}%` },
    { key: "nothas", label: "does not contain", needs: true,
      sql: (field) => `(${field} IS NULL OR ${field} NOT LIKE ? ESCAPE '~')`,
      bind: (value) => `%${escaped(value)}%` },
    { key: "is", label: "is", needs: true, sql: (field) => `${field} = ?`, bind: (value) => value },
    { key: "isnot", label: "is not", needs: true,
      sql: (field) => `(${field} IS NULL OR ${field} <> ?)`, bind: (value) => value },
    { key: "starts", label: "starts with", needs: true,
      sql: (field) => `${field} LIKE ? ESCAPE '~'`, bind: (value) => `${escaped(value)}%` },
    { key: "ends", label: "ends with", needs: true,
      sql: (field) => `${field} LIKE ? ESCAPE '~'`, bind: (value) => `%${escaped(value)}` },
    { key: "empty", label: "is empty", sql: (field) => `(${field} IS NULL OR trim(${field}) = '')` },
    { key: "any", label: "has any value",
      sql: (field) => `(${field} IS NOT NULL AND trim(${field}) <> '')` },
  ],
  number: [
    { key: "is", label: "equals", needs: true, sql: (field) => `${field} = ?`, bind: Number },
    { key: "isnot", label: "does not equal", needs: true,
      sql: (field) => `(${field} IS NULL OR ${field} <> ?)`, bind: Number },
    { key: "gt", label: "more than", needs: true, sql: (field) => `${field} > ?`, bind: Number },
    { key: "lt", label: "less than", needs: true, sql: (field) => `${field} < ?`, bind: Number },
    { key: "empty", label: "is none", sql: (field) => `(${field} IS NULL OR ${field} = 0)` },
    { key: "any", label: "has any", sql: (field) => `(${field} IS NOT NULL AND ${field} <> 0)` },
  ],
  date: [
    { key: "after", label: "on or after", needs: true,
      sql: (field) => `${field} >= ?`, bind: (value) => value },
    { key: "before", label: "on or before", needs: true,
      sql: (field) => `${field} <= ?`, bind: (value) => value },
    { key: "has", label: "contains", needs: true,
      sql: (field) => `${field} LIKE ? ESCAPE '~'`, bind: (value) => `%${escaped(value)}%` },
    { key: "empty", label: "is empty", sql: (field) => `(${field} IS NULL OR ${field} = '')` },
    { key: "any", label: "has any value",
      sql: (field) => `(${field} IS NOT NULL AND ${field} <> '')` },
  ],
  flag: [
    { key: "yes", label: "yes", sql: (field) => `${field} = 1` },
    { key: "no", label: "no", sql: (field) => `(${field} IS NULL OR ${field} = 0)` },
  ],
};

export function operatorsFor(type) {
  return OPERATORS[type] ?? OPERATORS.text;
}

// A column filter arrives as two fields: which question, and the answer it needs.
export function columnFilter(column, operatorKey, value) {
  const operator = operatorsFor(column.type).find((one) => one.key === operatorKey);

  if (!operator) {
    return null;
  }

  if (operator.needs && String(value ?? "").trim() === "") {
    return null;
  }

  return {
    clause: operator.sql(column.field),
    bindings: operator.needs ? [operator.bind(String(value).trim())] : [],
  };
}
