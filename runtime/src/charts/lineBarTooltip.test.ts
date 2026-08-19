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

  assert.equal(config.series, undefined);
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

  assert.equal(config.series, undefined);
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

test("a grouped tooltip uses the Vega color scale", () => {
  const colorScale = (value: unknown): unknown => `color:${String(value)}`;
  const view = { scale: (name: string) => (name === "color" ? colorScale : undefined) };

  assert.equal(tooltipColorScale(view, "country")?.("RU"), "color:RU");
});
