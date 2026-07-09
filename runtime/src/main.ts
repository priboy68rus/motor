import { ReportRenderer } from "./components";
import { loadEmbeddedReport } from "./dataLoader";
import { DuckDBRunner } from "./duckdbRunner";
import { RuntimeMetrics } from "./runtimeMetrics";
import type { RuntimeMetricsSnapshot } from "./runtimeMetrics";
import { ReportController } from "./state";

function formatDuration(value: number | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function renderLoadingStatus(
  element: HTMLElement | null,
  snapshot: RuntimeMetricsSnapshot,
): void {
  if (!element) return;
  element.className = "motor-loading-status";
  const title = document.createElement("div");
  title.className = "motor-loading-status-title";
  title.textContent = snapshot.current ?? "Loading report…";
  const summary = document.createElement("div");
  summary.className = "motor-loading-status-summary";
  summary.textContent = `Elapsed: ${formatDuration(snapshot.total_ms)}`;
  const list = document.createElement("ol");
  list.className = "motor-loading-status-list";
  for (const item of snapshot.items) {
    const row = document.createElement("li");
    row.className = `motor-loading-status-step is-${item.status}`;
    const duration =
      item.status === "running" ? "running…" : formatDuration(item.duration_ms);
    row.textContent = `${item.label} · ${duration}${item.detail ? ` · ${item.detail}` : ""}`;
    list.append(row);
  }
  element.replaceChildren(title, summary, list);
}

async function start(): Promise<void> {
  const root = document.getElementById("motor-app");
  if (!root) throw new Error("missing motor application root");
  const status = document.getElementById("motor-loading-status");
  const metrics = new RuntimeMetrics((snapshot) => renderLoadingStatus(status, snapshot));
  metrics.setCurrent("Loading embedded data…");
  try {
    const { manifest, spec, sources } = await loadEmbeddedReport({ metrics });
    metrics.setCurrent("Starting query engine…");
    const runner = new DuckDBRunner();
    await runner.initialize(sources, manifest.artifact.content_sha256, metrics);
    let controller: ReportController | undefined;
    const renderer = new ReportRenderer(
      root,
      manifest,
      spec,
      (name, value, sourceComponentId) =>
        controller?.updateParam(name, value, sourceComponentId),
      (names) => controller?.resetParams(names),
      (queryNames) => controller?.activateQueries(queryNames),
      metrics,
    );
    controller = new ReportController(spec, runner, renderer, (message) => {
      metrics.setCurrent(message);
    }, metrics);
    await controller.initialize();
    window.addEventListener("pagehide", () => void runner.close(), { once: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      status.className = "motor-fatal-error";
      status.textContent = `Report runtime failed: ${message}`;
    } else {
      root.append(document.createTextNode(`Report runtime failed: ${message}`));
    }
  }
}

void start();
