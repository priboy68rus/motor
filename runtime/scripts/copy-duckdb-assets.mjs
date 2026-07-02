import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const destination = new URL("../../src/motor/static/", import.meta.url);
const distribution = new URL("../node_modules/@duckdb/duckdb-wasm/dist/", import.meta.url);
const gzipAsync = promisify(gzip);

await mkdir(destination, { recursive: true });
const wasm = await readFile(new URL("duckdb-mvp.wasm", distribution));
const workerSource = await readFile(
  new URL("duckdb-browser-mvp.worker.js", distribution),
  "utf8",
);
const runtimeBindingMarker =
  "stackRestore=e=>__emscripten_stack_restore(e),createInvokeFunction=";
const mvpRuntimeBindings = [
  ["___cxa_can_catch", "__cxa_can_catch"],
  ["___cxa_decrement_exception_refcount", "__cxa_decrement_exception_refcount"],
  ["___cxa_demangle", "__cxa_demangle"],
  ["___cxa_get_exception_ptr", "__cxa_get_exception_ptr"],
  ["___cxa_increment_exception_refcount", "__cxa_increment_exception_refcount"],
  ["___errno_location", "__errno_location"],
  ["___getTypeName", "__getTypeName"],
  ["___get_exception_message", "__get_exception_message"],
  ["_fileno", "fileno"],
  ["_htonl", "htonl"],
  ["_htons", "htons"],
  ["_memcmp", "memcmp"],
  ["_memcpy", "memcpy"],
  ["_ntohs", "ntohs"],
  ["_setThrew", "setThrew"],
  ["_strerror", "strerror"],
  ["_times", "times"],
  ["_write", "write"],
];
const missingBindings = mvpRuntimeBindings.filter(
  ([javascriptName]) =>
    workerSource.includes(`${javascriptName}(`) &&
    !workerSource.includes(`${javascriptName}=`) &&
    !workerSource.includes(`function ${javascriptName}`),
);
let patchedWorker = workerSource;
if (missingBindings.length > 0) {
  if (!workerSource.includes(runtimeBindingMarker)) {
    throw new Error("cannot patch DuckDB MVP worker: runtime binding insertion point changed");
  }
  const bindings = missingBindings
    .map(
      ([javascriptName, wasmName]) =>
        `${javascriptName}=(...args)=>wasmExports.${wasmName}(...args)`,
    )
    .join(",");
  patchedWorker = workerSource.replace(
    runtimeBindingMarker,
    `stackRestore=e=>__emscripten_stack_restore(e),${bindings},createInvokeFunction=`,
  );
}
await Promise.all([
  writeFile(
    new URL("duckdb-mvp.wasm.gz", destination),
    await gzipAsync(wasm, { level: 9 }),
  ),
  writeFile(
    new URL("duckdb-browser-mvp.worker.js", destination),
    patchedWorker,
  ),
  copyFile(
    new URL("../node_modules/vega/build/vega.min.js", import.meta.url),
    new URL("vega.min.js", destination),
  ),
  copyFile(
    new URL("../node_modules/vega-lite/build/vega-lite.min.js", import.meta.url),
    new URL("vega-lite.min.js", destination),
  ),
  copyFile(
    new URL("../node_modules/vega-embed/build/vega-embed.min.js", import.meta.url),
    new URL("vega-embed.min.js", destination),
  ),
  copyFile(
    new URL("../vendor/duckdb-LICENSE", import.meta.url),
    new URL("duckdb-LICENSE", destination),
  ),
  copyFile(
    new URL("../node_modules/vega/LICENSE", import.meta.url),
    new URL("vega-LICENSE", destination),
  ),
  copyFile(
    new URL("../node_modules/vega-lite/LICENSE", import.meta.url),
    new URL("vega-lite-LICENSE", destination),
  ),
  copyFile(
    new URL("../node_modules/vega-embed/LICENSE", import.meta.url),
    new URL("vega-embed-LICENSE", destination),
  ),
]);
