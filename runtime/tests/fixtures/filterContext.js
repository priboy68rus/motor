import { ReportRenderer } from "../../src/components";
const params = {
  country: {
    type: "multiselect",
    label: "Country",
    default: [
      "Germany — a long option",
      "France — another long option",
      "Netherlands",
      "Italy",
    ],
    options: { source: "orders", column: "country" },
  },
  breakdown: {
    type: "dimension",
    label: "Group by",
    default: "product",
    choices: { product: { label: "Product", field: "product" } },
  },
  channel: { type: "select", label: "Channel", default: "all" },
  period: {
    type: "date_range",
    label: "Period",
    default: { start: "2026-06-01", end: "2026-06-30" },
  },
};
const query = (params) => ({
  kind: "query",
  sql_template: "",
  depends_on: { sources: [], queries: [], params },
  dimension_bindings: {},
});
const spec = {
  report: {
    title: "Chart filter context",
    slug: "filter-context",
    timezone: "UTC",
  },
  theme: { accent: "blue" },
  data: {},
  params,
  body: "",
  queries: {
    summary: query(["country", "breakdown", "period"]),
    unfiltered: query([]),
    dimension: query(["breakdown"]),
  },
  components: [
    {
      id: "sidebar",
      type: "Filters",
      props: { params: ["country"], placement: "sidebar" },
    },
    { id: "global", type: "Filters", props: { params: ["period"] } },
    {
      id: "local",
      type: "Filters",
      props: { params: ["breakdown", "country"] },
    },
    { id: "other", type: "Filters", props: { params: ["channel", "country"] } },
    {
      id: "line",
      type: "LineChart",
      query: "summary",
      props: { title: "Revenue by day", x: "x", y: "y" },
    },
    {
      id: "bar",
      type: "BarChart",
      query: "unfiltered",
      props: { title: "All revenue", x: "x", y: "y" },
    },
    {
      id: "scatter",
      type: "ScatterChart",
      query: "dimension",
      props: { x: "y", y: "z", download: false },
    },
    {
      id: "heatmap",
      type: "Heatmap",
      query: "summary",
      props: { title: "Revenue heatmap", x: "x", y: "group", value: "y" },
    },
    { id: "table", type: "Table", query: "summary", props: {} },
    { id: "big", type: "BigValue", query: "summary", props: { value: "y" } },
    {
      id: "big_all",
      type: "BigValue",
      query: "unfiltered",
      props: { value: "y", title: "Unfiltered metric" },
    },
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
          layout: [
            { type: "component", component: "local" },
            { type: "row", components: ["line", "bar"] },
            { type: "row", components: ["scatter", "heatmap"] },
            { type: "row", components: ["table", "big", "big_all"] },
          ],
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
const manifest = {
  report: spec.report,
  artifact: { id: "test", content_sha256: "test" },
  build: {
    built_at: "2026-06-01",
    tool_name: "motor",
    tool_version: "test",
    runtime_version: "test",
  },
  sources: [],
  freshness: { status: "passed", data_through: null, processed_at: null },
  checks: { status: "passed" },
};
const values = Object.fromEntries(
  Object.entries(params).map(([name, param]) => [
    name,
    structuredClone(param.default),
  ]),
);
const rows = [
  { x: "June", y: 12, z: 4, group: "A" },
  { x: "July", y: 20, z: 8, group: "A" },
];
const results = { summary: rows, unfiltered: rows, dimension: rows };
const options = {
  country: params.country.default,
  channel: ["Online", "Retail"],
};
const renderer = new ReportRenderer(
  document.querySelector("main"),
  manifest,
  spec,
  () => {},
  () => {},
  () => {},
);
await renderer.mount(results, {}, values, options);
window.fixture = {
  renderer,
  spec,
  values,
  results,
  options,
  update: async (name, value) => {
    values[name] = value;
    await renderer.updateFilters(values, options);
  },
  loading: () => renderer.setLoading(new Set(["summary"])),
  finish: () =>
    renderer.updateQueries(results, {}, new Set(["summary"]), values, options),
  fail: () =>
    renderer.updateQueries(
      results,
      { summary: "Example query failed" },
      new Set(["summary"]),
      values,
      options,
    ),
  remount: () => renderer.mount(results, {}, values, options),
};
