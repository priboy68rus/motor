import type { Manifest, ReportSpec } from "./types";

type LatestVersionResponse = {
  slug?: unknown;
  artifact_id?: unknown;
  built_at?: unknown;
  title?: unknown;
};

const UPDATE_CHECK_TIMEOUT_MS = 2_000;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function latestUrl(endpoint: string, slug: string): string {
  return `${endpoint.replace(/\/+$/, "")}/reports/${encodeURIComponent(slug)}.json`;
}

function renderUpdateBadge(distributionUrl: string, latest: LatestVersionResponse): void {
  if (document.querySelector(".motor-update-badge")) return;
  const badge = document.createElement("a");
  badge.className = "motor-update-badge";
  badge.href = distributionUrl;
  badge.target = "_blank";
  badge.rel = "noopener noreferrer";
  badge.textContent = "New version available · Open latest";
  if (typeof latest.built_at === "string") {
    badge.title = `Latest version built at ${latest.built_at}`;
  }
  document.body.append(badge);
}

export function startUpdateCheck(manifest: Manifest, spec: ReportSpec): void {
  const config = spec.update_check;
  if (!config) return;
  const distributionUrl = config.distribution_url ?? config.channel_url;
  if (!distributionUrl) return;
  if (!isHttpUrl(config.endpoint) || !isHttpUrl(distributionUrl)) return;

  const slug = manifest.report.slug || spec.report.slug;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  void fetch(latestUrl(config.endpoint, slug), {
    cache: "no-store",
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) return null;
      return response.json() as Promise<LatestVersionResponse>;
    })
    .then((latest) => {
      if (!latest) return;
      if (latest.slug !== slug) return;
      if (typeof latest.artifact_id !== "string") return;
      if (latest.artifact_id === manifest.artifact.id) return;
      renderUpdateBadge(distributionUrl, latest);
    })
    .catch(() => {
      // Update checks are fail-soft by design. Offline files and unreachable
      // local servers must not degrade the report itself.
    })
    .finally(() => window.clearTimeout(timeout));
}
