import assert from "node:assert/strict";
import test from "node:test";
import { parse, View } from "vega";
import { compile } from "vega-lite";

import { scatterSpec, scatterTooltipConfig } from "./vegaAdapter";

test("Vega renders a quantitative scatter plot with point tooltip fields", async () => {
  const component = {
    id: "customers",
    type: "ScatterChart" as const,
    query: "customers",
    props: {
      x: "orders",
      y: "revenue",
      color: "segment",
      details: "country",
      format: "percent",
      color_scheme: "viridis",
    },
  };
  const rows = [
    { orders: 2, revenue: 0.25, segment: "SMB", country: "DE" },
    { orders: 8, revenue: 0.75, segment: "Enterprise", country: "FR" },
  ];
  const spec = scatterSpec(component, rows, "Segment");
  const tooltipConfig = scatterTooltipConfig(component, rows, "Segment");

  const unitSpec = spec as unknown as {
    height?: number;
    mark?: { type?: string; tooltip?: boolean } | string;
    encoding?: {
      x?: { type?: string };
      y?: { type?: string };
      color?: { field?: string };
    };
  };
  assert.equal(unitSpec.height, 360);
  assert.equal(
    unitSpec.mark && typeof unitSpec.mark === "object" ? unitSpec.mark.type : undefined,
    "point",
  );
  assert.equal(unitSpec.encoding?.x?.type, "quantitative");
  assert.equal(unitSpec.encoding?.y?.type, "quantitative");
  assert.equal(unitSpec.encoding?.color?.field, "segment");
  assert.equal(
    unitSpec.mark && typeof unitSpec.mark === "object" ? unitSpec.mark.tooltip : undefined,
    false,
  );
  assert.equal(tooltipConfig.mode, "point");
  assert.deepEqual(tooltipConfig.seriesFields, [{ field: "segment", label: "Segment" }]);
  assert.deepEqual(tooltipConfig.details, [{ field: "country" }]);

  const compiled = compile(spec).spec;
  const svg = await new View(parse(compiled), { renderer: "none" }).toSVG();
  assert.match(svg, /Segment/);
});

test("scatter plot infers an ISO date X field as temporal", async () => {
  const spec = scatterSpec(
    {
      id: "monthly_revenue",
      type: "ScatterChart",
      query: "monthly_revenue",
      props: { x: "month_dt", y: "revenue" },
    },
    [
      { month_dt: "2026-01-01", revenue: 10 },
      { month_dt: "2026-02-01", revenue: 20 },
    ],
  );

  const unitSpec = spec as unknown as {
    encoding?: {
      x?: { type?: string; axis?: { format?: string } };
      y?: { type?: string };
    };
  };
  assert.equal(unitSpec.encoding?.x?.type, "temporal");
  assert.equal(unitSpec.encoding?.x?.axis?.format, "%Y-%m-%d");
  assert.equal(unitSpec.encoding?.y?.type, "quantitative");

  const compiled = compile(spec).spec;
  const svg = await new View(parse(compiled), { renderer: "none" }).toSVG();
  assert.match(svg, /2026-01-01/);
});
