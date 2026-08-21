import assert from "node:assert/strict";
import test from "node:test";

import {
  lineBarTooltipConfig,
  sharedTooltipBuckets,
  tooltipColorScale,
} from "./vegaAdapter";
import type { ComponentSpec, QueryRow } from "../types";

test("line and bar tooltips include details without a group", () => {
  const component: ComponentSpec = {
    id: "revenue",
    type: "LineChart",
    query: "revenue",
    props: { x: "month", y: "revenue", details: "orders, customers" },
  };
  const rows: QueryRow[] = [
    { month: "2026-01", revenue: 120, orders: 8, customers: 6 },
  ];

  const config = lineBarTooltipConfig(component, rows, "nominal");
  const entry = sharedTooltipBuckets(config).get("string:2026-01")?.entries[0];

  assert.equal(config.seriesFields, undefined);
  assert.deepEqual(config.details, [{ field: "orders" }, { field: "customers" }]);
  assert.deepEqual(entry?.details, [
    { label: "Orders", value: 8 },
    { label: "Customers", value: 6 },
  ]);
});

test("line and bar charts create a motor tooltip even without optional fields", () => {
  const component: ComponentSpec = {
    id: "revenue",
    type: "BarChart",
    query: "revenue",
    props: { x: "month", y: "revenue" },
  };

  const config = lineBarTooltipConfig(component, [], "nominal");

  assert.equal(config.seriesFields, undefined);
  assert.deepEqual(config.details, []);
});

test("an ungrouped tooltip does not request a missing Vega color scale", () => {
  const view = {
    scale: () => {
      throw new Error("Unrecognized scale name: color");
    },
  };

  assert.equal(tooltipColorScale(view, undefined), undefined);
});

test("a colored tooltip uses the Vega color scale", () => {
  const colorScale = (value: unknown): unknown => `color:${String(value)}`;
  const view = { scale: (name: string) => (name === "color" ? colorScale : undefined) };

  assert.equal(tooltipColorScale(view, "country")?.("RU"), "color:RU");
});

test("line and bar tooltips keep group, color, and line style as independent series fields", () => {
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
  ];

  const config = lineBarTooltipConfig(component, rows, "temporal");
  const entry = sharedTooltipBuckets(config).get("date:1767225600000")?.entries[0];

  assert.deepEqual(config.seriesFields, [
    { field: "country", label: "country" },
    { field: "gender", label: "gender" },
    { field: "scenario", label: "scenario" },
  ]);
  assert.equal(config.colorField, "gender");
  assert.deepEqual(entry?.seriesValues, [
    { field: "country", label: "country", value: "RU" },
    { field: "gender", label: "gender", value: "female" },
    { field: "scenario", label: "scenario", value: "actual" },
  ]);
});
