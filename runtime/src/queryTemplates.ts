import type { ParamSpec, QuerySpec } from "./types";

const TEMPLATE_EXPRESSION = /{{\s*(.*?)\s*}}/g;
const FILTER_HELPER_EXPRESSION = /^(in_filter|between_filter)\(\s*["']([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)["']\s*,\s*([A-Za-z_]\w*)\s*\)$/;
const DIMENSION_HELPER_EXPRESSION = /^dimension\(\s*([A-Za-z_]\w*)\s*\)$/;

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
  const emptyResult = spec.empty_behavior === "none" ? "FALSE" : "TRUE";
  if (value === undefined) return emptyResult;
  const includeNull = spec.options?.include_null !== false;
  if (value === null && !includeNull) return emptyResult;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return emptyResult;
  const identifier = quoteIdentifier(column);
  const hasNull = includeNull && values.some((item) => item === null);
  const concreteValues = values.filter((item) => item !== null && item !== undefined);
  const predicates: string[] = [];
  if (concreteValues.length > 0) {
    predicates.push(`${identifier} IN (${concreteValues.map(quoteValue).join(", ")})`);
  }
  if (hasNull) predicates.push(`${identifier} IS NULL`);
  if (predicates.length === 0) return emptyResult;
  return predicates.length === 1 ? predicates[0]! : `(${predicates.join(" OR ")})`;
}

function betweenFilter(column: string, value: unknown): string {
  if (value === "all") return "TRUE";
  if (!value || typeof value !== "object") {
    throw new Error("date_range value must contain start and end");
  }
  const range = value as { start?: unknown; end?: unknown };
  if (range.start == null || range.end == null) {
    throw new Error("date_range value must contain start and end");
  }
  return `${quoteIdentifier(column)} >= ${quoteValue(range.start)} AND ${quoteIdentifier(column)} < (CAST(${quoteValue(range.end)} AS DATE) + INTERVAL 1 DAY)`;
}

function dimension(value: unknown, spec: ParamSpec): string {
  if (value === "none" && spec.allow_none) return "''";
  if (typeof value !== "string") throw new Error("dimension value must be a choice name");
  const choice = spec.choices?.[value];
  if (!choice) throw new Error(`unknown dimension choice: ${value}`);
  return quoteIdentifier(choice.field);
}

export function renderQueryTemplate(
  query: QuerySpec,
  params: Record<string, ParamSpec>,
  values: Record<string, unknown>,
): string {
  return query.sql_template.replace(TEMPLATE_EXPRESSION, (_expression, body: string) => {
    const filterHelper = FILTER_HELPER_EXPRESSION.exec(body);
    const dimensionHelper = DIMENSION_HELPER_EXPRESSION.exec(body);
    if (!filterHelper && !dimensionHelper) {
      throw new Error(`unsupported template expression: ${body}`);
    }
    if (dimensionHelper) {
      const paramName = dimensionHelper[1];
      if (!paramName || !params[paramName]) {
        throw new Error(`invalid template expression: ${body}`);
      }
      return dimension(values[paramName], params[paramName]);
    }
    const [, name, column, paramName] = filterHelper ?? [];
    if (!name || !column || !paramName || !params[paramName]) {
      throw new Error(`invalid template expression: ${body}`);
    }
    return name === "in_filter"
      ? inFilter(column, values[paramName], params[paramName])
      : betweenFilter(column, values[paramName]);
  });
}
