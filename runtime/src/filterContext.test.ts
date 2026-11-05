import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFilterContext,
  filterValueLabel,
  supportsFilterContext,
  paramValueIsDefault,
} from "./filterContext";
import type { ComponentSpec, ParamSpec, ReportSpec } from "./types";

const chart: ComponentSpec = {
  id: "trend",
  type: "LineChart",
  query: "summary",
  props: {},
};
const spec: ReportSpec = {
  report: { title: "Filters", slug: "filters", timezone: "UTC" },
  theme: { accent: "blue" },
  body: "",
  data: {},
  params: {
    country: { type: "multiselect", label: "Country", default: ["DE", "FR"] },
    breakdown: {
      type: "dimension",
      default: "product",
      choices: { product: { field: "product_type", label: "Product" } },
    },
    channel: { type: "select", default: "all" },
    period: {
      type: "date_range",
      default: { start: "2026-01-01", end: "2026-01-31" },
    },
  },
  queries: {
    // Final queries already carry parameters propagated from shared views by the compiler.
    summary: {
      kind: "query",
      sql_template: "select * from shared_view",
      depends_on: {
        sources: [],
        params: ["country", "breakdown", "period"],
        queries: ["shared_view"],
      },
      dimension_bindings: {},
    },
  },
  components: [
    {
      id: "sidebar",
      type: "Filters",
      props: { params: ["country"], placement: "sidebar" },
    },
    {
      id: "local",
      type: "Filters",
      props: { params: ["country", "breakdown"] },
    },
    { id: "other", type: "Filters", props: { params: ["country", "channel"] } },
    { id: "global", type: "Filters", props: { params: ["period"] } },
    chart,
  ],
  layout: [
    { type: "component", component: "sidebar" },
    { type: "component", component: "global" },
    {
      type: "tabs",
      tabset_id: "pages",
      tabs: [
        {
          id: "overview",
          title: "Overview",
          layout: [{ type: "row", components: ["local", "trend"] }],
        },
        {
          id: "details",
          title: "Details",
          layout: [{ type: "component", component: "other" }],
        },
      ],
    },
  ],
};

const values = Object.fromEntries(
  Object.entries(spec.params).map(([name, param]) => [name, param.default]),
);

test("chart context groups propagated dependencies and keeps unused dimensions in Not applied", () => {
  const groups = buildFilterContext(spec, chart, values);
  assert.deepEqual(
    groups.map((group) => [group.label, group.rows.map((row) => row.name)]),
    [
      ["Breakdown", ["breakdown"]],
      ["Filters", ["country", "period"]],
      ["Not applied", ["channel"]],
    ],
  );
  assert.equal(groups[0]!.rows[0]!.value, "Product");
  assert.equal(groups[1]!.rows[0]!.multiple, 2);
  assert.equal(groups[1]!.rows[0]!.isDefault, true);
  const copy = structuredClone(spec);
  copy.queries.summary!.depends_on.params = ["country"];
  assert.deepEqual(
    buildFilterContext(copy, chart, values).map((group) => group.label),
    ["Filters", "Not applied"],
  );
  assert.deepEqual(
    buildFilterContext(copy, chart, values)[1]!.rows.map((row) => row.name),
    ["breakdown", "channel", "period"],
  );
});

test("one row per parameter includes sidebar, this tab, another tab, and report sources", () => {
  const groups = buildFilterContext(spec, chart, values);
  assert.deepEqual(groups[1]!.rows[0]!.sources, [
    { kind: "sidebar", label: "Sidebar" },
    { kind: "current-tab", label: "This tab: Overview" },
    { kind: "other-tab", label: "Other tab: Details" },
  ]);
  assert.deepEqual(groups[1]!.rows[1]!.sources, [
    { kind: "report", label: "Report" },
  ]);
  assert.equal(
    groups
      .flatMap((group) => group.rows)
      .filter((row) => row.name === "country").length,
    1,
  );
});

