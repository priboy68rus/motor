import type { TopLevelSpec } from "vega-lite";

import type { ComponentSpec, QueryRow } from "../types";

declare const vegaEmbed: (
  element: HTMLElement,
  spec: TopLevelSpec,
  options: { actions: boolean; renderer: "svg" },
) => Promise<unknown>;

export async function renderChart(
  element: HTMLElement,
  component: ComponentSpec,
  rows: QueryRow[],
): Promise<void> {
  const mark = component.type === "LineChart" ? "line" : "bar";
  const x = String(component.props.x);
  const y = String(component.props.y);
  const group = component.props.group ?? component.props.color;
  const sampleX = rows.find((row) => row[x] != null)?.[x];
  const xType =
    component.type === "LineChart" &&
    typeof sampleX === "string" &&
    !Number.isNaN(Date.parse(sampleX))
      ? "temporal"
      : "nominal";
  const spec: TopLevelSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height: 300,
    autosize: { type: "fit", contains: "padding", resize: true },
    data: { values: rows },
    mark: { type: mark, tooltip: true },
    encoding: {
      x: { field: x, type: xType, title: x },
      y: { field: y, type: "quantitative", title: y },
      ...(group ? { color: { field: String(group), type: "nominal" } } : {}),
    },
  };
  await vegaEmbed(element, spec, { actions: false, renderer: "svg" });
}
