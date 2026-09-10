import type { Config, TopLevelSpec } from "vega-lite";
import type { ColorScheme, EventListenerHandler, View } from "vega";

import type { ComponentSpec, QueryRow } from "../types";
import { formatValue, type ValueFormat, type ValueFormatOptions } from "../valueFormatting";
import {
  normalizeSignedRows,
  validateStandardNormalize,
  type SignedNormalization,
} from "./stackNormalization";
import {
  buildHeatmapRowMetric,
  heatmapRowMetricKey,
  ROW_METRIC_DISPLAY_FIELD,
  ROW_METRIC_TOOLTIP_FIELD,
} from "./heatmapRowMetric";

const STANDARD_CHART_HEIGHT = 360;

const HEATMAP_LABEL_FIELD = "__motor_heatmap_label";

export const MOTOR_VEGA_CONFIG = {
  background: "transparent",
  font: "IBM Plex Sans",
  axis: {
    labelColor: "#8c857a",
    titleColor: "#524a41",
    gridColor: "#ece6dc",
    domainColor: "#ece6dc",
    tickColor: "#ece6dc",
    labelFontSize: 11,
    titleFontSize: 11,
    titleFontWeight: 600,
    titlePadding: 8,
  },
  legend: {
    labelColor: "#524a41",
    titleColor: "#8c857a",
    labelFontSize: 11,
    titleFontSize: 11,
    symbolType: "circle",
    symbolSize: 60,
  },
  view: { stroke: null },
  range: { category: ["#3b5b8c", "#c9873b", "#5f8f7a", "#a5606f"] },
} satisfies Config;

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<{ view: View }>;

export type ChartHandle = { finalize: () => void };

type XType = "temporal" | "nominal" | "quantitative";

type SharedTooltipEntry = {
  seriesKey: string;
  seriesValues: { field: string; label: string; value: unknown }[];
  colorValue: unknown;
  value: unknown;
  normalizedValue?: unknown;
  details: { label: string; value: unknown }[];
};

type SharedTooltipBucket = {
  x: unknown;
  entries: SharedTooltipEntry[];
};

type SharedTooltipConfig = {
  mode?: "shared-x" | "point";
  x: string;
  y: string;
  seriesFields?: TooltipDetailConfig[];
  colorField?: string;
  xType: XType;
  rows: QueryRow[];
  valueFormat: ValueFormatOptions;
  details: TooltipDetailConfig[];
  normalizedField?: string;
  normalizedLabel?: string;
  rowMetric?: TooltipDetailConfig & { seriesField: string };
};

type TooltipDetailConfig = {
  field: string;
  label?: string;
};

type NormalizedTooltipConfig = {
  field: string;
  label: string;
};

