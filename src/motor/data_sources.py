from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import io
import re
from datetime import datetime, timezone
from pathlib import Path

from motor.errors import ReportValidationError
from motor.models import CheckResult, CompiledSource, DataSourceConfig, SourcePassport


_NULL_VALUES = {"", "null", "none", "na"}
_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_datetime(value: str, *, source: str, column: str) -> tuple[datetime, bool, str]:
    stripped = value.strip()
    date_only = bool(_DATE_ONLY_RE.fullmatch(stripped))
    normalized = stripped.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ReportValidationError(
            f"source {source}: value {value!r} in {column!r} is not an ISO 8601 datetime"
        ) from exc
    was_naive = parsed.tzinfo is None
    if was_naive:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed, was_naive and not date_only, "date" if date_only else "datetime"


def _merge_granularity(values: set[str]) -> str | None:
    if not values:
        return None
    return "datetime" if "datetime" in values else "date"


def _value_type(value: str) -> str:
    stripped = value.strip()
    if stripped.lower() in _NULL_VALUES:
        return "null"
    if stripped.lower() in {"true", "false"}:
        return "boolean"
    try:
        int(stripped)
        return "integer"
    except ValueError:
        pass
    try:
        float(stripped)
        return "number"
    except ValueError:
        pass
    try:
        datetime.fromisoformat(stripped.replace("Z", "+00:00"))
        return "datetime"
    except ValueError:
        return "string"


def _merge_type(current: str | None, candidate: str) -> str:
    if candidate == "null":
        return current or "null"
    if current in {None, "null"}:
        return candidate
    if current == candidate:
        return current
    if {current, candidate} <= {"integer", "number"}:
        return "number"
    return "string"


def compile_source(
    name: str,
    config: DataSourceConfig,
    *,
    report_dir: Path,
    built_at: datetime,
) -> tuple[CompiledSource, list[CheckResult]]:
    path = (report_dir / config.path).resolve()
    if not path.is_file():
        raise ReportValidationError(f"source {name}: CSV file does not exist: {path}")

    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ReportValidationError(f"source {name}: CSV must be UTF-8: {path}") from exc
    except OSError as exc:
        raise ReportValidationError(f"source {name}: cannot read {path}: {exc}") from exc

    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
    columns = reader.fieldnames
    if not columns:
        raise ReportValidationError(f"source {name}: CSV must contain a header row")
    if any(not column.strip() for column in columns):
        raise ReportValidationError(f"source {name}: CSV header contains an empty column name")
    if len(columns) != len(set(columns)):
        raise ReportValidationError(f"source {name}: CSV header contains duplicate column names")

    freshness = config.freshness
    configured_columns = []
    if freshness:
        configured_columns = [
            column
            for column in (freshness.data_time_column, freshness.processed_time_column)
            if column
        ]
    missing = sorted(set(configured_columns) - set(columns))
    if missing:
        raise ReportValidationError(
            f"source {name}: configured freshness columns not found: {', '.join(missing)}"
        )

    row_count = 0
    inferred: dict[str, str | None] = {column: None for column in columns}
    data_times: list[datetime] = []
    processed_times: list[datetime] = []
    data_granularities: set[str] = set()
    processed_granularities: set[str] = set()
    naive_columns: set[str] = set()
    try:
        for row in reader:
            row_count += 1
            for column in columns:
                value = row[column] or ""
                inferred[column] = _merge_type(inferred[column], _value_type(value))
            if freshness and freshness.data_time_column:
                value = row[freshness.data_time_column]
                if value and value.strip():
                    parsed, naive, granularity = _parse_datetime(
                        value, source=name, column=freshness.data_time_column
                    )
                    data_times.append(parsed)
                    data_granularities.add(granularity)
                    if naive:
                        naive_columns.add(freshness.data_time_column)
            if freshness and freshness.processed_time_column:
                value = row[freshness.processed_time_column]
                if value and value.strip():
                    parsed, naive, granularity = _parse_datetime(
                        value, source=name, column=freshness.processed_time_column
                    )
                    processed_times.append(parsed)
                    processed_granularities.add(granularity)
                    if naive:
                        naive_columns.add(freshness.processed_time_column)
    except csv.Error as exc:
        raise ReportValidationError(f"source {name}: cannot parse CSV: {exc}") from exc

    if row_count == 0:
        raise ReportValidationError(f"source {name}: CSV contains no data rows")
    if freshness and freshness.data_time_column and not data_times:
        raise ReportValidationError(
            f"source {name}: freshness column {freshness.data_time_column!r} has no values"
        )
    if freshness and freshness.processed_time_column and not processed_times:
        raise ReportValidationError(
            f"source {name}: freshness column {freshness.processed_time_column!r} has no values"
        )

    checks = [CheckResult(name="csv_valid", status="passed", source=name)]
    for column in sorted(naive_columns):
        checks.append(
            CheckResult(
                name="timezone_assumed",
                status="warning",
                source=name,
                message=f"{column}: naive datetimes were interpreted as UTC",
            )
        )

    data_min = min(data_times) if data_times else None
    data_max = max(data_times) if data_times else None
    freshness_status = "passed"
    if freshness and freshness.max_lag_hours is not None and data_max is not None:
        lag_hours = (built_at.astimezone(timezone.utc) - data_max.astimezone(timezone.utc)).total_seconds() / 3600
        if lag_hours > freshness.max_lag_hours:
            freshness_status = "warning"
            checks.append(
                CheckResult(
                    name="data_freshness",
                    status="warning",
                    source=name,
                    message=(
                        f"data is {lag_hours:.1f} hours old; configured maximum is "
                        f"{freshness.max_lag_hours:g} hours"
                    ),
                )
            )
        else:
            checks.append(CheckResult(name="data_freshness", status="passed", source=name))

    passport = SourcePassport(
        name=name,
        file_name=path.name,
        file_size_bytes=len(raw),
        rows=row_count,
        columns=len(columns),
        column_names=columns,
        inferred_column_types={column: inferred[column] or "null" for column in columns},
        sha256=hashlib.sha256(raw).hexdigest(),
        loaded_into_report_at=built_at,
        data_min_at=data_min,
        data_max_at=data_max,
        data_time_granularity=_merge_granularity(data_granularities),
        processed_at=max(processed_times) if processed_times else None,
        processed_time_granularity=_merge_granularity(processed_granularities),
        freshness_status=freshness_status,
    )
    encoded = base64.b64encode(gzip.compress(raw, mtime=0)).decode("ascii")
    return CompiledSource(passport=passport, encoded_data=encoded), checks
