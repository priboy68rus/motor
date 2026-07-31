import assert from "node:assert/strict";
import test from "node:test";
import { parse, View } from "vega";
import { compile } from "vega-lite";

import { scatterSpec } from "./vegaAdapter";

test("Vega renders a quantitative scatter plot with point tooltip fields", async () => {
  const spec = scatterSpec(
    {
      id: "customers",
      type: "ScatterChart",
      query: "customers",
      props: {
        x: "orders",
        y: "revenue",
        color: "segment",
        details: "country",
        format: "percent",
        color_scheme: "viridis",
      },
    },
    [
      { orders: 2, revenue: 0.25, segment: "SMB", country: "DE" },
      { orders: 8, revenue: 0.75, segment: "Enterprise", country: "FR" },
    ],
    "Segment",
  );

  const unitSpec = spec as unknown as {
    mark?: { type?: string } | string;
    encoding?: {
      x?: { type?: string };
      y?: { type?: string };
      color?: { field?: string };
      tooltip?: unknown[];
    };
  };
  assert.equal(
    unitSpec.mark && typeof unitSpec.mark === "object" ? unitSpec.mark.type : undefined,
    "point",
  );
  assert.equal(unitSpec.encoding?.x?.type, "quantitative");
  assert.equal(unitSpec.encoding?.y?.type, "quantitative");
  assert.equal(unitSpec.encoding?.color?.field, "segment");
  assert.equal(unitSpec.encoding?.tooltip?.length, 4);

  const compiled = compile(spec).spec;
  const svg = await new View(parse(compiled), { renderer: "none" }).toSVG();
  assert.match(svg, /Segment/);
});
