import type { TopLevelSpec } from "vega-lite";
import type { ColorScheme } from "vega";

import type { ComponentSpec, QueryRow } from "../types";

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<{ view: { finalize: () => void } }>;

export type ChartHandle = { finalize: () => void };

async function embedChart(element: HTMLElement, spec: TopLevelSpec): Promise<ChartHandle> {
  const result = await vegaEmbed(element, spec, { actions: false, renderer: "svg" });
  return { finalize: () => result.view.finalize() };
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
  const xType: "temporal" | "nominal" =
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
                      tooltip: true,
                    },
                  },
                ]),
            {
              mark: {
                type: "point",
                size: 400,
                opacity: 0,
                tooltip: true,
              },
            },
          ],
        }
      : {
          ...baseSpec,
          mark: {
            type: "bar",
            tooltip: true,
            ...(barWidth == null ? {} : { width: barWidth }),
          },
        };
  return embedChart(element, spec);
}
