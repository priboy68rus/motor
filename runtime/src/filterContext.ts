import type {
  ComponentSpec,
  LayoutItem,
  ParamSpec,
  ParamValues,
  ReportSpec,
} from "./types";

export type FilterSource = {
  kind: "sidebar" | "current-tab" | "other-tab" | "report";
  label: string;
};

export type FilterContextRow = {
  name: string;
  label: string;
  value: string;
  multiple: number;
  isDefault: boolean;
  sources: FilterSource[];
};

export type FilterContextGroup = {
  label: "Breakdown" | "Filters" | "Not applied";
  rows: FilterContextRow[];
};

export function supportsFilterContext(component: ComponentSpec): boolean {
  return [
    "LineChart",
    "BarChart",
    "AreaChart",
    "ScatterChart",
    "Heatmap",
    "BigValue",
  ].includes(component.type);
}

export function paramValueIsDefault(param: ParamSpec, value: unknown): boolean {
  if (
    param.type === "multiselect" &&
    Array.isArray(value) &&
    Array.isArray(param.default)
  ) {
    const normalize = (items: unknown[]) =>
      JSON.stringify(
        [...new Set(items.map((item) => JSON.stringify(item)))].sort(),
      );
    return normalize(value) === normalize(param.default);
  }
  if (
    param.type === "date_range" &&
    value &&
    param.default &&
    typeof value === "object" &&
    typeof param.default === "object"
  ) {
    const current = value as { start?: unknown; end?: unknown };
    const initial = param.default as { start?: unknown; end?: unknown };
    return current.start === initial.start && current.end === initial.end;
  }
  return JSON.stringify(value) === JSON.stringify(param.default);
}

export function filterValueLabel(param: ParamSpec, value: unknown): string {
  if (param.type === "dimension") {
    if (value === "none") return "None";
    const choice = param.choices?.[String(value)];
    return choice?.label ?? choice?.field ?? String(value ?? "—");
  }
  if (value === "all") return "All";
  if (param.type === "date_range" && value && typeof value === "object") {
    const range = value as { start?: unknown; end?: unknown };
    return `${range.start ?? "—"} – ${range.end ?? "—"}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0)
      return param.empty_behavior === "all" ? "All" : "None";
    return value.map((item) => filterValueLabel(param, item)).join(", ");
  }
  if (value === null) return param.options?.null_label ?? "(Null)";
  return String(value ?? "—");
}

type TabContext = { key: string; title: string };

export function buildFilterContext(
  spec: ReportSpec,
  chart: ComponentSpec,
  values: ParamValues,
): FilterContextGroup[] {
  const tabs = new Map<string, TabContext>();
  const visit = (items: LayoutItem[], context?: TabContext): void => {
    for (const item of items) {
      if (item.type === "tabs") {
        for (const tab of item.tabs) {
          visit(tab.layout, {
            key: `${item.tabset_id}/${tab.id}`,
            title: tab.title,
          });
        }
      } else {
        const ids = item.type === "row" ? item.components : [item.component];
        if (context) for (const id of ids) tabs.set(id, context);
      }
    }
  };
  visit(spec.layout ?? []);
  const chartTab = tabs.get(chart.id);
  const controls = spec.components.filter(
    (component) => component.type === "Filters",
  );
  const dependencies = new Set(
    chart.query ? spec.queries[chart.query]?.depends_on.params : [],
  );
  if (dependencies.size === 0) return [];

  const groups: FilterContextGroup[] = [
    { label: "Breakdown", rows: [] },
    { label: "Filters", rows: [] },
    { label: "Not applied", rows: [] },
  ];
  for (const [name, param] of Object.entries(spec.params)) {
    const sources = new Map<string, FilterSource>();
    for (const control of controls) {
      if (
        !Array.isArray(control.props.params) ||
        !control.props.params.includes(name)
      )
        continue;
      const tab = tabs.get(control.id);
      if (control.props.placement === "sidebar") {
        sources.set("sidebar", { kind: "sidebar", label: "Sidebar" });
      } else if (tab) {
        const current = tab.key === chartTab?.key;
        sources.set(tab.key, {
          kind: current ? "current-tab" : "other-tab",
          label: `${current ? "This tab" : "Other tab"}: ${tab.title}`,
        });
      } else {
        sources.set("report", { kind: "report", label: "Report" });
      }
    }
    if (sources.size === 0) {
      sources.set("report", {
        kind: "report",
        label: "Report parameter (no control)",
      });
    }
    const value = values[name];
    const group = !dependencies.has(name)
      ? groups[2]!
      : param.type === "dimension"
        ? groups[0]!
        : groups[1]!;
    group.rows.push({
      name,
      label:
        param.label ??
        name
          .replaceAll("_", " ")
          .replace(/^./, (letter) => letter.toUpperCase()),
      value: filterValueLabel(param, value),
      multiple: Array.isArray(value) && value.length > 1 ? value.length : 0,
      isDefault: paramValueIsDefault(param, value),
      sources: [...sources.values()],
    });
  }
  return groups.filter((group) => group.rows.length > 0);
}
