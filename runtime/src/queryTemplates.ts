import type { ParamSpec, QuerySpec } from "./types";

const TEMPLATE_EXPRESSION = /{{\s*(.*?)\s*}}/g;
const HELPER_EXPRESSION = /^(in_filter|between_filter)\(\s*["']([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)["']\s*,\s*([A-Za-z_]\w*)\s*\)$/;

function quoteIdentifier(value: string): string {
  return value
    .split(".")
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(".");
}

function quoteValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function inFilter(column: string, value: unknown, spec: ParamSpec): string {
  if (value === "all") return "TRUE";
  if (value == null) return spec.empty_behavior === "none" ? "FALSE" : "TRUE";
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return spec.empty_behavior === "none" ? "FALSE" : "TRUE";
  return `${quoteIdentifier(column)} IN (${values.map(quoteValue).join(", ")})`;
}

function betweenFilter(column: string, value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error("date_range value must contain start and end");
  }
  const range = value as { start?: unknown; end?: unknown };
  if (range.start == null || range.end == null) {
    throw new Error("date_range value must contain start and end");
  }
  return `${quoteIdentifier(column)} BETWEEN ${quoteValue(range.start)} AND ${quoteValue(range.end)}`;
}

export function renderQueryTemplate(
  query: QuerySpec,
  params: Record<string, ParamSpec>,
  values: Record<string, unknown>,
): string {
  return query.sql_template.replace(TEMPLATE_EXPRESSION, (_expression, body: string) => {
    const helper = HELPER_EXPRESSION.exec(body);
    if (!helper) throw new Error(`unsupported template expression: ${body}`);
    const [, name, column, paramName] = helper;
    if (!name || !column || !paramName || !params[paramName]) {
      throw new Error(`invalid template expression: ${body}`);
    }
    return name === "in_filter"
      ? inFilter(column, values[paramName], params[paramName])
      : betweenFilter(column, values[paramName]);
  });
}
