import {
  buildFilterContext,
  type FilterContextRow,
  type FilterSource,
} from "./filterContext";
import type { ComponentSpec, ParamValues, ReportSpec } from "./types";

function text(tag: string, value: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function sourceIcon(source: FilterSource): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `motor-filter-source is-${source.kind}`;
  element.title = source.label;
  element.setAttribute("aria-label", source.label);
  const paths: Record<FilterSource["kind"], string> = {
    sidebar:
      '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M8 3v14"/>',
    "current-tab": '<path d="M3 7V4h6l2 3h6v10H3zM7 12l2 2 4-4"/>',
    "other-tab": '<path d="M3 7V4h6l2 3h6v10H3zM8 12h5m-2-2 2 2-2 2"/>',
    report: '<path d="M5 2h7l3 3v13H5zM11 2v4h4M8 10h4M8 13h4"/>',
  };
  element.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[source.kind]}</svg>`;
  return element;
}

function renderRow(
  row: FilterContextRow,
  panelId: string,
  onResize: () => void,
): HTMLElement {
  const element = document.createElement("div");
  element.className = "motor-filter-context-row";
  element.dataset.param = row.name;
  const sources = document.createElement("span");
  sources.className = "motor-filter-context-sources";
  const sourceDetails = text(
    "div",
    row.sources.map((source) => source.label).join(" · "),
    "motor-filter-context-source-details",
  );
  sourceDetails.id = `${panelId}-${row.name}-sources`;
  sourceDetails.hidden = true;
  for (const source of row.sources) {
    const icon = sourceIcon(source);
    icon.setAttribute("aria-controls", sourceDetails.id);
    icon.setAttribute("aria-expanded", "false");
    icon.addEventListener("click", () => {
      sourceDetails.hidden = !sourceDetails.hidden;
      for (const button of sources.querySelectorAll("button")) {
        button.setAttribute("aria-expanded", String(!sourceDetails.hidden));
      }
      onResize();
    });
    sources.append(icon);
  }
  const label = text("span", row.label, "motor-filter-context-label");
  label.title = row.label;
  const value = document.createElement("details");
  value.className = "motor-filter-context-value";
  const summary = document.createElement("summary");
  summary.textContent = row.value;
  summary.title = row.value;
  summary.setAttribute("aria-label", `${row.label}: ${row.value}`);
  value.append(
    summary,
    text("div", row.value, "motor-filter-context-full-value"),
  );
  value.dataset.multiple = String(row.multiple);
  const state = text(
    "span",
    row.isDefault ? "Default" : "",
    "motor-filter-context-default",
  );
  if (row.isDefault) state.title = "Value matches the report default";
  element.append(sources, label, value, state, sourceDetails);
  return element;
}

// One portal per report keeps the panel outside scrolling cards and chart containers.
export class ChartFilterTooltip {
  private panel: HTMLElement;
  private active?: { button: HTMLButtonElement; component: ComponentSpec };
  private values: ParamValues = {};
  private restoreFocus = false;
  private listeners?: AbortController;

  constructor(
    private root: HTMLElement,
    private spec: ReportSpec,
  ) {
    this.panel = document.createElement("div");
    this.panel.className = "motor-chart-filter-tooltip";
    this.panel.id = `${root.id || "motor"}-chart-filter-tooltip`;
    // A non-modal dialog permits keyboard/touch disclosure of long values.
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Filters and breakdown");
    this.panel.tabIndex = -1;
    this.panel.hidden = true;
  }

  reset(values: ParamValues): void {
    this.close();
    this.values = values;
    this.listeners?.abort();
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    this.root.ownerDocument.body.append(this.panel);
    this.root.ownerDocument.addEventListener(
      "click",
      (event) => {
        const target = event.target as Node | null;
        if (
          !this.panel.contains(target) &&
          !this.active?.button.contains(target)
        )
          this.close();
      },
      { signal },
    );
    this.root.ownerDocument.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !this.active) return;
        const button = this.active.button;
        const returnFocus = this.panel.contains(
          this.root.ownerDocument.activeElement,
        );
        if (returnFocus) button.focus({ preventScroll: true });
        this.close();
      },
      { signal },
    );
    this.root.ownerDocument.addEventListener(
      "scroll",
      (event) => {
        if (!this.panel.contains(event.target as Node | null)) this.position();
      },
      { capture: true, signal },
    );
    this.root.ownerDocument.defaultView?.addEventListener(
      "resize",
      () => this.refresh(),
      { signal },
    );
  }

  beforeRender(component: ComponentSpec): void {
    if (this.active?.component.id === component.id) {
      this.restoreFocus =
        this.root.ownerDocument.activeElement === this.active.button;
    }
  }

  attach(header: HTMLElement, component: ComponentSpec): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "motor-chart-filter-button";
    button.setAttribute(
      "aria-label",
      `Filters and breakdown for ${component.props.title ?? component.id}`,
    );
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", this.panel.id);
    button.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14l-5.5 6.5V16h-3v-5.5z"/></svg>';
    header.append(button);
    const show = (): void => {
      if (this.active?.button === button) return;
      this.close();
      this.active = { button, component };
      button.setAttribute("aria-expanded", "true");
      this.refresh();
    };
    button.addEventListener("click", () => {
      if (this.active?.button === button) this.close();
      else show();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" || this.active?.button !== button) return;
      event.preventDefault();
      (
        this.panel.querySelector<HTMLElement>(
          ".motor-filter-context-value summary",
        ) ?? this.panel
      ).focus();
    });
    // Keep an open panel anchored across an asynchronous chart rerender.
    if (this.active?.component.id === component.id) {
      this.active.button = button;
      button.setAttribute("aria-expanded", "true");
      if (this.restoreFocus) button.focus({ preventScroll: true });
      this.restoreFocus = false;
      this.refresh();
    }
  }

  update(values: ParamValues): void {
    this.values = values;
    this.refresh();
  }

  refresh(): void {
    if (!this.active) return;
    const { component, button } = this.active;
    const subject = component.type === "BigValue" ? "metric" : "chart";
    if (!button.isConnected || button.closest("[hidden]")) {
      this.close();
      return;
    }
    const groups = buildFilterContext(this.spec, component, this.values);
    const sourceCount = Math.max(
      1,
      ...groups.flatMap((group) => group.rows.map((row) => row.sources.length)),
    );
    this.panel.style.setProperty(
      "--motor-filter-source-width",
      `${Math.min(3, sourceCount) * 18}px`,
    );
    // Preserve disclosures and keyboard focus when values/loading status change.
    const scrollTop = this.panel.scrollTop;
    const open = new Set(
      Array.from(
        this.panel.querySelectorAll(".motor-filter-context-value[open]"),
      ).map((detail) => (detail.parentElement as HTMLElement).dataset.param),
    );
    const openSources = new Set(
      Array.from(
        this.panel.querySelectorAll(
          ".motor-filter-context-source-details:not([hidden])",
        ),
      ).map((detail) => (detail.parentElement as HTMLElement).dataset.param),
    );
    const focusedSource = this.root.ownerDocument.activeElement
      ?.closest(".motor-filter-source")
      ?.getAttribute("aria-label");
    const focusedParam = this.panel.contains(
      this.root.ownerDocument.activeElement,
    )
      ? (
          this.root.ownerDocument.activeElement?.closest(
            "[data-param]",
          ) as HTMLElement
        )?.dataset.param
      : undefined;
    this.panel.replaceChildren();
    if (button.closest("[aria-busy=true]")) {
      this.panel.append(
        text(
          "div",
          "Updating… Values below are the current selection.",
          "motor-filter-context-updating",
        ),
      );
    } else if (button.closest(".motor-component-error")) {
      this.panel.append(
        text(
          "div",
          `${subject === "metric" ? "Metric" : "Chart"} unavailable. Values below are the current selection.`,
          "motor-filter-context-updating",
        ),
      );
    }
    if (groups.length === 0) {
      this.panel.append(
        text(
          "div",
          `Filters and breakdown do not apply to this ${subject}.`,
          "motor-filter-context-empty",
        ),
      );
    }
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "motor-filter-context-group";
      if (group.label === "Not applied")
        section.classList.add("is-not-applied");
      section.append(text("div", group.label, "motor-filter-context-heading"));
      for (const row of group.rows) {
        const element = renderRow(row, this.panel.id, () => this.position());
        const detail = element.querySelector("details")!;
        detail.open = open.has(row.name);
        detail.addEventListener("toggle", () => this.position());
        if (openSources.has(row.name)) {
          element.querySelector<HTMLElement>(
            ".motor-filter-context-source-details",
          )!.hidden = false;
          for (const icon of element.querySelectorAll(".motor-filter-source"))
            icon.setAttribute("aria-expanded", "true");
        }
        section.append(element);
      }
      this.panel.append(section);
    }
    this.panel.hidden = false;
    this.position();
    for (const value of this.panel.querySelectorAll<HTMLElement>(
      ".motor-filter-context-value",
    )) {
      const summary = value.querySelector("summary")!;
      if (
        Number(value.dataset.multiple) > 1 &&
        summary.scrollWidth > summary.clientWidth
      ) {
        summary.textContent = `Multiple · ${value.dataset.multiple}`;
      }
      const row = value.parentElement;
      if (row && row.dataset.param === focusedParam) {
        const source = Array.from(
          row.querySelectorAll<HTMLElement>(".motor-filter-source"),
        ).find((icon) => icon.getAttribute("aria-label") === focusedSource);
        (source ?? summary).focus({ preventScroll: true });
      }
    }
    this.position();
    this.panel.scrollTop = scrollTop;
  }

  private position(): void {
    if (!this.active || this.panel.hidden) return;
    const { button } = this.active;
    if (!button.isConnected || button.closest("[hidden]")) {
      this.close();
      return;
    }
    const view = this.root.ownerDocument.defaultView!;
    const scrollTop = this.panel.scrollTop;
    const anchor = button.getBoundingClientRect();
    this.panel.style.maxHeight = `${view.innerHeight - 16}px`;
    const bounds = this.panel.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(anchor.right - bounds.width, view.innerWidth - bounds.width - 8),
    );
    const below = Math.max(
      0,
      Math.min(view.innerHeight - 16, view.innerHeight - anchor.bottom - 12),
    );
    const above = Math.max(0, Math.min(view.innerHeight - 16, anchor.top - 12));
    const placeAbove = bounds.height > below && above > below;
    this.panel.style.maxHeight = `${Math.max(48, placeAbove ? above : below)}px`;
    const height = this.panel.getBoundingClientRect().height;
    this.panel.style.left = `${left}px`;
    const top = placeAbove ? anchor.top - height - 4 : anchor.bottom + 4;
    this.panel.style.top = `${Math.max(8, Math.min(top, view.innerHeight - height - 8))}px`;
    this.panel.scrollTop = scrollTop;
  }

  close(): void {
    this.active?.button.setAttribute("aria-expanded", "false");
    this.active = undefined;
    this.restoreFocus = false;
    this.panel.hidden = true;
  }
}
