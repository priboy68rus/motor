import * as duckdb from "@duckdb/duckdb-wasm";
import { DataType, DateUnit, type Field } from "apache-arrow";

import { createEmbeddedDuckDBWorker } from "./dataLoader";
import { renderQueryTemplate } from "./queryTemplates";
import type { ParamOptions, ParamValues, QueryResults, QueryRow, ReportSpec } from "./types";

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
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toJSON" in value) {
    return normalizeValue((value as { toJSON: () => unknown }).toJSON());
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

export class DuckDBRunner {
  private database?: duckdb.AsyncDuckDB;
  private connection?: duckdb.AsyncDuckDBConnection;
  private urls: string[] = [];
  private snapshotKey = "";
  private queryCache = new Map<string, QueryRow[]>();

  async initialize(sources: Record<string, string>, snapshotKey: string): Promise<void> {
    this.snapshotKey = snapshotKey;
    const { worker, workerUrl } = await createEmbeddedDuckDBWorker();
    this.urls.push(workerUrl);
    this.database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await this.database.instantiate("motor://duckdb.wasm");
    this.connection = await this.database.connect();
    for (const [name, csv] of Object.entries(sources)) {
      const fileName = `motor-${name}.csv`;
      await this.database.registerFileText(fileName, csv);
      await this.connection.insertCSVFromPath(fileName, {
        schema: "main",
        name,
        detect: true,
        header: true,
      });
    }
  }

  async loadParamOptions(spec: ReportSpec): Promise<ParamOptions> {
    if (!this.connection) throw new Error("DuckDB is not initialized");
    const options: ParamOptions = {};
    for (const [name, param] of Object.entries(spec.params)) {
      if (!param.options) continue;
      const source = quoteIdentifier(param.options.source);
      const column = quoteIdentifier(param.options.column);
      const sql = `SELECT DISTINCT ${column} AS value FROM ${source} WHERE ${column} IS NOT NULL ORDER BY 1`;
      const rows = tableRows(await this.connection.query(sql));
      options[name] = rows.map((row) => row.value);
    }
    return options;
  }

  async run(
    spec: ReportSpec,
    values: ParamValues,
    onProgress?: (queryName: string) => void,
    queryNames?: ReadonlySet<string>,
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
      if (query.depends_on.queries.some((dependency) => failed.has(dependency))) {
        failed.add(name);
        errors[name] = "a query dependency failed";
        continue;
      }
      try {
        const sql = renderQueryTemplate(query, spec.params, values);
        if (query.kind === "view") {
          await this.connection.query(`CREATE OR REPLACE VIEW "${name}" AS ${sql}`);
        } else {
          const paramKey = JSON.stringify(
            query.depends_on.params.map((paramName) => [paramName, values[paramName]]),
          );
          const cacheKey = `${this.snapshotKey}\u0000${name}\u0000${sql}\u0000${paramKey}`;
          const cached = this.queryCache.get(cacheKey);
          results[name] = cached ?? tableRows(await this.connection.query(sql));
          if (!cached) this.queryCache.set(cacheKey, results[name] ?? []);
        }
      } catch (error) {
        failed.add(name);
        errors[name] = error instanceof Error ? error.message : String(error);
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
