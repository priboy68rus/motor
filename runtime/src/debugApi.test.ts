import assert from "node:assert/strict";
import test from "node:test";

import { createMotorDebugApi } from "./debugApi";
import type { ParamValues, QueryRow, ReportSpec } from "./types";

const spec: ReportSpec = {
  report: { title: "Debug", slug: "debug", timezone: "UTC" },
  theme: { accent: "blue" },
  data: { events: { path: "events.csv" } },
  params: {
    breakdown: {
      type: "dimension",
      default: "country",
      choices: {
        country: { field: "country" },
        product: { field: "product_type" },
      },
    },
  },
  queries: {
    grouped_events: {
      kind: "view",
      sql_template: "select {{ dimension(breakdown) }} as breakdown from events",
      depends_on: { sources: ["events"], params: ["breakdown"], queries: [] },
      dimension_bindings: { breakdown: "breakdown" },
    },
    summary: {
      kind: "query",
      sql_template: "select count(*) as rows from grouped_events",
      depends_on: { sources: [], params: ["breakdown"], queries: ["grouped_events"] },
      dimension_bindings: {},
    },
  },
  components: [],
  body: "",
};

test("motorDebug executes SQL and reports the current rendered query state", async () => {
  const executed: string[] = [];
  const rows: QueryRow[] = [{ breakdown: "DE", rows: 3 }];
  const runner = {
    async debugSql(sql: string): Promise<QueryRow[]> {
      executed.push(sql);
      return rows;
    },
  };
  const values: ParamValues = { breakdown: "country" };
  const debug = createMotorDebugApi(runner, spec, () => values);

  assert.deepEqual(await debug.sql("select * from grouped_events"), rows);
  assert.deepEqual(executed, ["select * from grouped_events"]);
  assert.equal(
    debug.querySql("grouped_events"),
    'select "country" as breakdown from events',
  );

  values.breakdown = "product";
  assert.equal(
    debug.querySql("grouped_events"),
    'select "product_type" as breakdown from events',
  );
});

test("motorDebug exposes cloned params and the declared query list", () => {
  const values: ParamValues = {
    breakdown: "country",
    date_range: { start: "2026-08-01", end: "2026-08-27" },
  };
  const debug = createMotorDebugApi(
    { debugSql: async () => [] },
    spec,
    () => values,
  );

  const snapshot = debug.params();
  (snapshot.date_range as { start: string }).start = "changed";

  assert.equal((values.date_range as { start: string }).start, "2026-08-01");
  assert.deepEqual(debug.queries(), [
    { name: "grouped_events", kind: "view" },
    { name: "summary", kind: "query" },
  ]);
  assert.throws(() => debug.querySql("missing"), /unknown motor query: missing/);
});

test("motorDebug rejects empty SQL", async () => {
  const debug = createMotorDebugApi(
    { debugSql: async () => [] },
    spec,
    () => ({ breakdown: "country" }),
  );

  await assert.rejects(debug.sql("  \n"), /requires a non-empty SQL string/);
});
