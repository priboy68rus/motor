import type { Manifest, ReportSpec } from "./types";

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

export async function loadEmbeddedReport(): Promise<{
  manifest: Manifest;
  spec: ReportSpec;
  sources: Record<string, string>;
}> {
  const manifest = readJson<Manifest>("motor-manifest");
  const spec = readJson<ReportSpec>("motor-report-spec");
  const sources: Record<string, string> = {};
  const elements = document.querySelectorAll<HTMLElement>("[data-source-name]");
  await Promise.all(
    Array.from(elements).map(async (element) => {
      const name = element.dataset.sourceName;
      if (!name) throw new Error("embedded source is missing data-source-name");
      sources[name] = await decompressGzip(element.textContent ?? "");
    }),
  );
  return { manifest, spec, sources };
}

export async function createEmbeddedDuckDBWorker(): Promise<{
  worker: Worker;
  workerUrl: string;
}> {
  const workerSource = new TextDecoder().decode(
    decodeBase64(requiredElement("motor-duckdb-worker").textContent ?? ""),
  );
  const wrapper = `
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
  const workerUrl = URL.createObjectURL(new Blob([wrapper], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  const wasm = await decompressGzipBytes(
    requiredElement("motor-duckdb-wasm").textContent ?? "",
  );
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
  return { worker, workerUrl };
}
