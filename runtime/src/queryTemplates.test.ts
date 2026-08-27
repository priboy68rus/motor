import assert from "node:assert/strict";
import test from "node:test";

import { renderQueryTemplate } from "./queryTemplates";
import type { ParamSpec, QuerySpec } from "./types";

const query: QuerySpec = {
  kind: "query",
  sql_template: 'select * from events where {{ in_filter("country", country) }}',
  depends_on: { sources: ["events"], params: ["country"], queries: [] },
  dimension_bindings: {},
};

function render(value: unknown, overrides: Partial<ParamSpec> = {}): string {
  const param: ParamSpec = {
    type: "multiselect",
    default: "all",
    empty_behavior: "none",
    options: {
      source: "events",
      column: "country",
      include_null: true,
      null_label: "(Null)",
    },
    ...overrides,
  };
  return renderQueryTemplate(query, { country: param }, { country: value });
}

test("in_filter renders a selected NULL as IS NULL", () => {
  assert.equal(render(null), 'select * from events where "country" IS NULL');
});

test("in_filter combines concrete and NULL multiselect values", () => {
  assert.equal(
    render(["DE", null, "FR"]),
    'select * from events where ("country" IN (\'DE\', \'FR\') OR "country" IS NULL)',
  );
});

test("in_filter retains All and empty-selection behavior", () => {
  assert.equal(render("all"), "select * from events where TRUE");
  assert.equal(render([]), "select * from events where FALSE");
  assert.equal(
    render([], { empty_behavior: "all" }),
    "select * from events where TRUE",
  );
});

test("include_null false treats null as an empty selection", () => {
  assert.equal(
    render(null, {
      options: { source: "events", column: "country", include_null: false },
    }),
    "select * from events where FALSE",
  );
  assert.equal(
    render(["DE", null], {
      options: { source: "events", column: "country", include_null: false },
    }),
    'select * from events where "country" IN (\'DE\')',
  );
});

test("dimension renders repeated aliases in union branches", () => {
  const dimensionQuery: QuerySpec = {
    kind: "query",
    sql_template:
      "select {{ dimension(breakdown) }} as breakdown from first_source " +
      "union all " +
      "select {{ dimension(breakdown) }} as breakdown from second_source",
    depends_on: {
      sources: ["first_source", "second_source"],
      params: ["breakdown"],
      queries: [],
    },
    dimension_bindings: { breakdown: "breakdown" },
  };
  const dimensionParam: ParamSpec = {
    type: "dimension",
    default: "country",
    choices: { country: { field: "country" } },
  };

  assert.equal(
    renderQueryTemplate(
      dimensionQuery,
      { breakdown: dimensionParam },
      { breakdown: "country" },
    ),
    'select "country" as breakdown from first_source ' +
      'union all select "country" as breakdown from second_source',
  );
});
