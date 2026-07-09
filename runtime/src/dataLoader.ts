import type { Manifest, ReportSpec } from "./types";
import type { RuntimeMetrics } from "./runtimeMetrics";

type LoadEmbeddedReportOptions = {
  metrics?: RuntimeMetrics;
};

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

export async function loadEmbeddedReport(options: LoadEmbeddedReportOptions = {}): Promise<{
  manifest: Manifest;
  spec: ReportSpec;
  sources: Record<string, string>;
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
  const sources: Record<string, string> = {};
  const elements = document.querySelectorAll<HTMLElement>("[data-source-name]");
  await Promise.all(
    Array.from(elements).map(async (element) => {
      const name = element.dataset.sourceName;
      if (!name) throw new Error("embedded source is missing data-source-name");
      const payload = element.textContent ?? "";
      const sourceMetric = metrics?.start(
        `Decompress source ${name}`,
        `${formatBytes(estimatedBase64Bytes(payload))} compressed`,
      );
      try {
        sources[name] = await decompressGzip(payload);
        sourceMetric?.end(`${formatBytes(sources[name]?.length ?? 0)} CSV`);
      } catch (error) {
        sourceMetric?.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    }),
  );
  return { manifest, spec, sources };
}

export async function createEmbeddedDuckDBWorker(metrics?: RuntimeMetrics): Promise<{
  worker: Worker;
  workerUrl: string;
}> {
  const workerMetric = metrics?.start("Prepare DuckDB worker");
  let wrapper: string;
  try {
    const workerSource = new TextDecoder().decode(
      decodeBase64(requiredElement("motor-duckdb-worker").textContent ?? ""),
    );
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
  const wasmPayload = requiredElement("motor-duckdb-wasm").textContent ?? "";
  const wasmMetric = metrics?.start("Decompress DuckDB WASM");
  let wasm: ArrayBuffer;
  try {
    wasm = await decompressGzipBytes(wasmPayload);
    wasmMetric?.end(formatBytes(wasm.byteLength));
  } catch (error) {
    wasmMetric?.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
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
