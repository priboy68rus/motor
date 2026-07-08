from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from motor import __version__
from motor.models import CheckResult, ParsedReport, SourcePassport


RUNTIME_VERSION = "0.7.6-chart-tooltip-details"


def _content_identity(parsed: ParsedReport, sources: list[SourcePassport]) -> tuple[str, str]:
    payload = {
        "report_source_sha256": parsed.source_sha256,
        "runtime_version": RUNTIME_VERSION,
        "sources": {source.name: source.sha256 for source in sorted(sources, key=lambda item: item.name)},
        "tool_version": __version__,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{parsed.config.slug}__{digest[:12]}", digest


def build_manifest(
    parsed: ParsedReport,
    sources: list[SourcePassport],
    checks: list[CheckResult],
    *,
    built_at: datetime,
    report_timezone: str,
) -> dict[str, Any]:
    artifact_id, content_sha256 = _content_identity(parsed, sources)
    overall_status = "warning" if any(check.status == "warning" for check in checks) else "passed"
    data_through_values = [source.data_max_at for source in sources if source.data_max_at]
    processed_values = [source.processed_at for source in sources if source.processed_at]
    return {
        "report": {
            "slug": parsed.config.slug,
            "title": parsed.config.title,
            "spec_version": parsed.config.spec_version,
            "timezone": report_timezone,
        },
        "artifact": {
            "id": artifact_id,
            "content_sha256": content_sha256,
            "status": "local",
        },
        "build": {
            "built_at": built_at.isoformat(),
            "tool_name": "motor",
            "tool_version": __version__,
            "runtime_version": RUNTIME_VERSION,
            "build_mode": "local",
        },
        "freshness": {
            "status": overall_status,
            "data_through": max(data_through_values).isoformat() if data_through_values else None,
            "processed_at": max(processed_values).isoformat() if processed_values else None,
        },
        "sources": [source.model_dump(mode="json") for source in sources],
        "checks": {
            "status": overall_status,
            "tests": [check.model_dump(mode="json", exclude_none=True) for check in checks],
        },
    }
