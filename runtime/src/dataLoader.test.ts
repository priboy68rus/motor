import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { patchDuckDBWorker } from "./dataLoader";

const marker =
  "stackRestore=e=>__emscripten_stack_restore(e),createInvokeFunction=";

test("DuckDB worker patch connects missing exception bindings to WASM exports", () => {
  const source =
    `${marker}e=>e;` +
    "const handle=()=>{_setThrew(1,0);___cxa_can_catch(1,2,3)};";

  const patched = patchDuckDBWorker(source);

  assert.match(
    patched,
    /_setThrew=\(\.\.\.args\)=>wasmExports\.setThrew\(\.\.\.args\)/,
  );
  assert.match(
    patched,
    /___cxa_can_catch=\(\.\.\.args\)=>wasmExports\.__cxa_can_catch\(\.\.\.args\)/,
  );
  assert.match(patched, /createInvokeFunction=/);
});

test("DuckDB worker patch leaves an already patched source unchanged", () => {
  const source =
    `${marker}e=>e;` +
    "_setThrew=(...args)=>wasmExports.setThrew(...args);_setThrew(1,0);";

  assert.equal(patchDuckDBWorker(source), source);
});

test("DuckDB worker patch rejects an unknown worker layout", () => {
  assert.throws(
    () => patchDuckDBWorker("const handle=()=>_setThrew(1,0);"),
    /runtime binding insertion point changed/,
  );
});

test("DuckDB worker patch supports the pinned official CDN worker", () => {
  const source = readFileSync(
    "node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
    "utf8",
  );
  const patched = patchDuckDBWorker(source);

  assert.match(
    patched,
    /_setThrew=\(\.\.\.args\)=>wasmExports\.setThrew\(\.\.\.args\)/,
  );
  assert.match(
    patched,
    /___cxa_can_catch=\(\.\.\.args\)=>wasmExports\.__cxa_can_catch\(\.\.\.args\)/,
  );
});
