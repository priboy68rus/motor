import { renderChart } from "./charts/vegaAdapter";
import type { ChartHandle } from "./charts/vegaAdapter";
import type {
  ComponentSpec,
  Manifest,
  ParamOptions,
  ParamSpec,
  ParamValues,
  QueryResults,
  QueryRow,
  ReportSpec,
} from "./types";

type ParamChangeHandler = (name: string, value: unknown) => void;
const AUTO_DROPDOWN_THRESHOLD = 8;

function text(tag: string, value: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function formatValue(value: unknown, component: ComponentSpec): string {
  if (value == null) return "—";
  if (component.props.format === "currency") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(component.props.currency ?? "USD"),
    }).format(Number(value));
  }
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return String(value);
}

function renderDataStatus(element: HTMLElement, manifest: Manifest): void {
  element.className = "motor-card motor-data-status";
  element.append(text("h2", "Data status"));
  element.append(
    text(
      "p",
      manifest.checks.status === "warning" ? "Checks completed with warnings" : "Checks passed",
      manifest.checks.status === "warning" ? "status-line warning" : "status-line",
    ),
  );
  const values = [
    ["Data through", manifest.freshness.data_through ?? "Not configured"],
    ["Data processed", manifest.freshness.processed_at ?? "Not configured"],
    ["Report built", manifest.build.built_at],
  ];
  const list = document.createElement("dl");
  for (const [label, value] of values) {
    list.append(text("dt", label ?? ""), text("dd", value ?? ""));
  }
  element.append(list);
}

function renderVersionBadge(element: HTMLElement, manifest: Manifest): void {
  element.className = "motor-version";
  element.textContent = `${manifest.build.tool_name} v${manifest.build.tool_version} · ${manifest.artifact.id}`;
}

function renderTable(element: HTMLElement, rows: QueryRow[], component: ComponentSpec): void {
  if (rows.length === 0) {
    element.append(text("p", "No rows", "motor-empty"));
    return;
  }
  const configured = String(component.props.columns ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const columns = configured.length > 0 ? configured : Object.keys(rows[0] ?? {});
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) headerRow.append(text("th", column));
  head.append(headerRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const column of columns) tableRow.append(text("td", formatValue(row[column], component)));
    body.append(tableRow);
  }
  table.append(head, body);
  element.append(table);
}

function renderBigValue(element: HTMLElement, rows: QueryRow[], component: ComponentSpec): void {
  const value = rows[0]?.[String(component.props.value)];
  element.append(text("div", formatValue(value, component), "motor-big-value"));
}

