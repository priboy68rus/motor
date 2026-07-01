from __future__ import annotations

import gzip
from base64 import b64decode
from datetime import datetime, timezone
from pathlib import Path

import pytest

from motor.compiler import build_report, compile_report
from motor.errors import ReportValidationError
from motor.inspect import inspect_artifact


EXAMPLE = Path(__file__).parents[1] / "examples" / "revenue" / "report.md"


def test_build_embeds_manifest_and_csv(tmp_path: Path) -> None:
    output = tmp_path / "revenue.html"

    result = build_report(EXAMPLE, output)
    manifest = inspect_artifact(output)
    html = output.read_text(encoding="utf-8")

    assert result.artifact_id == manifest["artifact"]["id"]
    assert manifest["report"]["title"] == "Revenue Overview"
    assert manifest["sources"][0]["rows"] == 3
    assert 'data-encoding="base64+gzip+csv"' in html
    encoded = html.split('data-encoding="base64+gzip+csv">', 1)[1].split("</script>", 1)[0]
    assert gzip.decompress(b64decode(encoded.strip())).startswith(b"order_id,country")


def test_content_identity_excludes_build_time() -> None:
    first, _, _ = compile_report(
        EXAMPLE, built_at=datetime(2026, 7, 1, 10, tzinfo=timezone.utc)
    )
    second, _, _ = compile_report(
        EXAMPLE, built_at=datetime(2026, 7, 1, 11, tzinfo=timezone.utc)
    )

    assert first["artifact"] == second["artifact"]
    assert first["build"]["built_at"] != second["build"]["built_at"]


def test_naive_datetimes_are_utc_warnings(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,created_at\n1,2026-06-30 10:00:00\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
data:
  events:
    path: data.csv
    freshness:
      data_time_column: created_at
---
""",
        encoding="utf-8",
    )

    manifest, _, _ = compile_report(
        report, built_at=datetime(2026, 7, 1, tzinfo=timezone.utc)
    )

    assert manifest["freshness"]["status"] == "warning"
    assert manifest["sources"][0]["data_max_at"] == "2026-06-30T10:00:00Z"
    warning_names = {
        check["name"] for check in manifest["checks"]["tests"] if check["status"] == "warning"
    }
    assert warning_names == {"report_timezone_defaulted", "timezone_assumed"}


def test_stale_data_is_warning_not_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id,created_at\n1,2026-01-01T00:00:00Z\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
    freshness:
      data_time_column: created_at
      max_lag_hours: 24
---
""",
        encoding="utf-8",
    )

    manifest, _, _ = compile_report(
        report, built_at=datetime(2026, 7, 1, tzinfo=timezone.utc)
    )

    assert manifest["freshness"]["status"] == "warning"
    assert any(check["name"] == "data_freshness" for check in manifest["checks"]["tests"])


def test_missing_freshness_column_is_error(tmp_path: Path) -> None:
    data = tmp_path / "data.csv"
    data.write_text("id\n1\n", encoding="utf-8")
    report = tmp_path / "report.md"
    report.write_text(
        """---
title: Test
slug: test
timezone: UTC
data:
  events:
    path: data.csv
    freshness:
      data_time_column: missing_at
---
""",
        encoding="utf-8",
    )

    with pytest.raises(ReportValidationError, match="configured freshness columns not found"):
        compile_report(report)
