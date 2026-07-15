import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSignedRows, validateStandardNormalize } from "./stackNormalization";

const rows = (first: number, second: number) => [
  { period: "2026-01", kind: "first", value: first },
  { period: "2026-01", kind: "second", value: second },
];

test("normalize_gross uses total absolute magnitude and preserves signs", () => {
  const result = normalizeSignedRows(rows(80, -20), "period", "value", false, "normalize_gross");
  assert.equal(result.label, "Gross share");
  assert.equal(result.rows[0]![result.field], 0.8);
  assert.equal(result.rows[1]![result.field], -0.2);
});

test("normalize_net uses the absolute signed sum", () => {
  const result = normalizeSignedRows(rows(120, -20), "period", "value", false, "normalize_net");
  assert.equal(result.label, "Net contribution");
  assert.equal(result.rows[0]![result.field], 1.2);
  assert.equal(result.rows[1]![result.field], -0.2);
});

test("normalize_net keeps contribution signs when the net is negative", () => {
  const result = normalizeSignedRows(rows(20, -80), "period", "value", false, "normalize_net");
  assert.ok(Math.abs(Number(result.rows[0]![result.field]) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(Number(result.rows[1]![result.field]) + 4 / 3) < 1e-12);
});

test("normalize_net rejects a zero net sum", () => {
  assert.throws(
    () => normalizeSignedRows(rows(20, -20), "period", "value", false, "normalize_net"),
    /sum\(value\) is zero/,
  );
});

test("normalize rejects signed values and gross mode handles an all-zero stack", () => {
  assert.throws(() => validateStandardNormalize(rows(80, -20), "period", "value"), /requires non-negative/);
  const result = normalizeSignedRows(rows(0, 0), "period", "value", false, "normalize_gross");
  assert.equal(result.rows[0]![result.field], 0);
  assert.equal(result.rows[1]![result.field], 0);
});
