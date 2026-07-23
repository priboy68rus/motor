import type { Manifest, ReportSpec } from "./types";
import type { RuntimeMetrics } from "./runtimeMetrics";

export type EmbeddedSource = {
  format: "csv" | "parquet";
  data: string | Uint8Array;
};

type LoadEmbeddedReportOptions = {
  metrics?: RuntimeMetrics;
};

type RuntimeAssets =
  | { mode: "embedded" }
  | {
      mode: "cdn";
      duckdb: {
        version: string;
        wasm_url: string;
        worker_url: string;
      };
    };

const DUCKDB_RUNTIME_BINDING_MARKER =
  "stackRestore=e=>__emscripten_stack_restore(e),createInvokeFunction=";
const DUCKDB_RUNTIME_BINDINGS = [
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
] as const;

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing embedded payload: ${id}`);
  return element;
}

export function readJson<T>(id: string): T {
  return JSON.parse(requiredElement(id).textContent ?? "") as T;
}

export function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function decompressGzipBytes(value: string): Promise<ArrayBuffer> {
  if (!("DecompressionStream" in window)) {
    throw new Error("this browser does not support gzip decompression");
  }
  const bytes = decodeBase64(value);
  const stream = new Blob([arrayBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function decompressGzip(value: string): Promise<string> {
  return new TextDecoder().decode(await decompressGzipBytes(value));
}

function formatBytes(value: number): string {
  const unit = value >= 1024 * 1024 ? " MB" : " KB";
  const divisor = value >= 1024 * 1024 ? 1024 * 1024 : 1024;
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
  }).format(value / divisor);
  return `${formatted}${unit}`;
}

function estimatedBase64Bytes(value: string): number {
  const compact = value.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function runtimeAssets(): RuntimeAssets {
  const element = document.getElementById("motor-runtime-assets");
  if (!element) return { mode: "embedded" };
  const value = JSON.parse(element.textContent ?? "") as RuntimeAssets;
  if (value.mode === "embedded") return value;
  if (
    value.mode === "cdn" &&
    value.duckdb &&
    typeof value.duckdb.version === "string" &&
    typeof value.duckdb.wasm_url === "string" &&
    typeof value.duckdb.worker_url === "string"
  ) {
    return value;
  }
  throw new Error("invalid motor runtime asset configuration");
}

export function patchDuckDBWorker(workerSource: string): string {
  const missingBindings = DUCKDB_RUNTIME_BINDINGS.filter(
    ([javascriptName]) =>
      workerSource.includes(`${javascriptName}(`) &&
      !workerSource.includes(`${javascriptName}=`) &&
      !workerSource.includes(`function ${javascriptName}`),
  );
  if (missingBindings.length === 0) return workerSource;
  if (!workerSource.includes(DUCKDB_RUNTIME_BINDING_MARKER)) {
    throw new Error(
      "cannot patch DuckDB worker: runtime binding insertion point changed",
    );
  }
  const bindings = missingBindings
    .map(
      ([javascriptName, wasmName]) =>
        `${javascriptName}=(...args)=>wasmExports.${wasmName}(...args)`,
    )
    .join(",");
  return workerSource.replace(
    DUCKDB_RUNTIME_BINDING_MARKER,
    `stackRestore=e=>__emscripten_stack_restore(e),${bindings},createInvokeFunction=`,
  );
}

async function downloadAsset<T>(
  url: string,
  label: string,
  read: (response: Response) => Promise<T>,
  metrics?: RuntimeMetrics,
): Promise<T> {
  const metric = metrics?.start(`Download ${label}`, url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const result = await read(response);
    const contentLength = Number(response.headers.get("content-length"));
    metric?.end(
      Number.isFinite(contentLength) && contentLength > 0
        ? `${formatBytes(contentLength)} transferred or cached`
        : "browser cache enabled",
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    metric?.fail(message);
    throw new Error(
      `failed to download ${label} from ${url}: ${message}. ` +
        "This report was built with asset_mode=cdn and requires internet access.",
    );
  }
}

export async function loadEmbeddedReport(options: LoadEmbeddedReportOptions = {}): Promise<{
  manifest: Manifest;
  spec: ReportSpec;
  sources: Record<string, EmbeddedSource>;
}> {
  const { metrics } = options;
  const manifestMetric = metrics?.start("Read report manifest");
  let manifest: Manifest;
  let spec: ReportSpec;
  try {
    manifest = readJson<Manifest>("motor-manifest");
    spec = readJson<ReportSpec>("motor-report-spec");
    manifestMetric?.end();
  } catch (error) {
    manifestMetric?.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
  const sources: Record<string, EmbeddedSource> = {};
  const elements = document.querySelectorAll<HTMLElement>("[data-source-name]");
  await Promise.all(
    Array.from(elements).map(async (element) => {
      const name = element.dataset.sourceName;
      if (!name) throw new Error("embedded source is missing data-source-name");
      const format = element.dataset.sourceFormat === "parquet" ? "parquet" : "csv";
      const payload = element.textContent ?? "";
      const sourceMetric = metrics?.start(
        `Decompress source ${name}`,
        `${formatBytes(estimatedBase64Bytes(payload))} compressed`,
      );
      try {
        if (format === "parquet") {
          const data = new Uint8Array(await decompressGzipBytes(payload));
          sources[name] = { format, data };
          sourceMetric?.end(`${formatBytes(data.byteLength)} Parquet`);
        } else {
          const data = await decompressGzip(payload);
          sources[name] = { format, data };
          sourceMetric?.end(`${formatBytes(data.length)} CSV`);
        }
      } catch (error) {
        sourceMetric?.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    }),
  );
  return { manifest, spec, sources };
}

export async function createDuckDBWorker(metrics?: RuntimeMetrics): Promise<{
  worker: Worker;
  workerUrl: string;
}> {
  const assets = runtimeAssets();
  const workerSourcePromise =
    assets.mode === "cdn"
      ? downloadAsset(
          assets.duckdb.worker_url,
          "DuckDB worker",
          (response) => response.text(),
          metrics,
        )
      : Promise.resolve(
          new TextDecoder().decode(
            decodeBase64(requiredElement("motor-duckdb-worker").textContent ?? ""),
          ),
        );
  const wasmPromise =
    assets.mode === "cdn"
      ? downloadAsset(
          assets.duckdb.wasm_url,
          "DuckDB WASM",
          (response) => response.arrayBuffer(),
          metrics,
        )
      : (() => {
          const wasmPayload = requiredElement("motor-duckdb-wasm").textContent ?? "";
          const wasmMetric = metrics?.start("Decompress DuckDB WASM");
          return decompressGzipBytes(wasmPayload)
            .then((wasm) => {
              wasmMetric?.end(formatBytes(wasm.byteLength));
              return wasm;
            })
            .catch((error: unknown) => {
              wasmMetric?.fail(error instanceof Error ? error.message : String(error));
              throw error;
            });
        })();
  const [downloadedWorkerSource, wasm] = await Promise.all([
    workerSourcePromise,
    wasmPromise,
  ]);
  const workerMetric = metrics?.start("Prepare DuckDB worker");
  let wrapper: string;
  try {
    const workerSource = patchDuckDBWorker(downloadedWorkerSource);
    wrapper = `
    let motorWasm;
    const motorNativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "motor://duckdb.wasm") {
        return Promise.resolve(new Response(motorWasm, {
          headers: { "Content-Type": "application/wasm" },
        }));
      }
      return motorNativeFetch(input, init);
    };
    globalThis.addEventListener("message", (event) => {
      if (event.data?.type !== "MOTOR_INIT") return;
      event.stopImmediatePropagation();
      motorWasm = event.data.wasm;
      globalThis.postMessage({ type: "MOTOR_READY" });
    }, true);
  ${workerSource}`;
  } catch (error) {
    workerMetric?.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
  const workerUrl = URL.createObjectURL(new Blob([wrapper], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  workerMetric?.end();
  const initMetric = metrics?.start("Initialize DuckDB worker");
  try {
    await new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent): void => {
        if (event.data?.type !== "MOTOR_READY") return;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve();
      };
      const onError = (event: ErrorEvent): void => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error(event.message || "DuckDB worker initialization failed"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ type: "MOTOR_INIT", wasm }, [wasm]);
    });
    initMetric?.end();
  } catch (error) {
    initMetric?.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
  return { worker, workerUrl };
}
