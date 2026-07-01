import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const destination = new URL("../../src/motor/static/", import.meta.url);
const distribution = new URL("../node_modules/@duckdb/duckdb-wasm/dist/", import.meta.url);
const gzipAsync = promisify(gzip);

await mkdir(destination, { recursive: true });
const wasm = await readFile(new URL("duckdb-mvp.wasm", distribution));
await Promise.all([
  writeFile(
    new URL("duckdb-mvp.wasm.gz", destination),
    await gzipAsync(wasm, { level: 9 }),
  ),
  copyFile(
    new URL("duckdb-browser-mvp.worker.js", distribution),
    new URL("duckdb-browser-mvp.worker.js", destination),
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
