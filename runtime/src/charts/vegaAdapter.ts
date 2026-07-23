import type { TopLevelSpec } from "vega-lite";
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

const HEATMAP_LABEL_FIELD = "__motor_heatmap_label";

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<{ view: View }>;

export type ChartHandle = { finalize: () => void };

type XType = "temporal" | "nominal";

type SharedTooltipEntry = {
  series: unknown;
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
  x: string;
  y: string;
  series?: string;
  seriesLabel?: string;
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
    bucket.entries.push({
      series: config.series ? row[config.series] : row[config.y],
      colorValue: config.colorField
        ? row[config.colorField]
        : config.series
          ? row[config.series]
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
      (config.series != null && !(config.series in datum))
    ) {
      hide();
      return;
    }
    const key = tooltipKey((datum as QueryRow)[config.x], config.xType);
    const hoveredSeriesKey = tooltipKey(
      config.series ? (datum as QueryRow)[config.series] : (datum as QueryRow)[config.y],
      "nominal",
    );
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
      const colorScale = view.scale("color") as ((value: unknown) => unknown) | undefined;
      const table = document.createElement("table");
      table.className = "motor-chart-shared-tooltip-table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      if (config.series) {
        headRow.append(text("th", "", "motor-chart-shared-tooltip-swatch-heading"));
        headRow.append(
          text(
            "th",
            config.seriesLabel ?? config.series,
            "motor-chart-shared-tooltip-series-heading",
          ),
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
        row.className =
          tooltipKey(entry.series, "nominal") === hoveredSeriesKey ? "is-hovered" : "is-muted";
        if (config.series) {
          const swatchCell = document.createElement("td");
          swatchCell.className = "motor-chart-shared-tooltip-swatch-cell";
          const swatch = document.createElement("span");
          swatch.className = "motor-chart-shared-tooltip-swatch";
          const color = colorScale?.(entry.colorValue);
          if (color != null) swatch.style.backgroundColor = String(color);
          swatchCell.append(swatch);
          row.append(
            swatchCell,
            text("td", tooltipText(entry.series), "motor-chart-shared-tooltip-label"),
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
                color: "#f6f7f9",
                stroke: "white",
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
                color: "#344054",
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
                color: "#667085",
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
        mark: { type: "rect", tooltip: false, stroke: "white", strokeWidth: 1 },
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
    series: y,
    seriesLabel: y,
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

export async function renderChart(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitle?: string,
): Promise<ChartHandle> {
  if (component.type === "Heatmap") return renderHeatmap(element, component, rows);
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = group ?? (component.props.color ? String(component.props.color) : undefined);
  const stack = component.type === "BarChart" ? String(component.props.stack ?? "zero") : "none";
  const marker =
    component.type === "LineChart" ? String(component.props.marker ?? "none") : "none";
  const colorScheme = component.props.color_scheme
    ? String(component.props.color_scheme)
    : undefined;
  const details = parseDetails(component.props.details);
  const reverseColors = component.props.color_direction === "lower_is_darker";
  const percent = component.props.format === "percent";
  const sampleX = rows.find((row) => row[x] != null)?.[x];
  const dateOnly = typeof sampleX === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sampleX);
  const groupedBars = component.type === "BarChart" && Boolean(group) && stack === "none";
  const xType: XType =
    !groupedBars &&
    typeof sampleX === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(sampleX) &&
    !Number.isNaN(Date.parse(sampleX))
      ? "temporal"
      : "nominal";
  if (stack === "normalize") validateStandardNormalize(rows, x, y);
  const signedNormalization =
    stack === "normalize_gross" || stack === "normalize_net"
      ? normalizeSignedRows(rows, x, y, xType === "temporal", stack)
      : undefined;
  const chartRows = signedNormalization?.rows ?? rows;
  const yField = signedNormalization?.field ?? y;
  const normalizedStack = stack === "normalize" || signedNormalization != null;
  const configuredBarWidth = component.props.bar_width;
  const barWidth =
    configuredBarWidth == null
      ? xType === "temporal"
        ? 18
        : undefined
      : Number(configuredBarWidth);
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
    ...(groupedBars && group
      ? { xOffset: { field: group, type: "nominal" as const } }
      : {}),
  };
  const baseSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container" as const,
    height: 300,
    autosize: { type: "fit" as const, contains: "padding" as const, resize: true },
    data: { values: chartRows },
    encoding,
  };
  const sharedTooltip = color || details.length > 0
    ? {
        x,
        y,
        ...(color ? { series: color } : {}),
        xType,
        rows: chartRows,
        details: details.map((field) => ({ field })),
        ...(signedNormalization
          ? {
              normalizedField: signedNormalization.field,
              normalizedLabel: signedNormalization.label,
            }
          : {}),
        valueFormat: {
          format: component.props.format as ValueFormat | undefined,
          currency:
            component.props.currency == null ? undefined : String(component.props.currency),
        },
      }
    : undefined;
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
                      tooltip: !sharedTooltip,
                    },
                  },
                ]),
            {
              mark: {
                type: "point",
                size: 400,
                opacity: 0,
                tooltip: !sharedTooltip,
              },
            },
          ],
        }
      : {
          ...baseSpec,
          mark: {
            type: "bar",
            tooltip: !sharedTooltip,
            ...(barWidth == null ? {} : { width: barWidth }),
          },
        };
  return embedChart(element, spec, sharedTooltip);
}