function parseDetails(value: unknown): string[] {
  if (value == null) return [];
  return String(value)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function detailLabel(field: string): string {
  return field.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function tooltipKey(value: unknown, xType: XType): string {
  if (xType === "temporal" && value != null) {
    const timestamp =
      value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
    if (!Number.isNaN(timestamp)) return `date:${timestamp}`;
  }
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${value}`;
  return `json:${JSON.stringify(value)}`;
}

export function sharedTooltipBuckets(
  config: SharedTooltipConfig,
): Map<string, SharedTooltipBucket> {
  const buckets = new Map<string, SharedTooltipBucket>();
  for (const row of config.rows) {
    const xValue = row[config.x];
    const key = tooltipKey(xValue, config.xType);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { x: xValue, entries: [] };
      buckets.set(key, bucket);
    }
    const seriesValues = (config.seriesFields ?? []).map((series) => ({
      field: series.field,
      label: series.label ?? series.field,
      value: row[series.field],
    }));
    bucket.entries.push({
      seriesKey: tooltipSeriesKey(row, config),
      seriesValues,
      colorValue: config.colorField
        ? row[config.colorField]
        : row[config.y],
      value: row[config.y],
      ...(config.normalizedField
        ? { normalizedValue: row[config.normalizedField] }
        : {}),
      details: config.details.map((detail) => ({
        label: detail.label ?? detailLabel(detail.field),
        value: row[detail.field],
      })),
    });
  }
  return buckets;
}

function tooltipSeriesKey(row: QueryRow, config: SharedTooltipConfig): string {
  const fields = config.seriesFields ?? [];
  if (fields.length === 0) return tooltipKey(row[config.y], "nominal");
  return fields
    .map((series) => `${series.field}:${tooltipKey(row[series.field], "nominal")}`)
    .join("\u0000");
}

function uniqueFields(fields: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const field of fields) {
    if (!field || seen.has(field)) continue;
    seen.add(field);
    result.push(field);
  }
  return result;
}

export function lineBarTooltipConfig(
  component: ComponentSpec,
  rows: QueryRow[],
  xType: XType,
  normalized?: NormalizedTooltipConfig,
  legendTitles: Record<string, string> = {},
): SharedTooltipConfig {
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = component.props.color ? String(component.props.color) : undefined;
  const lineStyle =
    component.type === "LineChart" && component.props.line_style
      ? String(component.props.line_style)
      : undefined;
  const seriesFields = uniqueFields([group, color, lineStyle]).map((field) => ({
    field,
    label: legendTitles[field] ?? field,
  }));
  return {
    x: String(component.props.x),
    y: String(component.props.y),
    ...(seriesFields.length > 0 ? { seriesFields } : {}),
    ...(color ? { colorField: color } : {}),
    xType,
    rows,
    details: parseDetails(component.props.details).map((field) => ({ field })),
    ...(normalized
      ? { normalizedField: normalized.field, normalizedLabel: normalized.label }
      : {}),
    valueFormat: {
      format: component.props.format as ValueFormat | undefined,
      currency:
        component.props.currency == null ? undefined : String(component.props.currency),
    },
  };
}

export function tooltipColorScale(
  view: Pick<View, "scale">,
  series?: string,
): ((value: unknown) => unknown) | undefined {
  return series
    ? (view.scale("color") as ((value: unknown) => unknown) | undefined)
    : undefined;
}

function tooltipText(value: unknown): string {
  return value == null || String(value).trim() === "" ? "—" : String(value);
}

function text(tag: "td" | "th", value: string, className?: string): HTMLTableCellElement {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function heatmapTextColor(valueField: string): { expr: string } {
  const cell = `scale('color', datum[${JSON.stringify(valueField)}])`;
  const cellHsl = `hsl(${cell})`;
  const dark = `hsl(${cellHsl}.h, ${cellHsl}.s * 0.85, 0.10)`;
  const light = `hsl(${cellHsl}.h, ${cellHsl}.s * 0.30, 0.93)`;
  const tinted = `contrast(${cell}, ${dark}) >= contrast(${cell}, ${light}) ? ${dark} : ${light}`;
  const fallback = `contrast(${cell}, '#000') >= contrast(${cell}, '#fff') ? '#000' : '#fff'`;
  return {
    expr: `contrast(${cell}, ${tinted}) >= 4.7 ? ${tinted} : ${fallback}`,
  };
}

function mountSharedTooltip(
  view: View,
  config: SharedTooltipConfig,
): { finalize: () => void } {
  const buckets = sharedTooltipBuckets(config);
  const tooltip = document.createElement("div");
  tooltip.className = "motor-chart-shared-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  const seriesFields = config.seriesFields ?? [];

  let activeKey: string | undefined;
  const hide = (): void => {
    activeKey = undefined;
    tooltip.hidden = true;
  };
  const move: EventListenerHandler = (event, item) => {
    if (!(event instanceof MouseEvent)) return;
    const datum = item?.datum;
    if (
      config.rowMetric &&
      item?.mark.role === "mark" &&
      datum &&
      typeof datum === "object" &&
      config.rowMetric.seriesField in datum &&
      config.rowMetric.field in datum &&
      !(config.x in datum)
    ) {
      const row = datum as QueryRow;
      const renderKey = `row-metric\u0000${tooltipKey(
        row[config.rowMetric.seriesField],
        "nominal",
      )}`;
      if (activeKey !== renderKey) {
        const heading = document.createElement("div");
        heading.className = "motor-chart-shared-tooltip-heading";
        heading.textContent =
          `${config.rowMetric.seriesField}: ${tooltipText(row[config.rowMetric.seriesField])}`;
        const table = document.createElement("table");
        table.className = "motor-chart-shared-tooltip-table";
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        headRow.append(
          text(
            "th",
            config.rowMetric.label ?? detailLabel(config.rowMetric.field),
            "motor-chart-shared-tooltip-detail-heading",
          ),
        );
        head.append(headRow);
        const body = document.createElement("tbody");
        const bodyRow = document.createElement("tr");
        bodyRow.append(
          text(
            "td",
            formatValue(row[config.rowMetric.field]),
            "motor-chart-shared-tooltip-detail-value",
          ),
        );
        body.append(bodyRow);
        table.append(head, body);
        tooltip.replaceChildren(heading, table);
        activeKey = renderKey;
      }
      tooltip.hidden = false;
      positionTooltip(tooltip, event);
      return;
    }
    if (
      item?.mark.role !== "mark" ||
      !datum ||
      typeof datum !== "object" ||
      !(config.x in datum) ||
      seriesFields.some((series) => !(series.field in datum))
    ) {
      hide();
      return;
    }
    if (config.mode === "point") {
      const point = datum as QueryRow;
      const pointValues = [
        point[config.x],
        point[config.y],
        ...seriesFields.map((series) => point[series.field]),
        ...config.details.map((detail) => point[detail.field]),
      ];
      const renderKey = `point\u0000${pointValues
        .map((value) => tooltipKey(value, "nominal"))
        .join("\u0000")}`;
      if (activeKey !== renderKey) {
        const heading = document.createElement("div");
        heading.className = "motor-chart-shared-tooltip-heading";
        heading.textContent = `${config.x}: ${tooltipText(point[config.x])}`;
        const colorScale = tooltipColorScale(view, config.colorField);
        const table = document.createElement("table");
        table.className = "motor-chart-shared-tooltip-table";
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        if (config.colorField) {
          headRow.append(text("th", "", "motor-chart-shared-tooltip-swatch-heading"));
        }
        for (const series of seriesFields) {
          headRow.append(
            text("th", series.label ?? series.field, "motor-chart-shared-tooltip-series-heading"),
          );
        }
        headRow.append(text("th", config.y, "motor-chart-shared-tooltip-value-heading"));
        for (const detail of config.details) {
          headRow.append(
            text(
              "th",
              detail.label ?? detailLabel(detail.field),
              "motor-chart-shared-tooltip-detail-heading",
            ),
          );
        }
        head.append(headRow);

        const body = document.createElement("tbody");
        const row = document.createElement("tr");
        row.className = "is-hovered";
        if (config.colorField) {
          const swatchCell = document.createElement("td");
          swatchCell.className = "motor-chart-shared-tooltip-swatch-cell";
          const swatch = document.createElement("span");
          swatch.className = "motor-chart-shared-tooltip-swatch";
          const color = colorScale?.(point[config.colorField]);
          if (color != null) swatch.style.backgroundColor = String(color);
          swatchCell.append(swatch);
          row.append(swatchCell);
        }
        for (const series of seriesFields) {
          row.append(
            text("td", tooltipText(point[series.field]), "motor-chart-shared-tooltip-label"),
          );
        }
        row.append(
          text(
            "td",
            formatValue(point[config.y], config.valueFormat),
            "motor-chart-shared-tooltip-value",
          ),
        );
        for (const detail of config.details) {
          row.append(
            text(
              "td",
              formatValue(point[detail.field]),
              "motor-chart-shared-tooltip-detail-value",
            ),
          );
        }
        body.append(row);
        table.append(head, body);
        tooltip.replaceChildren(heading, table);
        activeKey = renderKey;
      }
      tooltip.hidden = false;
      positionTooltip(tooltip, event);
      return;
    }
    const key = tooltipKey((datum as QueryRow)[config.x], config.xType);
    const hoveredSeriesKey = tooltipSeriesKey(datum as QueryRow, config);
    const renderKey = `${key}\u0000${hoveredSeriesKey}`;
    const bucket = buckets.get(key);
    if (!bucket) {
      hide();
      return;
    }

    if (activeKey !== renderKey) {
      const heading = document.createElement("div");
      heading.className = "motor-chart-shared-tooltip-heading";
      heading.textContent = `${config.x}: ${tooltipText(bucket.x)}`;
      const colorScale = tooltipColorScale(view, config.colorField);
      const table = document.createElement("table");
      table.className = "motor-chart-shared-tooltip-table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      if (config.colorField) {
        headRow.append(text("th", "", "motor-chart-shared-tooltip-swatch-heading"));
      }
      for (const series of seriesFields) {
        headRow.append(
          text("th", series.label ?? series.field, "motor-chart-shared-tooltip-series-heading"),
        );
      }
      headRow.append(text("th", config.y, "motor-chart-shared-tooltip-value-heading"));
      if (config.normalizedLabel) {
        headRow.append(
          text(
            "th",
            config.normalizedLabel,
            "motor-chart-shared-tooltip-normalized-heading",
          ),
        );
      }
      for (const detail of config.details) {
        headRow.append(
          text(
            "th",
            detail.label ?? detailLabel(detail.field),
            "motor-chart-shared-tooltip-detail-heading",
          ),
        );
      }
      head.append(headRow);

      const body = document.createElement("tbody");
      for (const entry of bucket.entries) {
        const row = document.createElement("tr");
        row.className = entry.seriesKey === hoveredSeriesKey ? "is-hovered" : "is-muted";
        if (config.colorField) {
          const swatchCell = document.createElement("td");
          swatchCell.className = "motor-chart-shared-tooltip-swatch-cell";
          const swatch = document.createElement("span");
          swatch.className = "motor-chart-shared-tooltip-swatch";
          const color = colorScale?.(entry.colorValue);
          if (color != null) swatch.style.backgroundColor = String(color);
          swatchCell.append(swatch);
          row.append(swatchCell);
        }
        for (const series of entry.seriesValues) {
          row.append(
            text("td", tooltipText(series.value), "motor-chart-shared-tooltip-label"),
          );
        }
        row.append(
          text(
            "td",
            formatValue(entry.value, config.valueFormat),
            "motor-chart-shared-tooltip-value",
          ),
        );
        if (config.normalizedLabel) {
          row.append(
            text(
              "td",
              formatValue(entry.normalizedValue, { format: "percent" }),
              "motor-chart-shared-tooltip-value motor-chart-shared-tooltip-normalized-value",
            ),
          );
        }
        for (const detail of entry.details) {
          row.append(
            text("td", formatValue(detail.value), "motor-chart-shared-tooltip-detail-value"),
          );
        }
        body.append(row);
      }
      table.append(head, body);
      tooltip.replaceChildren(heading, table);
      activeKey = renderKey;
    }
    tooltip.hidden = false;
    positionTooltip(tooltip, event);
  };

  view.addEventListener("mousemove", move);
  view.addEventListener("mouseout", hide);
  return {
    finalize: () => {
      view.removeEventListener("mousemove", move);
      view.removeEventListener("mouseout", hide);
      tooltip.remove();
    },
  };
}

function positionTooltip(tooltip: HTMLElement, event: MouseEvent): void {
  const gap = 14;
  const margin = 8;
  const bounds = tooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + bounds.width > window.innerWidth - margin) {
    left = Math.max(margin, event.clientX - bounds.width - gap);
  }
  if (top + bounds.height > window.innerHeight - margin) {
    top = Math.max(margin, event.clientY - bounds.height - gap);
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

async function embedChart(
  element: HTMLElement,
  spec: TopLevelSpec,
  sharedTooltip?: SharedTooltipConfig,
): Promise<ChartHandle> {
  const result = await vegaEmbed(element, spec, { actions: false, renderer: "svg" });
  const tooltip = sharedTooltip ? mountSharedTooltip(result.view, sharedTooltip) : undefined;
  return {
    finalize: () => {
      tooltip?.finalize();
      result.view.finalize();
    },
  };
}

export function heatmapSpec(
  component: ComponentSpec,
  rows: QueryRow[],
): TopLevelSpec {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const value = String(component.props.value);
  const scheme = String(component.props.color_scheme ?? "blues");
  const reverse = component.props.color_direction === "lower_is_darker";
  const percent = component.props.format === "percent";
  const showValues = component.props.show_values !== false;
  const showPercentSign = component.props.show_percent_sign !== false;
  const rowMetric = component.props.row_metric
    ? String(component.props.row_metric)
    : undefined;
  const rowMetricTitle = rowMetric
    ? String(component.props.row_metric_title ?? rowMetric)
    : undefined;
  const rowMetricFormat: ValueFormatOptions = {
    format: String(component.props.row_metric_format ?? "number") as ValueFormat,
    notation: String(component.props.row_metric_notation ?? "standard") as
      | "standard"
      | "compact",
    ...(component.props.row_metric_currency
      ? { currency: String(component.props.row_metric_currency) }
      : {}),
  };
  const rowMetricResult = rowMetric
    ? buildHeatmapRowMetric(rows, y, rowMetric, rowMetricFormat)
    : undefined;
  const deriveCellLabel = percent && !showPercentSign;
  const chartRows = rowMetricResult || deriveCellLabel
    ? rows.map((row) => {
        const rawValue = row[value];
        const numericValue = Number(rawValue);
        return {
          ...row,
          ...(rowMetricResult
            ? {
                [ROW_METRIC_TOOLTIP_FIELD]:
                  rowMetricResult.tooltipByRow.get(heatmapRowMetricKey(row[y])) ?? "—",
              }
            : {}),
          ...(deriveCellLabel
            ? {
                [HEATMAP_LABEL_FIELD]:
                  rawValue == null ||
                  String(rawValue).trim() === "" ||
                  !Number.isFinite(numericValue)
                    ? null
                    : numericValue * 100,
              }
            : {}),
        };
      })
    : rows;
  let minimum = 0;
  let maximum = 0;
  for (const row of rows) {
    const rawValue = row[value];
    if (rawValue == null || String(rawValue).trim() === "") continue;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) continue;
    minimum = Math.min(minimum, numericValue);
    maximum = Math.max(maximum, numericValue);
  }
  const diverging = minimum < 0;
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  const colorScale = diverging
    ? {
        scheme: "redblue" as ColorScheme,
        domain: [-magnitude, 0, magnitude],
      }
    : {
        scheme: scheme as ColorScheme,
        reverse,
      };
  const yCount = new Set(rows.map((row) => tooltipKey(row[y], "nominal"))).size;
  const height = Math.max(300, yCount * 34) + (rowMetricResult ? 26 : 0);
  const rowMetricWidth = 82;
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    config: MOTOR_VEGA_CONFIG,
    width: "container",
    height,
    autosize: { type: "fit", contains: "padding", resize: true },
    ...(rowMetricResult
      ? { padding: { top: 26, right: 5, bottom: 5, left: 5 } }
      : {}),
    data: { values: chartRows },
    encoding: {
      x: { field: x, type: "ordinal", title: x, sort: "ascending" },
      y: {
        field: y,
        type: "ordinal",
        title: y,
        sort: "ascending",
        ...(rowMetricResult ? { axis: { labelPadding: rowMetricWidth + 12 } } : {}),
      },
    },
    layer: [
      ...(rowMetricResult && rowMetricTitle
        ? [
            {
              data: { values: rowMetricResult.rows },
              mark: {
                type: "rect" as const,
                color: "#faf7f2",
                stroke: "#fffdf9",
                strokeWidth: 1,
                tooltip: false,
              },
              encoding: {
                x: { value: -rowMetricWidth },
                x2: { value: -2 },
              },
            },
            {
              data: { values: rowMetricResult.rows },
              mark: {
                type: "text" as const,
                align: "right" as const,
                baseline: "middle" as const,
                color: "#524a41",
                fontSize: 12,
                fontWeight: "bold" as const,
                tooltip: false,
              },
              encoding: {
                x: { value: -10 },
                text: { field: ROW_METRIC_DISPLAY_FIELD, type: "nominal" as const },
              },
            },
            {
              data: { values: [{}] },
              mark: {
                type: "text" as const,
                align: "right" as const,
                baseline: "bottom" as const,
                color: "#8c857a",
                fontSize: 11,
                fontWeight: "bold" as const,
              },
              encoding: {
                x: { value: -10 },
                y: { value: -7 },
                text: { value: rowMetricTitle },
              },
            },
          ]
        : []),
      {
        mark: { type: "rect", tooltip: false, stroke: "#fffdf9", strokeWidth: 1 },
        encoding: {
          color: {
            field: value,
            type: "quantitative",
            title: value,
            scale: colorScale,
            ...(percent ? { legend: { format: ".0%" } } : {}),
          },
        },
      },
      ...(showValues
        ? [
            {
              mark: {
                type: "text" as const,
                color: heatmapTextColor(value),
                fontSize: 11,
                fontWeight: "normal" as const,
                tooltip: false,
              },
              encoding: {
                text: {
                  field: deriveCellLabel ? HEATMAP_LABEL_FIELD : value,
                  type: "quantitative" as const,
                  format: percent ? (showPercentSign ? ".1%" : ".1f") : ",.2~f",
                },
              },
            },
          ]
        : []),
    ],
  };
}

export function heatmapTooltipConfig(
  component: ComponentSpec,
  rows: QueryRow[],
): SharedTooltipConfig {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const value = String(component.props.value);
  const rowMetric = component.props.row_metric
    ? String(component.props.row_metric)
    : undefined;
  const rowMetricTitle = rowMetric
    ? String(component.props.row_metric_title ?? rowMetric)
    : undefined;
  const rowMetricResult = rowMetric
    ? buildHeatmapRowMetric(rows, y, rowMetric, {
        format: String(component.props.row_metric_format ?? "number") as ValueFormat,
        notation: "standard",
        ...(component.props.row_metric_currency
          ? { currency: String(component.props.row_metric_currency) }
          : {}),
      })
    : undefined;
  const tooltipRows = rowMetricResult
    ? rows.map((row) => ({
        ...row,
        [ROW_METRIC_TOOLTIP_FIELD]:
          rowMetricResult.tooltipByRow.get(heatmapRowMetricKey(row[y])) ?? "—",
      }))
    : rows;
  const detailFields = parseDetails(component.props.details);
  const details: TooltipDetailConfig[] = detailFields
    .filter((field) => field !== rowMetric)
    .map((field) => ({ field }));
  if (rowMetricResult && rowMetricTitle) {
    details.push({ field: ROW_METRIC_TOOLTIP_FIELD, label: rowMetricTitle });
  }
  return {
    x,
    y: value,
    seriesFields: [{ field: y, label: y }],
    colorField: value,
    xType: "nominal",
    rows: tooltipRows,
    details,
    valueFormat: {
      format: component.props.format as ValueFormat | undefined,
    },
    ...(rowMetricResult && rowMetricTitle
      ? {
          rowMetric: {
            field: ROW_METRIC_TOOLTIP_FIELD,
            label: rowMetricTitle,
            seriesField: y,
          },
        }
      : {}),
  };
}

async function renderHeatmap(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
): Promise<ChartHandle> {
  return embedChart(
    element,
    heatmapSpec(component, rows),
    heatmapTooltipConfig(component, rows),
  );
}

function scatterXType(rows: QueryRow[], x: string): {
  type: "temporal" | "quantitative";
  dateOnly: boolean;
} {
  const sample = rows.find((row) => row[x] != null)?.[x];
  const dateOnly = typeof sample === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sample);
  const temporal =
    typeof sample === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(sample) &&
    !Number.isNaN(Date.parse(sample));
  return { type: temporal ? "temporal" : "quantitative", dateOnly };
}

export function scatterSpec(
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitle?: string,
): TopLevelSpec {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = group ?? (component.props.color ? String(component.props.color) : undefined);
  const colorScheme = component.props.color_scheme
    ? String(component.props.color_scheme)
    : undefined;
  const reverseColors = component.props.color_direction === "lower_is_darker";
  const percent = component.props.format === "percent";
  const xAxis = scatterXType(rows, x);
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    config: MOTOR_VEGA_CONFIG,
    width: "container",
    height: STANDARD_CHART_HEIGHT,
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { values: rows },
    mark: {
      type: "point",
      filled: true,
      size: 70,
      opacity: 0.78,
      tooltip: false,
    },
    encoding: {
      x: {
        field: x,
        type: xAxis.type,
        title: x,
        ...(xAxis.dateOnly ? { axis: { format: "%Y-%m-%d" } } : {}),
      },
      y: {
        field: y,
        type: "quantitative",
        title: y,
        ...(percent ? { format: ".1%", axis: { format: ".0%" } } : {}),
      },
      ...(color
        ? {
            color: {
              field: color,
              type: colorScheme ? ("ordinal" as const) : ("nominal" as const),
              ...(colorScheme
                ? {
                    sort: "ascending" as const,
                    scale: { scheme: colorScheme as ColorScheme, reverse: reverseColors },
                  }
                : {}),
              ...(legendTitle ? { title: legendTitle } : {}),
            },
          }
        : {}),
    },
  };
}

export function scatterTooltipConfig(
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitle?: string,
): SharedTooltipConfig {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = group ?? (component.props.color ? String(component.props.color) : undefined);
  return {
    mode: "point",
    x,
    y,
    ...(color
      ? { seriesFields: [{ field: color, label: legendTitle ?? color }], colorField: color }
      : {}),
    xType: scatterXType(rows, x).type,
    rows,
    details: parseDetails(component.props.details).map((field) => ({ field })),
    valueFormat: {
      format: component.props.format as ValueFormat | undefined,
      currency:
        component.props.currency == null ? undefined : String(component.props.currency),
    },
  };
}

const LINE_STYLE_PATTERNS: number[][] = [
  [1, 0],
  [8, 4],
  [8, 4, 2, 4],
  [2, 3],
  [12, 4],
  [8, 3, 2, 3, 2, 3],
];

function orderedDomain(rows: QueryRow[], field: string): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const row of rows) {
    const value = row[field];
    const key = tooltipKey(value, "nominal");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function uniqueInternalField(rows: QueryRow[], base: string): string {
  let field = base;
  while (rows.some((row) => Object.hasOwn(row, field))) field += "_";
  return field;
}

function compositeOffsetRows(
  rows: QueryRow[],
  fields: string[],
): { rows: QueryRow[]; field: string } {
  if (fields.length === 1) return { rows, field: fields[0]! };
  const field = uniqueInternalField(rows, "__motor_bar_offset");
  return {
    field,
    rows: rows.map((row) => ({
      ...row,
      [field]: fields
        .map((source) => `${source}:${tooltipKey(row[source], "nominal")}`)
        .join("\u0000"),
    })),
  };
}

export function lineBarSpec(
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitles: Record<string, string> = {},
): { spec: TopLevelSpec; tooltip: SharedTooltipConfig } {
  if (component.type !== "LineChart" && component.type !== "BarChart") {
    throw new Error(`unsupported line/bar component: ${component.type}`);
  }
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = component.props.color ? String(component.props.color) : undefined;
  const lineStyle =
    component.type === "LineChart" && component.props.line_style
      ? String(component.props.line_style)
      : undefined;
  const stack = component.type === "BarChart" ? String(component.props.stack ?? "zero") : "none";
  const marker =
    component.type === "LineChart" ? String(component.props.marker ?? "none") : "none";
  const colorScheme = component.props.color_scheme
    ? String(component.props.color_scheme)
    : undefined;
  const reverseColors = component.props.color_direction === "lower_is_darker";
  const percent = component.props.format === "percent";
  const sampleX = rows.find((row) => row[x] != null)?.[x];
  const dateOnly = typeof sampleX === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sampleX);
  const offsetFields =
    component.type === "BarChart"
      ? stack === "none"
        ? uniqueFields([group, color])
        : uniqueFields([group])
      : [];
  const xType: XType =
    offsetFields.length === 0 &&
    typeof sampleX === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(sampleX) &&
    !Number.isNaN(Date.parse(sampleX))
      ? "temporal"
      : "nominal";
  if (stack === "normalize") validateStandardNormalize(rows, x, y);
  const partitionFields = group ? [group] : [];
  const signedNormalization =
    stack === "normalize_gross" || stack === "normalize_net"
      ? normalizeSignedRows(
          rows,
          x,
          y,
          xType === "temporal",
          stack,
          partitionFields,
        )
      : undefined;
  let chartRows = signedNormalization?.rows ?? rows;
  let offsetField: string | undefined;
  if (offsetFields.length > 0) {
    const offset = compositeOffsetRows(chartRows, offsetFields);
    chartRows = offset.rows;
    offsetField = offset.field;
  }
  const yField = signedNormalization?.field ?? y;
  const normalizedStack = stack === "normalize" || signedNormalization != null;
  const configuredBarWidth = component.props.bar_width;
  const barWidth =
    configuredBarWidth == null
      ? xType === "temporal"
        ? 18
        : undefined
      : Number(configuredBarWidth);
  const colorDomain = color ? orderedDomain(chartRows, color) : [];
  const groupDomain = group ? orderedDomain(chartRows, group) : [];
  const lineStyleDomain = lineStyle ? orderedDomain(chartRows, lineStyle) : [];
  const yEncoding = {
    field: yField,
    type: "quantitative" as const,
    title: y,
    ...(percent || normalizedStack ? { format: ".1%", axis: { format: ".0%" } } : {}),
    ...(component.type === "BarChart"
      ? {
          stack:
            stack === "none"
              ? null
              : stack === "normalize"
                ? ("normalize" as const)
                : ("zero" as const),
        }
      : {}),
  };
  const encoding = {
    x: {
      field: x,
      type: xType,
      title: x,
      ...(dateOnly && xType === "temporal" ? { axis: { format: "%Y-%m-%d" } } : {}),
    },
    y: yEncoding,
    ...(component.type === "LineChart" && group
      ? {
          detail: { field: group, type: "nominal" as const },
          strokeWidth: {
            field: group,
            type: "ordinal" as const,
            scale: { domain: groupDomain, range: groupDomain.map(() => 2) },
            ...(legendTitles[group] ? { title: legendTitles[group] } : {}),
          },
        }
      : {}),
    ...(color
      ? {
          color: {
            field: color,
            type: colorScheme ? ("ordinal" as const) : ("nominal" as const),
            scale: {
              domain: colorDomain,
              ...(colorScheme
                ? { scheme: colorScheme as ColorScheme, reverse: reverseColors }
                : {}),
            },
            ...(legendTitles[color] ? { title: legendTitles[color] } : {}),
          },
        }
      : {}),
    ...(lineStyle
      ? {
          strokeDash: {
            field: lineStyle,
            type: "nominal" as const,
            scale: {
              domain: lineStyleDomain,
              range: lineStyleDomain.map(
                (_, index) => LINE_STYLE_PATTERNS[index % LINE_STYLE_PATTERNS.length],
              ),
            },
            ...(legendTitles[lineStyle] ? { title: legendTitles[lineStyle] } : {}),
          },
        }
      : {}),
    ...(offsetField
      ? {
          xOffset: {
            field: offsetField,
            type: "nominal" as const,
            sort: orderedDomain(chartRows, offsetField),
          },
        }
      : {}),
  };
  const baseSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    config: MOTOR_VEGA_CONFIG,
    width: "container" as const,
    height: STANDARD_CHART_HEIGHT,
    autosize: { type: "fit" as const, contains: "padding" as const, resize: true },
    data: { values: chartRows },
    encoding,
  };
  const tooltip = lineBarTooltipConfig(
    component,
    chartRows,
    xType,
    signedNormalization,
    legendTitles,
  );
  const spec: TopLevelSpec =
    component.type === "LineChart"
      ? {
          ...baseSpec,
          layer: [
            { mark: { type: "line" } },
            ...(marker === "none"
              ? []
              : [
                  {
                    mark: {
                      type: marker as "point" | "circle",
                      size: 70,
                      tooltip: false,
                    },
                  },
                ]),
            {
              mark: {
                type: "point",
                size: 400,
                opacity: 0,
                tooltip: false,
              },
            },
          ],
        }
      : {
          ...baseSpec,
          mark: {
            type: "bar",
            tooltip: false,
            ...(barWidth == null ? {} : { width: barWidth }),
          },
        };
  return { spec, tooltip };
}

export async function renderChart(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitles: Record<string, string> = {},
): Promise<ChartHandle> {
  if (component.type === "Heatmap") return renderHeatmap(element, component, rows);
  if (component.type === "ScatterChart") {
    const group = component.props.group ? String(component.props.group) : undefined;
    const color = group ?? (component.props.color ? String(component.props.color) : undefined);
    const legendTitle = color ? legendTitles[color] : undefined;
    return embedChart(
      element,
      scatterSpec(component, rows, legendTitle),
      scatterTooltipConfig(component, rows, legendTitle),
    );
  }
  if (component.type !== "LineChart" && component.type !== "BarChart") {
    throw new Error(`unsupported chart component: ${component.type}`);
  }
  const chart = lineBarSpec(component, rows, legendTitles);
  return embedChart(element, chart.spec, chart.tooltip);
}
