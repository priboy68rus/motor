import * as duckdb from "@duckdb/duckdb-wasm";
import { DataType, DateUnit, type Field } from "apache-arrow";

import { createEmbeddedDuckDBWorker } from "./dataLoader";
import { renderQueryTemplate } from "./queryTemplates";
import type { RuntimeMetrics } from "./runtimeMetrics";
import type { ParamOptions, ParamValues, QueryResults, QueryRow, ReportSpec } from "./types";

function normalizeJsonScalar(value: unknown): unknown {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value[0] !== '"' ||
    value.at(-1) !== '"'
  ) {
    return value;
  }
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded === "string" && /^-?\d+$/.test(decoded)) {
      const integer = BigInt(decoded);
      if (integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)) {
        return Number(integer);
      }
    }
    return decoded;
  } catch {
    return value;
  }
}

function normalizeValue(value: unknown, field?: Field): unknown {
  if (value != null && field && (DataType.isDate(field.type) || DataType.isTimestamp(field.type))) {
    const date = value instanceof Date ? value : new Date(Number(value));
    if (!Number.isNaN(date.getTime())) {
      const iso = date.toISOString();
      return DataType.isDate(field.type) && field.type.unit === DateUnit.DAY
        ? iso.slice(0, 10)
        : iso;
    }
  }
  if (
    value != null &&
    field &&
    DataType.isDecimal(field.type) &&
    typeof value === "object" &&
    "valueOf" in value
  ) {
    const number = (value as { valueOf: (scale?: number) => unknown }).valueOf(field.type.scale);
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toJSON" in value) {
    const serialized = (value as { toJSON: () => unknown }).toJSON();
    return normalizeValue(normalizeJsonScalar(serialized));
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return value;
}

function tableRows(table: { schema: { fields: Field[] }; toArray(): unknown[] }): QueryRow[] {
  const fields = table.schema.fields;
  return table.toArray().map((row) => {
    const record = row as Record<string, unknown>;
    return Object.fromEntries(
      fields.map((field) => [field.name, normalizeValue(record[field.name], field)]),
    );
  });
}

function queryOrder(spec: ReportSpec): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`cyclic query dependency involving ${name}`);
    visiting.add(name);
    for (const dependency of spec.queries[name]?.depends_on.queries ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of Object.keys(spec.queries)) visit(name);
  return ordered;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatBytes(value: number): string {
  const unit = value >= 1024 * 1024 ? " MB" : " KB";
  const divisor = value >= 1024 * 1024 ? 1024 * 1024 : 1024;
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
  }).format(value / divisor);
  return `${formatted}${unit}`;
}

function formatCount(value: number, noun: string): string {
  return `${new Intl.NumberFormat(undefined).format(value)} ${noun}`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function queryError(name: string, error: unknown, sql: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Query: ${name}\n${message}\n\nRendered SQL:\n${sql}`;
}

export class DuckDBRunner {
  private database?: duckdb.AsyncDuckDB;
  private connection?: duckdb.AsyncDuckDBConnection;
  private urls: string[] = [];
  private snapshotKey = "";
  private queryCache = new Map<string, QueryRow[]>();

  async initialize(
    sources: Record<string, string>,
    snapshotKey: string,
    metrics?: RuntimeMetrics,
  ): Promise<void> {
    this.snapshotKey = snapshotKey;
    const { worker, workerUrl } = await createEmbeddedDuckDBWorker(metrics);
    this.urls.push(workerUrl);
    this.database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    const instantiate = async (): Promise<void> => {
      await this.database?.instantiate("motor://duckdb.wasm");
      this.connection = await this.database?.connect();
    };
    if (metrics) await metrics.measure("Instantiate DuckDB", undefined, instantiate);
    else await instantiate();
    if (!this.connection) throw new Error("DuckDB connection failed to initialize");
    for (const [name, csv] of Object.entries(sources)) {
      const fileName = `motor-${name}.csv`;
      const metric = metrics?.start(`Import source ${name}`, formatBytes(csv.length));
      try {
        await this.database.registerFileText(fileName, csv);
        await this.connection.insertCSVFromPath(fileName, {
          schema: "main",
          name,
          detect: true,
          header: true,
        });
        metric?.end();
      } catch (error) {
        metric?.fail(errorDetail(error));
        throw error;
      }
    }
  }

  async loadParamOptions(spec: ReportSpec, metrics?: RuntimeMetrics): Promise<ParamOptions> {
    if (!this.connection) throw new Error("DuckDB is not initialized");
    const options: ParamOptions = {};
    for (const [name, param] of Object.entries(spec.params)) {
      if (!param.options) continue;
      const source = quoteIdentifier(param.options.source);
      const column = quoteIdentifier(param.options.column);
      const sql = `SELECT DISTINCT ${column} AS value FROM ${source} WHERE ${column} IS NOT NULL ORDER BY 1`;
      const metric = metrics?.start(
        `Load filter options ${name}`,
        `${param.options.source}.${param.options.column}`,
      );
      try {
        const rows = tableRows(await this.connection.query(sql));
        options[name] = rows.map((row) => row.value);
        metric?.end(formatCount(options[name]?.length ?? 0, "values"));
      } catch (error) {
        metric?.fail(errorDetail(error));
        throw error;
      }
    }
    return options;
  }

  async run(
    spec: ReportSpec,
    values: ParamValues,
    onProgress?: (queryName: string) => void,
    queryNames?: ReadonlySet<string>,
    metrics?: RuntimeMetrics,
  ): Promise<{
    results: QueryResults;
    errors: Record<string, string>;
  }> {
    if (!this.connection) throw new Error("DuckDB is not initialized");
    const results: QueryResults = {};
    const errors: Record<string, string> = {};
    const failed = new Set<string>();
    for (const name of queryOrder(spec)) {
      if (queryNames && !queryNames.has(name)) continue;
      onProgress?.(name);
      const query = spec.queries[name];
      if (!query) continue;
      const failedDependencies = query.depends_on.queries.filter((dependency) =>
        failed.has(dependency),
      );
      if (failedDependencies.length > 0) {
        failed.add(name);
        errors[name] = `Query: ${name}\nSkipped because dependencies failed: ${failedDependencies.join(", ")}`;
        continue;
      }
      let sql = query.sql_template;
      const metric = metrics?.start(
        query.kind === "view" ? `Create view ${name}` : `Run query ${name}`,
      );
      try {
        sql = renderQueryTemplate(query, spec.params, values);
        if (query.kind === "view") {
          await this.connection.query(`CREATE OR REPLACE VIEW "${name}" AS ${sql}`);
          metric?.end();
        } else {
          const paramKey = JSON.stringify(
            query.depends_on.params.map((paramName) => [paramName, values[paramName]]),
          );
          const cacheKey = `${this.snapshotKey}\u0000${name}\u0000${sql}\u0000${paramKey}`;
          const cached = this.queryCache.get(cacheKey);
          results[name] = cached ?? tableRows(await this.connection.query(sql));
          if (!cached) this.queryCache.set(cacheKey, results[name] ?? []);
          metric?.end(cached ? "cache hit" : formatCount(results[name]?.length ?? 0, "rows"));
        }
      } catch (error) {
        metric?.fail(errorDetail(error));
        failed.add(name);
        errors[name] = queryError(name, error, sql);
      }
    }
    return { results, errors };
  }

  async close(): Promise<void> {
    await this.connection?.close();
    await this.database?.terminate();
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
}