test("sources deduplicate controls in one location and distinguish equal tab IDs in different tabsets", () => {
  const copy = structuredClone(spec);
  copy.components.push({
    id: "duplicate",
    type: "Filters",
    props: { params: ["country"], placement: "sidebar" },
  });
  copy.layout!.push({
    type: "tabs",
    tabset_id: "another",
    tabs: [
      {
        id: "overview",
        title: "Another overview",
        layout: [{ type: "component", component: "other" }],
      },
    ],
  });
  const row = buildFilterContext(copy, chart, values)[1]!.rows[0]!;
  assert.equal(
    row.sources.filter((source) => source.kind === "sidebar").length,
    1,
  );
  assert.ok(
    row.sources.some(
      (source) => source.label === "Other tab: Another overview",
    ),
  );
});

test("unfiltered charts return only an empty context even with many declared controls", () => {
  const copy = structuredClone(spec);
  copy.queries.summary!.depends_on.params = [];
  assert.deepEqual(buildFilterContext(copy, chart, values), []);
  assert.deepEqual(
    buildFilterContext(spec, { ...chart, query: undefined }, values),
    [],
  );
});

test("a dimension alone counts as applied and parameters without controls remain discoverable", () => {
  const copy = structuredClone(spec);
  copy.components = [chart];
  copy.queries.summary!.depends_on.params = ["breakdown"];
  const groups = buildFilterContext(copy, chart, values);
  assert.equal(groups[0]!.label, "Breakdown");
  assert.deepEqual(groups[0]!.rows[0]!.sources, [
    { kind: "report", label: "Report parameter (no control)" },
  ]);
});

test("default equality respects unordered selections, nulls, scalar types and date bounds", () => {
  assert.equal(paramValueIsDefault(spec.params.country!, ["FR", "DE"]), true);
  assert.equal(paramValueIsDefault(spec.params.country!, ["DE"]), false);
  assert.equal(
    paramValueIsDefault({ type: "multiselect", default: [null, 1] }, [1, null]),
    true,
  );
  assert.equal(paramValueIsDefault({ type: "select", default: 1 }, "1"), false);
  assert.equal(
    paramValueIsDefault(spec.params.period!, {
      end: "2026-01-31",
      start: "2026-01-01",
    }),
    true,
  );
  assert.equal(
    paramValueIsDefault(spec.params.period!, {
      end: "2026-02-01",
      start: "2026-01-01",
    }),
    false,
  );
});

test("value labels distinguish all, no rows, SQL null, and the dimension disabled state", () => {
  const param: ParamSpec = {
    type: "multiselect",
    default: "all",
    empty_behavior: "none",
    options: {
      source: "orders",
      column: "country",
      null_label: "Unknown country",
    },
  };
  assert.equal(filterValueLabel(param, "all"), "All");
  assert.equal(filterValueLabel(param, []), "None");
  assert.equal(
    filterValueLabel({ ...param, empty_behavior: "all" }, []),
    "All",
  );
  assert.equal(filterValueLabel(param, [null, "DE"]), "Unknown country, DE");
  assert.equal(filterValueLabel(spec.params.breakdown!, "none"), "None");
  assert.equal(
    filterValueLabel(
      {
        type: "dimension",
        default: "all",
        choices: { all: { field: "all_products", label: "All products" } },
      },
      "all",
    ),
    "All products",
  );
  assert.equal(
    filterValueLabel(spec.params.period!, values.period),
    "2026-01-01 – 2026-01-31",
  );
});

test("filter indicators apply to charts and BigValue", () => {
  for (const type of [
    "LineChart",
    "BarChart",
    "AreaChart",
    "ScatterChart",
    "Heatmap",
    "BigValue",
  ] as const) {
    assert.equal(supportsFilterContext({ ...chart, type }), true);
  }
  for (const type of ["Table", "Filters", "Text"] as const) {
    assert.equal(supportsFilterContext({ ...chart, type }), false);
  }
});
