import type { TopLevelSpec } from "vega-lite";

import type { ComponentSpec, QueryRow } from "../types";

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<{ view: { finalize: () => void } }>;

export type ChartHandle = { finalize: () => void };

export async function renderChart(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
  legendTitle?: string,
): Promise<ChartHandle> {
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ? String(component.props.group) : undefined;
  const color = group ?? (component.props.color ? String(component.props.color) : undefined);
  const stack = component.type === "BarChart" ? String(component.props.stack ?? "zero") : "none";
  const sampleX = rows.find((row) => row[x] != null)?.[x];
  const dateOnly = typeof sampleX === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sampleX);
  const groupedBars = component.type === "BarChart" && Boolean(group) && stack === "none";
  const xType =
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
  const mark =
    component.type === "LineChart"
      ? ({ type: "line", tooltip: true } as const)
      : ({
          type: "bar",
          tooltip: true,
          ...(barWidth == null ? {} : { width: barWidth }),
        } as const);
  const yEncoding = {
    field: y,
    type: "quantitative" as const,
    title: y,
    ...(component.type === "BarChart"
      ? {
          stack: stack === "none" ? null : (stack as "zero" | "normalize"),
          ...(stack === "normalize" ? { axis: { format: ".0%" } } : {}),
        }
      : {}),
  };
  const spec: TopLevelSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height: 300,
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { values: rows },
    mark,
    encoding: {
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
              type: "nominal",
              ...(legendTitle ? { title: legendTitle } : {}),
            },
          }
        : {}),
      ...(groupedBars && group
        ? { xOffset: { field: group, type: "nominal" } }
        : {}),
    },
  };
  const result = await vegaEmbed(element, spec, { actions: false, renderer: "svg" });
  return { finalize: () => result.view.finalize() };
}
