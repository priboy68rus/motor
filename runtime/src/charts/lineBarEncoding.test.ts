import assert from "node:assert/strict";
import test from "node:test";
import { parse, View } from "vega";
import { compile } from "vega-lite";

import { lineBarSpec, MOTOR_VEGA_CONFIG } from "./vegaAdapter";
import type { ComponentSpec, QueryRow } from "../types";

function encoding(spec: unknown): Record<string, any> {
  return (spec as { encoding: Record<string, any> }).encoding;
}

test("charts use the warm paper Vega theme", () => {
  assert.equal(MOTOR_VEGA_CONFIG.font, "IBM Plex Sans");
  assert.deepEqual(MOTOR_VEGA_CONFIG.range.category, [
    "#3b5b8c",
    "#c9873b",
    "#5f8f7a",
    "#a5606f",
  ]);
  assert.equal(MOTOR_VEGA_CONFIG.axis.gridColor, "#ece6dc");
});

test("LineChart applies group, color, and line_style as independent ordered channels", async () => {
  const component: ComponentSpec = {
    id: "comparison",
    type: "LineChart",
    query: "comparison",
    props: {
      x: "day",
      y: "value",
      group: "country",
      color: "gender",
      line_style: "scenario",
    },
  };
  const rows: QueryRow[] = [
    { day: "2026-01-01", country: "RU", gender: "female", scenario: "actual", value: 12 },
    { day: "2026-01-01", country: "US", gender: "male", scenario: "plan", value: 15 },
    { day: "2026-01-02", country: "RU", gender: "male", scenario: "forecast", value: 14 },
  ];

  const result = lineBarSpec(component, rows);
  const chartEncoding = encoding(result.spec);

  assert.deepEqual(chartEncoding.detail, { field: "country", type: "nominal" });
  assert.deepEqual(chartEncoding.strokeWidth.scale, {
    domain: ["RU", "US"],
    range: [2, 2],
  });
  assert.deepEqual(chartEncoding.color.scale.domain, ["female", "male"]);
  assert.deepEqual(chartEncoding.strokeDash.scale.domain, ["actual", "plan", "forecast"]);
  assert.deepEqual(chartEncoding.strokeDash.scale.range, [
    [1, 0],
    [8, 4],
    [8, 4, 2, 4],
  ]);
  const svg = await new View(parse(compile(result.spec).spec), { renderer: "none" }).toSVG();
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, />RU</);
  assert.match(svg, />US</);
});

test("LineChart renders a group legend without a color channel", async () => {
  const component: ComponentSpec = {
    id: "countries",
    type: "LineChart",
    query: "countries",
    props: { x: "day", y: "value", group: "country" },
  };
  const rows: QueryRow[] = [
    { day: "2026-01-01", country: "RU", value: 12 },
    { day: "2026-01-02", country: "RU", value: 13 },
    { day: "2026-01-01", country: "US", value: 15 },
    { day: "2026-01-02", country: "US", value: 16 },
  ];

  const result = lineBarSpec(component, rows, { country: "Country" });
  const chartEncoding = encoding(result.spec);
  const svg = await new View(parse(compile(result.spec).spec), { renderer: "none" }).toSVG();

  assert.equal(chartEncoding.color, undefined);
  assert.equal(chartEncoding.strokeWidth.title, "Country");
  assert.match(svg, />Country</);
  assert.match(svg, />RU</);
  assert.match(svg, />US</);
});

test("stacked BarChart offsets groups and stacks colors within each group", () => {
  const component: ComponentSpec = {
    id: "composition",
    type: "BarChart",
    query: "composition",
    props: { x: "month", y: "value", group: "country", color: "gender", stack: "zero" },
  };
  const rows: QueryRow[] = [
    { month: "2026-01", country: "US", gender: "female", value: 12 },
    { month: "2026-01", country: "RU", gender: "male", value: 10 },
    { month: "2026-01", country: "US", gender: "male", value: 8 },
  ];

  const result = lineBarSpec(component, rows);
  const chartEncoding = encoding(result.spec);

  assert.equal(chartEncoding.xOffset.field, "country");
  assert.deepEqual(chartEncoding.xOffset.sort, ["US", "RU"]);
  assert.deepEqual(chartEncoding.color.scale.domain, ["female", "male"]);
  assert.equal(chartEncoding.y.stack, "zero");
  const compiled = compile(result.spec).spec as {
    data?: Array<{ transform?: Array<{ type?: string; groupby?: string[] }> }>;
  };
  const stackTransform = compiled.data
    ?.flatMap((data) => data.transform ?? [])
    .find((transform) => transform.type === "stack");
  assert.ok(stackTransform?.groupby?.includes("country"));
});

test("unstacked BarChart offsets every group and color combination without changing color identity", () => {
  const component: ComponentSpec = {
    id: "comparison",
    type: "BarChart",
    query: "comparison",
    props: { x: "month", y: "value", group: "country", color: "gender", stack: "none" },
  };
  const rows: QueryRow[] = [
    { month: "2026-01", country: "US", gender: "female", value: 12 },
    { month: "2026-01", country: "RU", gender: "female", value: 10 },
    { month: "2026-01", country: "US", gender: "male", value: 8 },
  ];

  const result = lineBarSpec(component, rows);
  const chartEncoding = encoding(result.spec);
  const chartRows = (result.spec as { data: { values: QueryRow[] } }).data.values;

  assert.match(chartEncoding.xOffset.field, /^__motor_bar_offset/);
  assert.equal(new Set(chartRows.map((row) => row[chartEncoding.xOffset.field])).size, 3);
  assert.deepEqual(chartEncoding.color.scale.domain, ["female", "male"]);
  assert.equal(chartEncoding.y.stack, null);
});
