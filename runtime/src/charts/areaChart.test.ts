import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "vega-lite";
import { parse, View } from "vega";
import { lineBarSpec, sharedTooltipBuckets } from "./vegaAdapter";
import { componentCsvData } from "../csvDownload";
import type { ComponentSpec, QueryRow } from "../types";

const rows: QueryRow[] = [
  { day: "2026-01-01", channel: "app", value: 80, orders: 8 },
  { day: "2026-01-01", channel: "web", value: 20, orders: 2 },
  { day: "2026-01-02", channel: "app", value: 30, orders: 3 },
  { day: "2026-01-02", channel: "web", value: 70, orders: 7 },
];
const component = (stack = "zero"): ComponentSpec => ({
  id: "area",
  type: "AreaChart",
  query: "daily",
  props: { x: "day", y: "value", color: "channel", details: "orders", stack },
});

for (const stack of [
  "zero",
  "none",
  "normalize",
  "normalize_gross",
  "normalize_net",
]) {
  test(`AreaChart ${stack} renders real area paths and shares bar normalization/export semantics`, async () => {
    const chart = component(stack);
    const result = lineBarSpec(chart, rows, { channel: "Channel" });
    const spec = result.spec as any;
    assert.equal(spec.mark.type, "area");
    assert.equal(spec.mark.interpolate, "linear");
    assert.equal(spec.height, 360);
    assert.equal(spec.encoding.x.type, "temporal");
    assert.equal(spec.encoding.xOffset, undefined);
    assert.deepEqual(spec.encoding.color.scale.domain, ["app", "web"]);
    assert.equal(spec.encoding.color.title, "Channel");
    if (stack === "none") {
      assert.equal(spec.encoding.y.stack, null);
      assert.ok(spec.mark.opacity > 0 && spec.mark.opacity < 1);
    }
    const compiled = compile(result.spec).spec;
    const view = new View(parse(compiled), { renderer: "none" });
    try {
      await view.runAsync();
      const svg = await view.toSVG();
      assert.ok(svg.includes('class="mark-area '), "Expected an SVG area mark");
      assert.doesNotMatch(svg, /NaN|Infinity/);
      const stackData = compiled.data?.find((data: any) =>
        data.transform?.some((t: any) => t.type === "stack"),
      );
      if (stack === "none") assert.equal(stackData, undefined);
      else {
        assert.ok(stackData?.name);
        const transform = (stackData as any).transform.find(
          (t: any) => t.type === "stack",
        );
        const stacked = view.data(stackData!.name!) as QueryRow[];
        const maximum = Math.max(
          ...stacked.map((row) => Number(row[transform.as[1]])),
        );
        assert.ok(Math.abs(maximum - (stack === "zero" ? 100 : 1)) < 1e-9);
      }
    } finally {
      view.finalize();
    }
    const areaExport = componentCsvData(chart, rows);
    const barExport = componentCsvData({ ...chart, type: "BarChart" }, rows);
    assert.deepEqual(areaExport, barExport);
    const entries = sharedTooltipBuckets(result.tooltip).values().next().value!
      .entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.value, 80);
    assert.equal(entries[0]!.details[0]!.value, 8);
  });
}

test("signed AreaChart normalization preserves raw tooltip values and signed shares", () => {
  const signed = [
    { day: "2026-01-01", channel: "sales", value: 120 },
    { day: "2026-01-01", channel: "refund", value: -20 },
  ];
  for (const [stack, expected] of [
    ["normalize_gross", [120 / 140, -20 / 140]],
    ["normalize_net", [1.2, -0.2]],
  ] as const) {
    const chart = component(stack);
    const result = lineBarSpec(chart, signed);
    const entries = sharedTooltipBuckets(result.tooltip).values().next().value!
      .entries;
    assert.deepEqual(
      entries.map((entry) => entry.value),
      [120, -20],
    );
    assert.deepEqual(
      entries.map((entry) => entry.normalizedValue),
      expected,
    );
    const download = componentCsvData(chart, signed);
    assert.deepEqual(
      download.rows.map((row) => row.value_normalized),
      expected,
    );
  }
});

test("AreaChart rejects negative composition and undefined net shares with useful component names", () => {
  const signed = [
    { day: "2026-01-01", channel: "A", value: 10 },
    { day: "2026-01-01", channel: "B", value: -10 },
  ];
  assert.throws(
    () => lineBarSpec(component("normalize"), signed),
    /AreaChart.*non-negative/,
  );
  assert.throws(
    () => lineBarSpec(component("normalize_net"), signed),
    /AreaChart.*sum\(value\) is zero/,
  );
  assert.throws(
    () => componentCsvData(component("normalize"), signed),
    /AreaChart.*non-negative/,
  );
  assert.throws(
    () => componentCsvData(component("normalize_net"), signed),
    /AreaChart.*sum\(value\) is zero/,
  );
});

test("AreaChart supports a single uncolored area and empty results", async () => {
  for (const data of [
    [],
    [
      { day: "2026-01-01", value: 10 },
      { day: "2026-01-02", value: 12 },
    ],
  ]) {
    const result = lineBarSpec(
      { ...component(), props: { x: "day", y: "value" } },
      data,
    );
    const view = new View(parse(compile(result.spec).spec), {
      renderer: "none",
    });
    try {
      await view.runAsync();
      assert.doesNotMatch(await view.toSVG(), /NaN|Infinity/);
    } finally {
      view.finalize();
    }
  }
});

for (const interpolate of [
  "linear", "linear-closed", "step", "step-before", "step-after", "basis",
  "basis-open", "basis-closed", "cardinal", "cardinal-open", "cardinal-closed", "monotone",
]) {
  test(`AreaChart ${interpolate} interpolation renders in every stack mode`, async () => {
    // Open splines need at least three observations to produce a path.
    const data = [...rows,
      { day: "2026-01-03", channel: "app", value: 60, orders: 6 },
      { day: "2026-01-03", channel: "web", value: 40, orders: 4 },
      { day: "2026-01-04", channel: "app", value: 45, orders: 5 },
      { day: "2026-01-04", channel: "web", value: 55, orders: 5 },
    ];
    for (const stack of ["zero", "none", "normalize", "normalize_gross", "normalize_net"]) {
      const chart = component(stack);
      chart.props.interpolate = interpolate;
      const { spec } = lineBarSpec(chart, data);
      assert.equal((spec as any).mark.interpolate, interpolate);
      const view = new View(parse(compile(spec).spec), { renderer: "none" });
      try {
        await view.runAsync();
        const svg = await view.toSVG();
        assert.match(svg, /<path[^>]+d="M/);
        assert.doesNotMatch(svg, /NaN|Infinity/);
        if (["basis", "cardinal", "monotone"].includes(interpolate)) {
          assert.match(svg, /<path[^>]+d="M[^"]*C/);
        }
      } finally {
        view.finalize();
      }
    }
  });
}
