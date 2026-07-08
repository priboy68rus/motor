import { ReportRenderer } from "./components";
import { loadEmbeddedReport } from "./dataLoader";
import { DuckDBRunner } from "./duckdbRunner";
import { ReportController } from "./state";

async function start(): Promise<void> {
  const root = document.getElementById("motor-app");
  if (!root) throw new Error("missing motor application root");
  const status = document.getElementById("motor-loading-status");
  try {
    const { manifest, spec, sources } = await loadEmbeddedReport();
    if (status) status.textContent = "Starting query engine…";
    const runner = new DuckDBRunner();
    await runner.initialize(sources, manifest.artifact.content_sha256);
    let controller: ReportController | undefined;
    const renderer = new ReportRenderer(
      root,
      manifest,
      spec,
      (name, value, sourceComponentId) =>
        controller?.updateParam(name, value, sourceComponentId),
      (names) => controller?.resetParams(names),
      (queryNames) => controller?.activateQueries(queryNames),
    );
    controller = new ReportController(spec, runner, renderer, (message) => {
      if (status) status.textContent = message;
    });
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
