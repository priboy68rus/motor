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
};

type SharedTooltipBucket = {
  x: unknown;
  entries: SharedTooltipEntry[];
};

type SharedTooltipConfig = {
  x: string;
  y: string;
  series: string;
  xType: XType;
  rows: QueryRow[];
  valueFormat: ValueFormatOptions;
};

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
    bucket.entries.push({ series: row[config.series], value: row[config.y] });
  }
  return buckets;
}

function tooltipText(value: unknown): string {
  return value == null || String(value).trim() === "" ? "—" : String(value);
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
      !(config.x in datum)
    ) {
      hide();
      return;
    }
    const key = tooltipKey((datum as QueryRow)[config.x], config.xType);
    const bucket = buckets.get(key);
    if (!bucket) {
      hide();
      return;
    }

    if (activeKey !== key) {
      const heading = document.createElement("div");
      heading.className = "motor-chart-shared-tooltip-heading";
      heading.textContent = `${config.x}: ${tooltipText(bucket.x)}`;
      const rows = document.createElement("div");
      rows.className = "motor-chart-shared-tooltip-rows";
      const colorScale = view.scale("color") as ((value: unknown) => unknown) | undefined;
      for (const entry of bucket.entries) {
        const row = document.createElement("div");
        row.className = "motor-chart-shared-tooltip-row";
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
        rows.append(row);
      }
      tooltip.replaceChildren(heading, rows);
      activeKey = key;
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
  const spec: TopLevelSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height: 300,
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { values: rows },
    mark: { type: "rect", tooltip: true, stroke: "white", strokeWidth: 1 },
    encoding: {
      x: { field: x, type: "ordinal", title: x, sort: "ascending" },
      y: { field: y, type: "ordinal", title: y, sort: "ascending" },
      color: {
        field: value,
        type: "quantitative",
        title: value,
        scale: { scheme: scheme as ColorScheme, reverse },
        ...(percent ? { legend: { format: ".0%" } } : {}),
      },
      tooltip: [
        { field: y, type: "ordinal", title: y },
        { field: x, type: "ordinal", title: x },
        {
          field: value,
          type: "quantitative",
          title: value,
          ...(percent ? { format: ".1%" } : {}),
        },
      ],
    },
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
  const sharedTooltip = color
    ? {
        x,
        y,
        series: color,
        xType,
        rows,
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
