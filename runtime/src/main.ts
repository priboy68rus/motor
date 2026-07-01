import { renderComponents } from "./components";
import { loadEmbeddedReport } from "./dataLoader";
import { DuckDBRunner } from "./duckdbRunner";

async function start(): Promise<void> {
  const root = document.getElementById("motor-app");
  if (!root) throw new Error("missing motor application root");
  const status = document.getElementById("motor-loading-status");
  try {
    const { manifest, spec, sources } = await loadEmbeddedReport();
    if (status) status.textContent = "Starting query engine…";
    const runner = new DuckDBRunner();
    await runner.initialize(sources);
    if (status) status.textContent = "Running report queries…";
    const values = Object.fromEntries(
      Object.entries(spec.params).map(([name, param]) => [name, param.default]),
    );
    const { results, errors } = await runner.run(spec, values, (queryName) => {
      if (status) status.textContent = `Running query ${queryName}…`;
    });
    await renderComponents(root, manifest, spec, results, errors);
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
