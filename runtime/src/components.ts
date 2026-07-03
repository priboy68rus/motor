import { renderChart } from "./charts/vegaAdapter";
import type { ChartHandle } from "./charts/vegaAdapter";
import {
  formatSignedPercent,
  formatSignedValue,
  formatValue,
  type ValueFormat,
  type ValueFormatOptions,
  type ValueNotation,
} from "./valueFormatting";
import type {
  ComponentSpec,
  LayoutItem,
  Manifest,
  ParamOptions,
  ParamSpec,
  ParamValues,
  QueryResults,
  QueryRow,
  ReportSpec,
} from "./types";

type ParamChangeHandler = (name: string, value: unknown, sourceComponentId?: string) => void;
const AUTO_DROPDOWN_THRESHOLD = 8;
let radioGroupSequence = 0;

function text(tag: string, value: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function emptyValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function valueFormatOptions(component: ComponentSpec): ValueFormatOptions {
  return {
    format: component.props.format as ValueFormat | undefined,
    currency:
      component.props.currency == null ? undefined : String(component.props.currency),
    notation: (component.props.notation ??
      (component.type === "BigValue" ? "compact" : undefined)) as ValueNotation | undefined,
  };
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

function renderText(element: HTMLElement, component: ComponentSpec): void {
  element.className = "motor-card motor-text";
  element.append(text("p", String(component.props.text), "motor-text-body"));
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
    for (const column of columns) {
      tableRow.append(text("td", formatValue(row[column], valueFormatOptions(component))));
    }
    body.append(tableRow);
  }
  table.append(head, body);
  element.append(table);
}

function renderBigValue(element: HTMLElement, rows: QueryRow[], component: ComponentSpec): void {
  const row = rows[0];
  const value = row?.[String(component.props.value)];
  const formatOptions = valueFormatOptions(component);
  element.append(
    text("div", emptyValue(value) ? "—" : formatValue(value, formatOptions), "motor-big-value"),
  );

  const compareColumn = component.props.compare_value;
  if (compareColumn == null || emptyValue(value)) return;
  const comparison = row?.[String(compareColumn)];
  if (emptyValue(comparison)) return;

  const currentNumber = Number(value);
  const comparisonNumber = Number(comparison);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(comparisonNumber)) return;

  const absoluteDelta = currentNumber - comparisonNumber;
  const direction = String(component.props.direction ?? "neutral");
  const improves =
    direction === "higher_is_better"
      ? absoluteDelta > 0
      : direction === "lower_is_better"
        ? absoluteDelta < 0
        : false;
  const worsens =
    direction === "higher_is_better"
      ? absoluteDelta < 0
      : direction === "lower_is_better"
        ? absoluteDelta > 0
        : false;
  const comparisonElement = document.createElement("div");
  comparisonElement.className = `motor-big-value-comparison${
    improves ? " good" : worsens ? " bad" : ""
  }`;
  const delta = String(component.props.delta ?? "both");
  if (delta === "absolute" || delta === "both") {
    comparisonElement.append(
      text("span", formatSignedValue(absoluteDelta, formatOptions), "motor-big-value-delta"),
    );
  }
  if (delta === "both") {
    comparisonElement.append(text("span", "·", "motor-big-value-delta-separator"));
  }
  if (delta === "percent" || delta === "both") {
    const percent =
      comparisonNumber === 0
        ? "—"
        : formatSignedPercent(absoluteDelta / Math.abs(comparisonNumber));
    comparisonElement.append(text("span", percent, "motor-big-value-delta"));
  }
  element.append(comparisonElement);
  if (component.props.delta_label) {
    element.append(
      text("p", String(component.props.delta_label), "motor-big-value-delta-label"),
    );
  }
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

function radio(
  labelText: string,
  groupName: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "motor-filter-option";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = groupName;
  label.append(input, document.createTextNode(labelText));
  return { label, input };
}

function filterDropdown(
  name: string,
  controls: HTMLElement,
): { details: HTMLDetailsElement; summary: HTMLElement; optionList: HTMLElement } {
  controls.classList.add("motor-multiselect-dropdown-controls");
  const details = document.createElement("details");
  details.className = "motor-multiselect-dropdown";
  const summary = document.createElement("summary");
  const panel = document.createElement("div");
  panel.className = "motor-multiselect-panel";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "motor-multiselect-search";
  search.placeholder = "Search…";
  search.setAttribute("aria-label", `Search ${paramLabel(name)}`);
  const optionList = document.createElement("div");
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
  details.addEventListener("toggle", () => {
    details.classList.remove("drop-up");
    if (!details.open) return;
    requestAnimationFrame(() => {
      if (!details.open || !details.isConnected) return;
      const summaryRect = summary.getBoundingClientRect();
      const panelHeight = panel.getBoundingClientRect().height;
      const clippingContainer = details.closest<HTMLElement>(".motor-sidebar-container");
      const clippingRect = clippingContainer?.getBoundingClientRect();
      const upperBoundary = Math.max(0, clippingRect?.top ?? 0);
      const lowerBoundary = Math.min(
        window.innerHeight,
        clippingRect?.bottom ?? window.innerHeight,
      );
      const spaceAbove = Math.max(0, summaryRect.top - upperBoundary - 8);
      const spaceBelow = Math.max(0, lowerBoundary - summaryRect.bottom - 8);
      if (panelHeight > spaceBelow && spaceAbove > spaceBelow) {
        details.classList.add("drop-up");
      }
    });
  });
  return { details, summary, optionList };
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
    const dropdown = filterDropdown(name, controls);
    summary = dropdown.summary;
    optionList = dropdown.optionList;
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
  const useDropdown =
    param.control == null ||
    param.control === "dropdown" ||
    (param.control === "auto" && options.length > AUTO_DROPDOWN_THRESHOLD);
  let optionList = controls;
  let details: HTMLDetailsElement | undefined;
  let summary: HTMLElement | undefined;
  if (useDropdown) {
    const dropdown = filterDropdown(name, controls);
    details = dropdown.details;
    summary = dropdown.summary;
    optionList = dropdown.optionList;
  }
  const groupName = `motor-select-${name}-${radioGroupSequence++}`;
  const all = radio("All", groupName);
  all.input.checked = value === "all";
  optionList.append(all.label);
  const optionInputs = options.map((option) => {
    const control = radio(String(option), groupName);
    control.label.dataset.filterValue = String(option);
    control.input.checked = value !== "all" && valueKey(option) === valueKey(value);
    optionList.append(control.label);
    return { input: control.input, value: option };
  });
  const selected = optionInputs.find((option) => option.input.checked);
  if (summary) {
    summary.textContent = all.input.checked ? "All" : selected ? String(selected.value) : "None";
  }
  all.input.addEventListener("change", () => {
    if (!all.input.checked) return;
    if (summary) summary.textContent = "All";
    if (details) details.open = false;
    onChange(name, "all");
  });
  for (const option of optionInputs) {
    option.input.addEventListener("change", () => {
      if (!option.input.checked) return;
      if (summary) summary.textContent = String(option.value);
      if (details) details.open = false;
      onChange(name, option.value);
    });
  }
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
  const { details, summary, optionList } = filterDropdown(name, controls);
  const groupName = `motor-dimension-${name}-${radioGroupSequence++}`;
  let none: ReturnType<typeof radio> | undefined;
  if (param.allow_none) {
    none = radio("Nothing", groupName);
    none.input.checked = value === "none";
    optionList.append(none.label);
  }
  const choices = Object.entries(param.choices ?? {}).map(([choiceName, choice]) => {
    const labelText = choice.label ?? choice.field;
    const control = radio(labelText, groupName);
    control.label.dataset.filterValue = `${labelText} ${choiceName} ${choice.field}`;
    control.input.checked = value === choiceName;
    optionList.append(control.label);
    return { input: control.input, label: labelText, value: choiceName };
  });
  const selected = choices.find((choice) => choice.input.checked);
  summary.textContent = none?.input.checked
    ? "Nothing"
    : selected
      ? selected.label
      : "None";
  if (none) {
    none.input.addEventListener("change", () => {
      if (!none?.input.checked) return;
      summary.textContent = "Nothing";
      details.open = false;
      onChange(name, "none");
    });
  }
  for (const choice of choices) {
    choice.input.addEventListener("change", () => {
      if (!choice.input.checked) return;
      summary.textContent = choice.label;
      details.open = false;
      onChange(name, choice.value);
    });
  }
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
  private componentTabs = new Map<string, { tabsetId: string; tabId: string }>();
  private activeTabs = new Map<string, string>();
  private latestResults: QueryResults = {};
  private latestErrors: Record<string, string> = {};
  private latestValues: ParamValues = {};
  private latestOptions: ParamOptions = {};

  constructor(
    private root: HTMLElement,
    private manifest: Manifest,
    private spec: ReportSpec,
    private onParamChange: ParamChangeHandler,
    private onTabChange?: (queryNames: ReadonlySet<string>) => void,
  ) {}

  async mount(
    results: QueryResults,
    errors: Record<string, string>,
    values: ParamValues,
    options: ParamOptions,
  ): Promise<void> {
    this.latestResults = results;
    this.latestErrors = errors;
    this.latestValues = values;
    this.latestOptions = options;
    this.elements.clear();
    this.componentTabs.clear();
    this.activeTabs.clear();
    this.root.replaceChildren(text("h1", this.manifest.report.title));
    const components = new Map(this.spec.components.map((component) => [component.id, component]));
    const sidebarComponents = this.spec.components.filter(
      (component) => component.props.placement === "sidebar",
    );
    let contentRoot = this.root;
    let sidebarRoot: HTMLElement | undefined;
    if (sidebarComponents.length > 0) {
      const shell = document.createElement("div");
      shell.className = "motor-report-shell";
      const sidebarContainer = document.createElement("details");
      sidebarContainer.className = "motor-sidebar-container";
      sidebarContainer.open = true;
      sidebarContainer.append(text("summary", "Report controls"));
      sidebarRoot = document.createElement("aside");
      sidebarRoot.className = "motor-sidebar";
      sidebarContainer.append(sidebarRoot);
      contentRoot = document.createElement("div");
      contentRoot.className = "motor-report-content";
      shell.append(sidebarContainer, contentRoot);
      this.root.append(shell);
    }
    const createComponent = (
      parent: HTMLElement,
      component: ComponentSpec,
      tabContext?: { tabsetId: string; tabId: string },
    ): void => {
      const element = document.createElement("section");
      element.id = component.id;
      parent.append(element);
      this.elements.set(component.id, element);
      if (tabContext) this.componentTabs.set(component.id, tabContext);
    };
    const layout =
      this.spec.layout ??
      this.spec.components.map((component) => ({
        type: "component" as const,
        component: component.id,
      }));
    const renderLayout = (
      items: LayoutItem[],
      parent: HTMLElement,
      tabContext?: { tabsetId: string; tabId: string },
    ): void => {
      for (const item of items) {
        if (item.type === "component") {
          const component = components.get(item.component);
          if (!component) continue;
          const target = component.props.placement === "sidebar" ? sidebarRoot : parent;
          if (target) createComponent(target, component, tabContext);
          continue;
        }
        if (item.type === "row") {
          const row = document.createElement("div");
          row.className = "motor-row";
          row.dataset.count = String(item.components.length);
          row.style.setProperty("--motor-columns", String(item.components.length));
          parent.append(row);
          for (const componentId of item.components) {
            const component = components.get(componentId);
            if (component) createComponent(row, component, tabContext);
          }
          continue;
        }
        const tabsElement = document.createElement("div");
        tabsElement.className = "motor-tabs";
        const tabList = document.createElement("div");
        tabList.className = "motor-tab-list";
        tabList.setAttribute("role", "tablist");
        const panels = new Map<string, HTMLElement>();
        const buttons = new Map<string, HTMLButtonElement>();
        const initialTab = item.tabs[0];
        if (initialTab) this.activeTabs.set(item.tabset_id, initialTab.id);
        for (const tab of item.tabs) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "motor-tab-button";
          button.id = `${item.tabset_id}-${tab.id}-button`;
          button.textContent = tab.title;
          button.setAttribute("role", "tab");
          button.setAttribute("aria-controls", `${item.tabset_id}-${tab.id}-panel`);
          const selected = tab.id === initialTab?.id;
          button.setAttribute("aria-selected", String(selected));
          button.tabIndex = selected ? 0 : -1;
          tabList.append(button);
          buttons.set(tab.id, button);

          const panel = document.createElement("div");
          panel.className = "motor-tab-panel";
          panel.id = `${item.tabset_id}-${tab.id}-panel`;
          panel.setAttribute("role", "tabpanel");
          panel.setAttribute("aria-labelledby", button.id);
          panel.hidden = !selected;
          panels.set(tab.id, panel);
          renderLayout(tab.layout, panel, { tabsetId: item.tabset_id, tabId: tab.id });
          tabsElement.append(panel);

          button.addEventListener("click", () => {
            void this.activateTab(item.tabset_id, tab.id, buttons, panels);
          });
        }
        tabsElement.prepend(tabList);
        parent.append(tabsElement);
      }
    };
    renderLayout(layout, contentRoot);
    for (const component of this.spec.components) {
      if (this.isComponentVisible(component.id)) {
        await this.renderComponent(component, results, errors, values, options);
      }
    }
  }

  activeQueryNames(): Set<string> {
    return new Set(
      this.spec.components
        .filter(
          (component) =>
            component.query &&
            this.spec.queries[component.query]?.kind === "query" &&
            this.isComponentVisible(component.id),
        )
        .map((component) => String(component.query)),
    );
  }

  private isComponentVisible(componentId: string): boolean {
    const tab = this.componentTabs.get(componentId);
    return !tab || this.activeTabs.get(tab.tabsetId) === tab.tabId;
  }

  private async activateTab(
    tabsetId: string,
    tabId: string,
    buttons: ReadonlyMap<string, HTMLButtonElement>,
    panels: ReadonlyMap<string, HTMLElement>,
  ): Promise<void> {
    if (this.activeTabs.get(tabsetId) === tabId) return;
    this.activeTabs.set(tabsetId, tabId);
    for (const [candidateId, button] of buttons) {
      const selected = candidateId === tabId;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      const panel = panels.get(candidateId);
      if (panel) panel.hidden = !selected;
    }
    const queryNames = new Set<string>();
    for (const component of this.spec.components) {
      const tab = this.componentTabs.get(component.id);
      if (tab?.tabsetId !== tabsetId || tab.tabId !== tabId) continue;
      await this.renderComponent(
        component,
        this.latestResults,
        this.latestErrors,
        this.latestValues,
        this.latestOptions,
      );
      if (component.query && this.spec.queries[component.query]?.kind === "query") {
        queryNames.add(component.query);
      }
    }
    this.onTabChange?.(queryNames);
  }

  setLoading(queryNames: ReadonlySet<string>): void {
    for (const component of this.spec.components) {
      if (
        !component.query ||
        !queryNames.has(component.query) ||
        !this.isComponentVisible(component.id)
      ) {
        continue;
      }
      const element = this.elements.get(component.id);
      element?.classList.add("motor-loading", "motor-stale");
      element?.setAttribute("aria-busy", "true");
    }
  }

  async updateFilters(
    values: ParamValues,
    options: ParamOptions,
    sourceComponentId?: string,
  ): Promise<void> {
    this.latestValues = values;
    this.latestOptions = options;
    for (const component of this.spec.components) {
      if (
        component.type !== "Filters" ||
        component.id === sourceComponentId ||
        !this.isComponentVisible(component.id)
      ) {
        continue;
      }
      await this.renderComponent(component, {}, {}, values, options);
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
    this.latestResults = results;
    this.latestErrors = errors;
    this.latestValues = values;
    this.latestOptions = options;
    for (const component of this.spec.components) {
      if (
        component.query &&
        queryNames.has(component.query) &&
        this.isComponentVisible(component.id)
      ) {
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
    else if (component.type === "Text") renderText(element, component);
    else if (component.type === "Filters") {
      renderFilters(element, this.spec, component, values, options, (name, value) =>
        this.onParamChange(name, value, component.id),
      );
    } else if (component.query && errors[component.query]) {
      element.className = "motor-card motor-component-error";
      element.append(
        text("strong", `Query failed: ${component.query}`),
        text("pre", errors[component.query] ?? ""),
      );
    } else {
      element.className = "motor-card motor-component";
      const rows = component.query ? results[component.query] ?? [] : [];
      if (component.type === "Table") renderTable(element, rows, component);
      else if (component.type === "BigValue") renderBigValue(element, rows, component);
      else if (
        component.type === "LineChart" ||
        component.type === "BarChart" ||
        component.type === "Heatmap"
      ) {
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
