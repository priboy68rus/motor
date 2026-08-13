import assert from "node:assert/strict";
import test from "node:test";

import { QueryFailures } from "./queryErrors";

test("a skipped query includes the failed view error without its rendered SQL", () => {
  const failures = new QueryFailures();
  const viewError = failures.fail(
    "broken_view",
    "view",
    new Error("Binder Error: Referenced column missing_column not found"),
    "select missing_column from events",
  );
  const queryError = failures.skip("component_query", ["broken_view"]);

  assert.match(viewError, /Rendered SQL:/);
  assert.equal(
    queryError,
    "Query: component_query\n" +
      "Skipped because dependency failed: broken_view\n\n" +
      "Caused by view broken_view:\n" +
      "Binder Error: Referenced column missing_column not found",
  );
  assert.doesNotMatch(queryError, /Rendered SQL:/);
});

test("a transitive skip retains and deduplicates root causes", () => {
  const failures = new QueryFailures();
  failures.fail("broken_view", "view", "Catalog Error: table missing", "select * from missing");
  failures.skip("middle_query", ["broken_view"]);

  assert.match(
    failures.skip("component_query", ["broken_view", "middle_query"]),
    /Caused by view broken_view:\nCatalog Error: table missing$/,
  );
});
