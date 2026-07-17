import assert from "node:assert/strict";
import test from "node:test";
import { parse, View } from "vega";
import { compile } from "vega-lite";

import {
  buildHeatmapRowMetric,
  ROW_METRIC_DISPLAY_FIELD,
  ROW_METRIC_TOOLTIP_FIELD,
} from "./heatmapRowMetric";
import { heatmapSpec } from "./vegaAdapter";

test("row metric accepts one repeated value per heatmap row", () => {
  const result = buildHeatmapRowMetric(
    [
      { cohort: "2026-01", period: 0, size: 15240 },
      { cohort: "2026-01", period: 1, size: 15240 },
      { cohort: "2026-02", period: 0, size: 900 },
    ],
    "cohort",
    "size",
    { format: "number", notation: "compact" },
  );

  assert.equal(result.rows.length, 2);
  assert.notEqual(
    result.rows[0]?.[ROW_METRIC_DISPLAY_FIELD],
    result.rows[0]?.[ROW_METRIC_TOOLTIP_FIELD],
  );
  assert.match(String(result.rows[0]?.[ROW_METRIC_TOOLTIP_FIELD]), /15\D?240/);
});

test("row metric accepts a value on only one period and renders missing as dash", () => {
  const result = buildHeatmapRowMetric(
    [
      { cohort: "2026-01", period: 0, size: 100 },
      { cohort: "2026-01", period: 1, size: null },
      { cohort: "2026-02", period: 0, size: null },
    ],
    "cohort",
    "size",
    { format: "number" },
  );

  assert.equal(result.rows[0]?.[ROW_METRIC_DISPLAY_FIELD], "100");
  assert.equal(result.rows[1]?.[ROW_METRIC_DISPLAY_FIELD], "—");
});

test("row metric rejects conflicting values for one heatmap row", () => {
  assert.throws(
    () =>
      buildHeatmapRowMetric(
        [
          { cohort: "2026-01", period: 0, size: 100 },
          { cohort: "2026-01", period: 1, size: 99 },
        ],
        "cohort",
        "size",
        { format: "number" },
      ),
    /multiple values.*cohort=2026-01/,
  );
});

test("row metric rejects non-numeric values", () => {
  assert.throws(
    () =>
      buildHeatmapRowMetric(
        [{ cohort: "2026-01", period: 0, size: "large" }],
        "cohort",
        "size",
        { format: "number" },
      ),
    /must be numeric.*cohort=2026-01/,
  );
});

test("Vega renders a heatmap with the row metric layers", async () => {
  const spec = heatmapSpec(
    {
      id: "retention",
      type: "Heatmap",
      query: "retention",
      props: {
        x: "period",
        y: "cohort",
        value: "retention",
        format: "percent",
        show_percent_sign: false,
        row_metric: "size",
        row_metric_title: "Cohort size",
        row_metric_format: "number",
        row_metric_notation: "standard",
      },
    },
    [
      { cohort: "2026-01", period: 0, size: 100, retention: 1 },
      { cohort: "2026-01", period: 1, size: 100, retention: 0.5 },
    ],
  );

  const compiled = compile(spec).spec;
  assert.equal("layer" in spec && Array.isArray(spec.layer), true);
  assert.equal("layer" in spec ? spec.layer.length : 0, 5);
  const svg = await new View(parse(compiled), { renderer: "none" }).toSVG();
  assert.match(svg, /Cohort size/);
  assert.match(svg, />100</);
  assert.match(svg, />50\.0</);
  assert.doesNotMatch(svg, />50\.0%</);
  if (!("layer" in spec)) assert.fail("expected a layered heatmap spec");
  const valueLabelLayer = spec.layer.at(-1);
  const valueLabelMark = valueLabelLayer && "mark" in valueLabelLayer
    ? valueLabelLayer.mark
    : undefined;
  const markProperties =
    typeof valueLabelMark === "object"
      ? (valueLabelMark as unknown as Record<string, unknown>)
      : {};
  assert.equal(markProperties.fontSize, 11);
  assert.equal(markProperties.fontWeight, "normal");
});
