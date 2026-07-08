import type { TopLevelSpec } from "vega-lite";
import type { ColorScheme, EventListenerHandler, View } from "vega";

import type { ComponentSpec, QueryRow } from "../types";
import { formatValue, type ValueFormat, type ValueFormatOptions } from "../valueFormatting";

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<{ view: View }>;

export type ChartHandle = { finalize: () => void };

type XType = "temporal" | "nominal";

type SharedTooltipEntry = {
  series: unknown;
  value: unknown;
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
  xType: XType;
  rows: QueryRow[];
  valueFormat: ValueFormatOptions;
  details: string[];
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

function sharedTooltipBuckets(config: SharedTooltipConfig): Map<string, SharedTooltipBucket> {
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
      series: config.series ? row[config.series] : config.y,
      value: row[config.y],
      details: config.details.map((field) => ({
        label: detailLabel(field),
        value: row[field],
      })),
    });
  }
  return buckets;
}

function tooltipText(value: unknown): string {
  return value == null || String(value).trim() === "" ? "—" : String(value);
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
      config.series ? (datum as QueryRow)[config.series] : config.y,
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
      const rows = document.createElement("div");
      rows.className = "motor-chart-shared-tooltip-rows";
      const colorScale = view.scale("color") as ((value: unknown) => unknown) | undefined;
      for (const entry of bucket.entries) {
        const row = document.createElement("div");
        row.className = "motor-chart-shared-tooltip-row";
        row.classList.add(
          tooltipKey(entry.series, "nominal") === hoveredSeriesKey
            ? "is-hovered"
            : "is-muted",
        );
        const swatch = document.createElement("span");
        swatch.className = "motor-chart-shared-tooltip-swatch";
        const color = colorScale?.(entry.series);
        if (color != null) swatch.style.backgroundColor = String(color);
        const label = document.createElement("span");
        label.className = "motor-chart-shared-tooltip-label";
        label.textContent = tooltipText(entry.series);
        const value = document.createElement("span");
        value.className = "motor-chart-shared-tooltip-value";
        value.textContent = formatValue(entry.value, config.valueFormat);
        row.append(swatch, label, value);
        if (entry.details.length > 0) {
          const details = document.createElement("div");
          details.className = "motor-chart-shared-tooltip-details";
          for (const detail of entry.details) {
            const detailRow = document.createElement("div");
            detailRow.className = "motor-chart-shared-tooltip-detail";
            const detailLabelElement = document.createElement("span");
            detailLabelElement.className = "motor-chart-shared-tooltip-detail-label";
            detailLabelElement.textContent = detail.label;
            const detailValueElement = document.createElement("span");
            detailValueElement.className = "motor-chart-shared-tooltip-detail-value";
            detailValueElement.textContent = formatValue(detail.value);
            detailRow.append(detailLabelElement, detailValueElement);
            details.append(detailRow);
          }
          row.append(details);
        }
        rows.append(row);
      }
      tooltip.replaceChildren(heading, rows);
      activeKey = renderKey;
    }
    tooltip.hidden = false;

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

async function renderHeatmap(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
): Promise<ChartHandle> {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const value = String(component.props.value);
  const scheme = String(component.props.color_scheme ?? "blues");
  const reverse = component.props.color_direction === "lower_is_darker";
  const percent = component.props.format === "percent";
  const showValues = component.props.show_values !== false;
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
  const height = Math.max(300, yCount * 34);
  const tooltip = [
    { field: y, type: "ordinal" as const, title: y },
    { field: x, type: "ordinal" as const, title: x },
    {
      field: value,
      type: "quantitative" as const,
      title: value,
      ...(percent ? { format: ".1%" } : {}),
    },
  ];
  const spec: TopLevelSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height,
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { values: rows },
    encoding: {
      x: { field: x, type: "ordinal", title: x, sort: "ascending" },
      y: { field: y, type: "ordinal", title: y, sort: "ascending" },
    },
    layer: [
      {
        mark: { type: "rect", tooltip: true, stroke: "white", strokeWidth: 1 },
        encoding: {
          color: {
            field: value,
            type: "quantitative",
            title: value,
            scale: colorScale,
            ...(percent ? { legend: { format: ".0%" } } : {}),
          },
          tooltip,
        },
      },
      ...(showValues
        ? [
            {
              mark: {
                type: "text" as const,
                color: heatmapTextColor(value),
                fontSize: 12,
                fontWeight: "bold" as const,
                tooltip: true,
              },
              encoding: {
                text: {
                  field: value,
                  type: "quantitative" as const,
                  format: percent ? ".1%" : ",.2~f",
                },
                tooltip,
              },
            },
          ]
        : []),
    ],
  };
  return embedChart(element, spec);
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
  const configuredBarWidth = component.props.bar_width;
  const barWidth =
    configuredBarWidth == null
      ? xType === "temporal"
        ? 18
        : undefined
      : Number(configuredBarWidth);
  const yEncoding = {
    field: y,
    type: "quantitative" as const,
    title: y,
    ...(percent ? { format: ".1%", axis: { format: ".0%" } } : {}),
    ...(component.type === "BarChart"
      ? {
          stack: stack === "none" ? null : (stack as "zero" | "normalize"),
          ...(stack === "normalize" ? { axis: { format: ".0%" } } : {}),
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
    data: { values: rows },
    encoding,
  };
  const sharedTooltip = color || details.length > 0
    ? {
        x,
        y,
        ...(color ? { series: color } : {}),
        xType,
        rows,
        details,
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
