import type { ReportRenderer } from "./components";
import type { DuckDBRunner } from "./duckdbRunner";
import type { ParamOptions, ParamValues, QueryResults, ReportSpec } from "./types";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ReportController {
  private values: ParamValues;
  private options: ParamOptions = {};
  private results: QueryResults = {};
  private errors: Record<string, string> = {};
  private stateVersion = 0;
  private pendingQueries = new Set<string>();
  private draining = false;

  constructor(
    private spec: ReportSpec,
    private runner: DuckDBRunner,
    private renderer: ReportRenderer,
    private onProgress?: (message: string) => void,
  ) {
    this.values = Object.fromEntries(
      Object.entries(spec.params).map(([name, param]) => [name, param.default]),
    );
  }

  async initialize(): Promise<void> {
    this.onProgress?.("Loading filter options…");
    this.options = await this.runner.loadParamOptions(this.spec);
    this.onProgress?.("Running report queries…");
    const queryNames = new Set(Object.keys(this.spec.queries));
    const outcome = await this.runner.run(
      this.spec,
      this.values,
      (queryName) => this.onProgress?.(`Running query ${queryName}…`),
      queryNames,
    );
    this.mergeOutcome(queryNames, outcome.results, outcome.errors);
    await this.renderer.mount(this.results, this.errors, this.values, this.options);
  }

  updateParam(name: string, value: unknown): void {
    if (!(name in this.spec.params) || sameValue(this.values[name], value)) return;
    this.values[name] = value;
    this.stateVersion += 1;
    const affected = new Set(
      Object.entries(this.spec.queries)
        .filter(([_queryName, query]) => query.depends_on.params.includes(name))
        .map(([queryName]) => queryName),
    );
    if (affected.size === 0) return;
    for (const queryName of affected) this.pendingQueries.add(queryName);
    this.renderer.setLoading(affected);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pendingQueries.size > 0) {
        const queryNames = new Set(this.pendingQueries);
        this.pendingQueries.clear();
        const version = this.stateVersion;
        const values = structuredClone(this.values);
        try {
          const outcome = await this.runner.run(this.spec, values, undefined, queryNames);
          if (version !== this.stateVersion) {
            for (const queryName of queryNames) this.pendingQueries.add(queryName);
            continue;
          }
          this.mergeOutcome(queryNames, outcome.results, outcome.errors);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const queryName of queryNames) {
            if (this.spec.queries[queryName]?.kind === "query") this.errors[queryName] = message;
          }
        }
        await this.renderer.updateQueries(
          this.results,
          this.errors,
          queryNames,
          this.values,
          this.options,
          (queryName) => !this.pendingQueries.has(queryName),
        );
      }
    } finally {
      this.draining = false;
      if (this.pendingQueries.size > 0) void this.drain();
    }
  }

  private mergeOutcome(
    queryNames: ReadonlySet<string>,
    results: QueryResults,
    errors: Record<string, string>,
  ): void {
    for (const queryName of queryNames) {
      delete this.errors[queryName];
      if (queryName in results) this.results[queryName] = results[queryName] ?? [];
      if (queryName in errors) this.errors[queryName] = errors[queryName] ?? "Query failed";
    }
  }
}