function paramLabel(name: string): string {
  return name.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function valueKey(value: unknown): string {
  return JSON.stringify(value);
}

function filterField(name: string, label?: string): { field: HTMLElement; controls: HTMLElement } {
  const field = document.createElement("fieldset");
  field.className = "motor-filter";
  field.dataset.paramName = name;
  const legend = document.createElement("legend");
  legend.textContent = label ?? paramLabel(name);
  const controls = document.createElement("div");
  controls.className = "motor-filter-controls";
  field.append(legend, controls);
  return { field, controls };
}

function checkbox(labelText: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "motor-filter-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  label.append(input, document.createTextNode(labelText));
  return { label, input };
}

function renderMultiselect(
  name: string,
  param: ParamSpec,
  options: unknown[],
  value: unknown,
  onChange: ParamChangeHandler,
): HTMLElement {
  const { field, controls } = filterField(name, param.label);
  const useDropdown =
    param.control === "dropdown" ||
    (param.control !== "checkboxes" && options.length > AUTO_DROPDOWN_THRESHOLD);
  let optionList = controls;
  let summary: HTMLElement | undefined;
  if (useDropdown) {
    controls.classList.add("motor-multiselect-dropdown-controls");
    const details = document.createElement("details");
    details.className = "motor-multiselect-dropdown";
    summary = document.createElement("summary");
    const panel = document.createElement("div");
    panel.className = "motor-multiselect-panel";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "motor-multiselect-search";
    search.placeholder = "Search…";
    search.setAttribute("aria-label", `Search ${paramLabel(name)}`);
    optionList = document.createElement("div");
    optionList.className = "motor-multiselect-options";
    panel.append(search, optionList);
    details.append(summary, panel);
    controls.append(details);
    search.addEventListener("input", () => {
      const needle = search.value.trim().toLocaleLowerCase();
      for (const label of optionList.querySelectorAll<HTMLLabelElement>(
        ".motor-filter-option[data-filter-value]",
      )) {
        label.hidden = !String(label.dataset.filterValue).toLocaleLowerCase().includes(needle);
      }
    });
  }
  const all = checkbox("All");
  optionList.append(all.label);
  const selected = new Set(Array.isArray(value) ? value.map(valueKey) : []);
  const optionInputs = options.map((option) => {
    const control = checkbox(String(option));
    control.label.dataset.filterValue = String(option);
    control.input.checked = selected.has(valueKey(option));
    optionList.append(control.label);
    return { input: control.input, label: control.label, value: option };
  });
  const allSelected = value === "all" || (selected.size === 0 && param.empty_behavior === "all");
  all.input.checked = allSelected;
  if (allSelected) for (const option of optionInputs) option.input.checked = false;

  const updateSummary = (): void => {
    if (!summary) return;
    if (all.input.checked) {
      summary.textContent = "All";
      return;
    }
    const selectedOptions = optionInputs.filter((item) => item.input.checked);
    summary.textContent =
      selectedOptions.length === 0
        ? "None"
        : selectedOptions.length === 1
          ? String(selectedOptions[0]?.value)
          : `${selectedOptions.length} selected`;
  };
  updateSummary();

  all.input.addEventListener("change", () => {
    if (all.input.checked) {
      for (const option of optionInputs) option.input.checked = false;
      onChange(name, "all");
    } else if (param.empty_behavior === "all") {
      all.input.checked = true;
      onChange(name, "all");
    } else {
      onChange(name, []);
    }
    updateSummary();
  });
  for (const option of optionInputs) {
    option.input.addEventListener("change", () => {
      all.input.checked = false;
      const values = optionInputs.filter((item) => item.input.checked).map((item) => item.value);
      if (values.length === 0 && param.empty_behavior === "all") {
        all.input.checked = true;
        onChange(name, "all");
      } else {
        onChange(name, values);
      }
      updateSummary();
    });
  }
  return field;
}

function renderSelect(
  name: string,
  param: ParamSpec,
  options: unknown[],
  value: unknown,
  onChange: ParamChangeHandler,
): HTMLElement {
  const { field, controls } = filterField(name, param.label);
  const select = document.createElement("select");
  select.className = "motor-select";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All";
  select.append(all);
  options.forEach((option, index) => {
    const element = document.createElement("option");
    element.value = String(index);
    element.textContent = String(option);
    element.selected = value !== "all" && valueKey(option) === valueKey(value);
    select.append(element);
  });
  if (value === "all") select.value = "all";
  select.addEventListener("change", () => {
    onChange(name, select.value === "all" ? "all" : options[Number(select.value)]);
  });
  controls.append(select);
  return field;
}

function renderDateRange(
  name: string,
  param: ParamSpec,
  value: unknown,
  onChange: ParamChangeHandler,
): HTMLElement {
  const { field, controls } = filterField(name, param.label);
  controls.classList.add("motor-date-range");
  const range = value && typeof value === "object" ? (value as { start?: unknown; end?: unknown }) : {};
  const start = document.createElement("input");
  start.type = "date";
  start.value = range.start == null ? "" : String(range.start);
  start.setAttribute("aria-label", `${paramLabel(name)} start`);
  const end = document.createElement("input");
  end.type = "date";
  end.value = range.end == null ? "" : String(range.end);
  end.setAttribute("aria-label", `${paramLabel(name)} end`);
  const emit = (): void => {
    if (start.value && end.value) onChange(name, { start: start.value, end: end.value });
  };
  start.addEventListener("change", emit);
  end.addEventListener("change", emit);
  controls.append(start, text("span", "to", "motor-date-separator"), end);
  return field;
}

function renderDimension(
  name: string,
  param: ParamSpec,
  value: unknown,
  onChange: ParamChangeHandler,
): HTMLElement {
  const { field, controls } = filterField(name, param.label);
  const select = document.createElement("select");
  select.className = "motor-select";
  if (param.allow_none) {
    const option = document.createElement("option");
    option.value = "none";
    option.textContent = "Nothing";
    select.append(option);
  }
  for (const [choiceName, choice] of Object.entries(param.choices ?? {})) {
    const option = document.createElement("option");
    option.value = choiceName;
    option.textContent = choice.label ?? choice.field;
    select.append(option);
  }
  select.value = String(value);
  select.addEventListener("change", () => onChange(name, select.value));
  controls.append(select);
  return field;
}

function renderFilters(
  element: HTMLElement,
  spec: ReportSpec,
  component: ComponentSpec,
  values: ParamValues,
  options: ParamOptions,
  onChange: ParamChangeHandler,
): void {
  element.className = "motor-card motor-filters";
  if (!component.props.title) element.append(text("h2", "Filters"));
  const fields = document.createElement("div");
  fields.className = "motor-filter-list";
  const names = Array.isArray(component.props.params) ? component.props.params : [];
  for (const rawName of names) {
    const name = String(rawName);
    const param = spec.params[name];
    if (!param) continue;
    if (param.type === "multiselect") {
      fields.append(renderMultiselect(name, param, options[name] ?? [], values[name], onChange));
    } else if (param.type === "select") {
      fields.append(renderSelect(name, param, options[name] ?? [], values[name], onChange));
    } else if (param.type === "date_range") {
      fields.append(renderDateRange(name, param, values[name], onChange));
    } else {
      fields.append(renderDimension(name, param, values[name], onChange));
    }
  }
  element.append(fields);
}

export class ReportRenderer {
  private elements = new Map<string, HTMLElement>();
  private chartHandles = new Map<string, ChartHandle>();

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private spec: ReportSpec,
    private onParamChange: ParamChangeHandler,
  ) {}

  async mount(
    results: QueryResults,
    errors: Record<string, string>,
    values: ParamValues,
    options: ParamOptions,
  ): Promise<void> {
    this.root.replaceChildren(text("h1", this.manifest.report.title));
    const components = new Map(this.spec.components.map((component) => [component.id, component]));
    const createComponent = (parent: HTMLElement, component: ComponentSpec): void => {
      const element = document.createElement("section");
      element.id = component.id;
      parent.append(element);
      this.elements.set(component.id, element);
    };
    const layout =
      this.spec.layout ??
      this.spec.components.map((component) => ({
        type: "component" as const,
        component: component.id,
      }));
    for (const item of layout) {
      if (item.type === "component") {
        const component = components.get(item.component);
        if (component) createComponent(this.root, component);
        continue;
      }
      const row = document.createElement("div");
      row.className = "motor-row";
      row.dataset.count = String(item.components.length);
      row.style.setProperty("--motor-columns", String(item.components.length));
      this.root.append(row);
      for (const componentId of item.components) {
        const component = components.get(componentId);
        if (component) createComponent(row, component);
      }
    }
    for (const component of this.spec.components) {
      await this.renderComponent(component, results, errors, values, options);
    }
  }

  setLoading(queryNames: ReadonlySet<string>): void {
    for (const component of this.spec.components) {
      if (!component.query || !queryNames.has(component.query)) continue;
      const element = this.elements.get(component.id);
      element?.classList.add("motor-loading", "motor-stale");
      element?.setAttribute("aria-busy", "true");
    }
  }

  async updateQueries(
    results: QueryResults,
    errors: Record<string, string>,
    queryNames: ReadonlySet<string>,
    values: ParamValues,
    options: ParamOptions,
    shouldRender?: (queryName: string) => boolean,
  ): Promise<void> {
    for (const component of this.spec.components) {
      if (component.query && queryNames.has(component.query)) {
        if (shouldRender && !shouldRender(component.query)) continue;
        await this.renderComponent(component, results, errors, values, options);
        if (shouldRender && !shouldRender(component.query)) {
          this.setLoading(new Set([component.query]));
        }
      }
    }
  }

  private dimensionLegendTitle(
    component: ComponentSpec,
    values: ParamValues,
  ): string | undefined {
    if (!component.query) return undefined;
    const resultField = component.props.group ?? component.props.color;
    if (!resultField) return undefined;
    const paramName = this.spec.queries[component.query]?.dimension_bindings[String(resultField)];
    if (!paramName) return undefined;
    const param = this.spec.params[paramName];
    if (!param || param.type !== "dimension") return undefined;
    const value = values[paramName];
    const choiceLabel =
      value === "none"
        ? "Nothing"
        : typeof value === "string"
          ? (param.choices?.[value]?.label ?? param.choices?.[value]?.field)
          : undefined;
    if (!choiceLabel) return undefined;
    return `${param.label ?? paramLabel(paramName)}: ${choiceLabel}`;
  }

  private async renderComponent(
    component: ComponentSpec,
    results: QueryResults,
    errors: Record<string, string>,
    values: ParamValues,
    options: ParamOptions,
  ): Promise<void> {
    const element = this.elements.get(component.id);
    if (!element) return;
    this.chartHandles.get(component.id)?.finalize();
    this.chartHandles.delete(component.id);
    element.replaceChildren();
    element.removeAttribute("aria-busy");
    if (component.props.title) element.append(text("h2", String(component.props.title)));
    if (component.type === "DataStatus") renderDataStatus(element, this.manifest);
    else if (component.type === "VersionBadge") renderVersionBadge(element, this.manifest);
    else if (component.type === "Filters") {
      renderFilters(element, this.spec, component, values, options, this.onParamChange);
    } else if (component.query && errors[component.query]) {
      element.className = "motor-card motor-component-error";
      element.append(text("strong", "Query failed"), text("pre", errors[component.query] ?? ""));
    } else {
      element.className = "motor-card motor-component";
      const rows = component.query ? results[component.query] ?? [] : [];
      if (component.type === "Table") renderTable(element, rows, component);
      else if (component.type === "BigValue") renderBigValue(element, rows, component);
      else if (component.type === "LineChart" || component.type === "BarChart") {
        const chart = document.createElement("div");
        chart.className = "motor-chart";
        element.append(chart);
        try {
          const legendTitle = this.dimensionLegendTitle(component, values);
          this.chartHandles.set(
            component.id,
            await renderChart(chart, component, rows, legendTitle),
          );
        } catch (error) {
          element.className = "motor-card motor-component-error";
          element.replaceChildren(
            text("strong", "Chart render failed"),
            text("pre", error instanceof Error ? error.message : String(error)),
          );
        }
      }
    }
  }
}
