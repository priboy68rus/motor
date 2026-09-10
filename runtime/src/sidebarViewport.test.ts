import assert from "node:assert/strict";
import test from "node:test";

import { sidebarViewportMaxHeight } from "./sidebarViewport";

test("sidebar height uses only the viewport visible below its current position", () => {
  assert.equal(sidebarViewportMaxHeight(800, 100), 684);
});

test("sidebar height expands when its sticky top is reached", () => {
  assert.equal(sidebarViewportMaxHeight(800, 16), 768);
  assert.equal(sidebarViewportMaxHeight(800, -20), 768);
});

test("sidebar height does not become negative below the viewport", () => {
  assert.equal(sidebarViewportMaxHeight(800, 900), 0);
});
