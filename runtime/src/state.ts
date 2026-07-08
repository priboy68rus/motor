import type { ReportRenderer } from "./components";
import type { DuckDBRunner } from "./duckdbRunner";
import type { ParamOptions, ParamValues, QueryResults, ReportSpec } from "./types";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneParamValue(value: unknown): unknown {
  return value == null || typeof value !== "object" ? value : structuredClone(value);
}

function initialQueryNames(spec: ReportSpec): Set<string> {
  const componentIds = new Set<string>();
  const visit = (items: ReportSpec["layout"]): void => {
    for (const item of items ?? []) {
      if (item.type === "component") componentIds.add(item.component);
      else if (item.type === "row") for (const componentId of item.components) componentIds.add(componentId);
      else if (item.tabs[0]) visit(item.tabs[0].layout);
    }
  };
  if (spec.layout) visit(spec.layout);
  else for (const component of spec.components) componentIds.add(component.id);
  return new Set(
    spec.components
      .filter(
        (component) =>
          componentIds.has(component.id) &&
          component.query &&
          spec.queries[component.query]?.kind === "query",
      )
      .map((component) => String(component.query)),
  );
}

function queryClosure(spec: ReportSpec, queryNames: ReadonlySet<string>): Set<string> {
  const closure = new Set<string>();
  const visit = (queryName: string): void => {
    if (closure.has(queryName)) return;
    for (const dependency of spec.queries[queryName]?.depends_on.queries ?? []) visit(dependency);
    closure.add(queryName);
  };
  for (const queryName of queryNames) visit(queryName);
  return closure;
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
    const queryNames = initialQueryNames(this.spec);
    const executionNames = queryClosure(this.spec, queryNames);
    const outcome = await this.runner.run(
      this.spec,
      this.values,
      (queryName) => this.onProgress?.(`Running query ${queryName}…`),
      executionNames,
    );
    this.mergeOutcome(executionNames, outcome.results, outcome.errors);
    await this.renderer.mount(this.results, this.errors, this.values, this.options);
  }

  updateParam(name: string, value: unknown, sourceComponentId?: string): void {
    if (!(name in this.spec.params) || sameValue(this.values[name], value)) return;
    this.values[name] = value;
    this.stateVersion += 1;
    void this.renderer.updateFilters(this.values, this.options, sourceComponentId);
    this.scheduleAffectedQueries(new Set([name]));
  }

  resetParams(names: readonly string[]): void {
    const changed = new Set<string>();
    for (const name of new Set(names.map(String))) {
      const param = this.spec.params[name];
      if (!param || sameValue(this.values[name], param.default)) continue;
      this.values[name] = cloneParamValue(param.default);
      changed.add(name);
    }
    if (changed.size === 0) return;
    this.stateVersion += 1;
    void this.renderer.updateFilters(this.values, this.options);
    this.scheduleAffectedQueries(changed);
  }

  private scheduleAffectedQueries(paramNames: ReadonlySet<string>): void {
    const activeQueryNames = this.renderer.activeQueryNames();
    const affected = new Set(
      Object.entries(this.spec.queries)
        .filter(
          ([queryName, query]) =>
            query.kind === "query" &&
            query.depends_on.params.some((paramName) => paramNames.has(paramName)) &&
            activeQueryNames.has(queryName),
        )
        .map(([queryName]) => queryName),
    );
    if (affected.size === 0) return;
    for (const queryName of affected) this.pendingQueries.add(queryName);
    this.renderer.setLoading(affected);
    void this.drain();
  }

  activateQueries(queryNames: ReadonlySet<string>): void {
    for (const queryName of queryNames) this.pendingQueries.add(queryName);
    if (queryNames.size === 0) return;
    this.renderer.setLoading(queryNames);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pendingQueries.size > 0) {
        const queryNames = new Set(this.pendingQueries);
        this.pendingQueries.clear();
        const executionNames = queryClosure(this.spec, queryNames);
        const version = this.stateVersion;
        const values = structuredClone(this.values);
        try {
          const outcome = await this.runner.run(this.spec, values, undefined, executionNames);
          if (version !== this.stateVersion) {
            const activeQueryNames = this.renderer.activeQueryNames();
            for (const queryName of queryNames) {
              if (activeQueryNames.has(queryName)) this.pendingQueries.add(queryName);
            }
            continue;
          }
          this.mergeOutcome(executionNames, outcome.results, outcome.errors);
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
