import assert from "node:assert/strict";
import test from "node:test";

import {
  componentCsvData,
  componentCsvFilename,
  serializeComponentCsv,
} from "./csvDownload";

test("chart CSV keeps current visible fields in SQL column order", () => {
  const data = componentCsvData(
    {
      id: "revenue",
      type: "LineChart",
      query: "revenue",
      props: { x: "month", y: "gmv", group: "channel", details: "orders" },
    },
    [
      {
        hidden: "not exported",
        channel: "app",
        month: "2026-01-01",
        orders: 3,
        gmv: 120,
      },
    ],
  );

  assert.deepEqual(data.columns, ["channel", "month", "orders", "gmv"]);
  assert.deepEqual(data.rows[0], {
    channel: "app",
    month: "2026-01-01",
    orders: 3,
    gmv: 120,
  });
});

test("normalized bar CSV includes raw and plotted values", () => {
  const data = componentCsvData(
    {
      id: "share",
      type: "BarChart",
      query: "share",
      props: { x: "month", y: "gmv", group: "channel", stack: "normalize" },
    },
    [
      { month: "2026-01", channel: "app", gmv: 80 },
      { month: "2026-01", channel: "web", gmv: 20 },
    ],
  );

  assert.deepEqual(data.columns, ["month", "channel", "gmv", "gmv_normalized"]);
  assert.equal(data.rows[0]?.gmv, 80);
  assert.equal(data.rows[0]?.gmv_normalized, 0.8);
  assert.equal(data.rows[1]?.gmv_normalized, 0.2);
});

test("signed normalized bar CSV uses the plotted gross and net calculations", () => {
  const component = (stack: "normalize_gross" | "normalize_net") => ({
    id: stack,
    type: "BarChart" as const,
    query: "share",
    props: { x: "month", y: "gmv", group: "channel", stack },
  });
  const gross = componentCsvData(component("normalize_gross"), [
    { month: "2026-01", channel: "app", gmv: 80 },
    { month: "2026-01", channel: "refund", gmv: -20 },
  ]);
  const net = componentCsvData(component("normalize_net"), [
    { month: "2026-01", channel: "app", gmv: 120 },
    { month: "2026-01", channel: "refund", gmv: -20 },
  ]);

  assert.equal(gross.rows[0]?.gmv_normalized, 0.8);
  assert.equal(gross.rows[1]?.gmv_normalized, -0.2);
  assert.equal(net.rows[0]?.gmv_normalized, 1.2);
  assert.equal(net.rows[1]?.gmv_normalized, -0.2);
});

test("heatmap CSV includes row_metric but not hidden query columns", () => {
  const data = componentCsvData(
    {
      id: "retention",
      type: "Heatmap",
      query: "retention",
      props: {
        x: "period",
        y: "cohort",
        value: "retention",
        row_metric: "cohort_size",
      },
    },
    [{ cohort: "2026-01", cohort_size: 100, period: 0, retention: 1, hidden: 42 }],
  );

  assert.deepEqual(data.columns, ["cohort", "cohort_size", "period", "retention"]);
  assert.equal("hidden" in (data.rows[0] ?? {}), false);
});

test("CSV is Excel-compatible, escaped, and protects formula strings", () => {
  const csv = serializeComponentCsv({
    columns: ["name", "value", "missing"],
    rows: [{ name: 'A, "quoted"', value: "=2+2", missing: null }],
  });

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /name,value,missing\r\n/);
  assert.match(csv, /"A, ""quoted""",'=2\+2,\r\n/);
});

test("CSV filename uses stable safe identifiers and a UTC timestamp", () => {
  assert.equal(
    componentCsvFilename("sales report", "gmv/chart", new Date("2026-07-17T12:34:56Z")),
    "sales-report-gmv-chart-20260717-123456.csv",
  );
});
