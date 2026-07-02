import { renderChart } from "./charts/vegaAdapter";
import type { ComponentSpec, Manifest, QueryResults, QueryRow, ReportSpec } from "./types";

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

function renderFiltersPlaceholder(element: HTMLElement, spec: ReportSpec, component: ComponentSpec): void {
  element.className = "motor-card motor-filter-placeholder";
  element.append(text("h2", "Filters"));
  const names = Array.isArray(component.props.params) ? component.props.params : [];
  element.append(
    text(
      "p",
      names.map((name) => `${String(name)}: ${JSON.stringify(spec.params[String(name)]?.default)}`).join(" · "),
    ),
  );
}

export async function renderComponents(
  root: HTMLElement,
  manifest: Manifest,
  spec: ReportSpec,
  results: QueryResults,
  errors: Record<string, string>,
): Promise<void> {
  root.replaceChildren(text("h1", manifest.report.title));
  const components = new Map(spec.components.map((component) => [component.id, component]));
  const renderComponent = async (parent: HTMLElement, component: ComponentSpec): Promise<void> => {
    const element = document.createElement("section");
    element.id = component.id;
    parent.append(element);
    if (component.props.title) element.append(text("h2", String(component.props.title)));
    if (component.type === "DataStatus") renderDataStatus(element, manifest);
    else if (component.type === "VersionBadge") renderVersionBadge(element, manifest);
    else if (component.type === "Filters") renderFiltersPlaceholder(element, spec, component);
    else if (component.query && errors[component.query]) {
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
        await renderChart(chart, component, rows);
      }
    }
  };

  const layout =
    spec.layout ??
    spec.components.map((component) => ({
      type: "component" as const,
      component: component.id,
    }));
  for (const item of layout) {
    if (item.type === "component") {
      const component = components.get(item.component);
      if (component) await renderComponent(root, component);
      continue;
    }
    const row = document.createElement("div");
    row.className = "motor-row";
    row.dataset.count = String(item.components.length);
    row.style.setProperty("--motor-columns", String(item.components.length));
    root.append(row);
    for (const componentId of item.components) {
      const component = components.get(componentId);
      if (component) await renderComponent(row, component);
    }
  }
}
