from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from motor.data_sources import compile_source
from motor.errors import MotorError, ReportValidationError
from motor.html import render_report_html
from motor.manifest import build_manifest
from motor.models import BuildResult, CheckResult, CompiledSource
from motor.parser import parse_report


def compile_report(
    report_path: Path,
    *,
    built_at: datetime | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[CompiledSource]]:
    report_path = report_path.resolve()
    parsed = parse_report(report_path)
    build_time = built_at or datetime.now(timezone.utc)
    if build_time.tzinfo is None:
        raise ValueError("built_at must have a timezone")

    checks: list[CheckResult] = []
    report_timezone = parsed.config.timezone or "UTC"
    if parsed.config.timezone is None:
        checks.append(
            CheckResult(
                name="report_timezone_defaulted",
                status="warning",
                message="report timezone is not configured; UTC was used",
            )
        )

    compiled_sources: list[CompiledSource] = []
    for name, config in parsed.config.data.items():
        compiled, source_checks = compile_source(
            name,
            config,
            report_dir=report_path.parent,
            built_at=build_time,
        )
        compiled_sources.append(compiled)
        checks.extend(source_checks)

    source_columns = {
        source.passport.name: set(source.passport.column_names) for source in compiled_sources
    }
    for name, param in parsed.config.params.items():
        if param.options is None:
            continue
        if param.options.column not in source_columns[param.options.source]:
            raise ReportValidationError(
                f"parameter {name!r} options reference missing column "
                f"{param.options.source}.{param.options.column}"
            )

    report_spec = {
        "report": {
            "title": parsed.config.title,
            "slug": parsed.config.slug,
            "spec_version": parsed.config.spec_version,
            "timezone": report_timezone,
        },
        "update_check": (
            parsed.config.update_check.model_dump(mode="json", exclude_none=True)
            if parsed.config.update_check
            else None
        ),
        "data": {
            name: config.model_dump(mode="json", exclude_none=True)
            for name, config in parsed.config.data.items()
        },
        "params": {
            name: config.model_dump(mode="json", exclude_none=True)
            for name, config in parsed.config.params.items()
        },
        "queries": {
            name: query.model_dump(mode="json", exclude={"name"})
            for name, query in parsed.queries.items()
        },
        "components": [
            component.model_dump(mode="json", exclude_none=True)
            for component in parsed.components
        ],
        "layout": [
            item.model_dump(mode="json", exclude_none=True, exclude_defaults=True)
            for item in parsed.layout
        ],
        "body": parsed.body,
    }
    manifest = build_manifest(
        parsed,
        [source.passport for source in compiled_sources],
        checks,
        built_at=build_time,
        report_timezone=report_timezone,
    )
    return manifest, report_spec, compiled_sources


def _latest_version_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "0.1",
        "slug": manifest["report"]["slug"],
        "title": manifest["report"]["title"],
        "artifact_id": manifest["artifact"]["id"],
        "built_at": manifest["build"]["built_at"],
        "tool_version": manifest["build"]["tool_version"],
        "runtime_version": manifest["build"]["runtime_version"],
    }


def publish_latest_version(manifest: dict[str, Any], registry: Path) -> Path:
    registry = registry.expanduser().resolve()
    slug = manifest["report"]["slug"]
    output_path = registry / "reports" / f"{slug}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _latest_version_payload(manifest)
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
    fd, temporary_name = tempfile.mkstemp(prefix=f".{output_path.name}.", dir=output_path.parent)
    try:
        with os.fdopen(fd, "wb") as temporary:
            temporary.write(encoded)
        os.replace(temporary_name, output_path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return output_path


def build_report(report_path: Path, output_path: Path, *, update_registry: Path | None = None) -> BuildResult:
    manifest, report_spec, sources = compile_report(report_path)
    html = render_report_html(manifest, report_spec, sources)
    encoded = html.encode("utf-8")
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{output_path.name}.", dir=output_path.parent)
    try:
        with os.fdopen(fd, "wb") as temporary:
            temporary.write(encoded)
        os.replace(temporary_name, output_path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise

    if update_registry is not None:
        try:
            publish_latest_version(manifest, update_registry)
        except OSError as exc:
            raise MotorError(f"failed to publish latest version registry: {exc}") from exc

    warnings = [
        check["message"]
        for check in manifest["checks"]["tests"]
        if check["status"] == "warning" and check.get("message")
    ]
    if report_spec.get("update_check") and update_registry is None:
        warnings.append(
            "update_check is configured but no update registry was provided; "
            "latest version metadata was not published"
        )
    return BuildResult(
        output_path=str(output_path),
        artifact_id=manifest["artifact"]["id"],
        output_sha256=hashlib.sha256(encoded).hexdigest(),
        warnings=warnings,
    )
